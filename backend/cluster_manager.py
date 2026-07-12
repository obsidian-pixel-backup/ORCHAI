import logging
import os
import asyncio
import subprocess
import platform
import urllib.request
import zipfile
import paramiko
import time
import httpx
import struct
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

DEBIAN_HOST = "192.168.0.102"
DEBIAN_USER = "debian"
DEBIAN_PASSWORD = os.getenv("DEBIAN_SSH_PASSWORD")
RPC_PORT = 50052

# We'll use a specific llama.cpp release for compatibility
LLAMA_CPP_VERSION = "b9963"
LLAMA_WINDOWS_URL = f"https://github.com/ggerganov/llama.cpp/releases/download/{LLAMA_CPP_VERSION}/llama-{LLAMA_CPP_VERSION}-bin-win-cuda-12.4-x64.zip"
LLAMA_WINDOWS_CUDART_URL = f"https://github.com/ggerganov/llama.cpp/releases/download/{LLAMA_CPP_VERSION}/cudart-llama-bin-win-cuda-12.4-x64.zip"

# Version stamp file on Debian to track which version is compiled
DEBIAN_VERSION_STAMP = f"~/.orchai/bin/.llama_rpc_version"

def parse_gguf_metadata(file_path):
    """Parse GGUF file to find block count (number of layers)."""
    try:
        with open(file_path, "rb") as f:
            magic = f.read(4)
            if magic != b"GGUF":
                return None
            version = struct.unpack("<I", f.read(4))[0]
            tensor_count = struct.unpack("<Q", f.read(8))[0]
            kv_count = struct.unpack("<Q", f.read(8))[0]
            
            def read_string(file_obj):
                length = struct.unpack("<Q", file_obj.read(8))[0]
                return file_obj.read(length).decode("utf-8", errors="ignore")
                
            def read_value(file_obj, val_type):
                if val_type == 0: return struct.unpack("<B", file_obj.read(1))[0]
                elif val_type == 1: return struct.unpack("<b", file_obj.read(1))[0]
                elif val_type == 2: return struct.unpack("<H", file_obj.read(2))[0]
                elif val_type == 3: return struct.unpack("<h", file_obj.read(2))[0]
                elif val_type == 4: return struct.unpack("<I", file_obj.read(4))[0]
                elif val_type == 5: return struct.unpack("<i", file_obj.read(4))[0]
                elif val_type == 6: return struct.unpack("<f", file_obj.read(4))[0]
                elif val_type == 7: return struct.unpack("<B", file_obj.read(1))[0] != 0
                elif val_type == 8: return read_string(file_obj)
                elif val_type == 9:
                    arr_type = struct.unpack("<I", file_obj.read(4))[0]
                    arr_len = struct.unpack("<Q", file_obj.read(8))[0]
                    arr_vals = []
                    for _ in range(arr_len):
                        arr_vals.append(read_value(file_obj, arr_type))
                    return arr_vals
                elif val_type == 10: return struct.unpack("<Q", file_obj.read(8))[0]
                elif val_type == 11: return struct.unpack("<q", file_obj.read(8))[0]
                elif val_type == 12: return struct.unpack("<d", file_obj.read(8))[0]
                else: raise ValueError(f"Unknown value type: {val_type}")

            for _ in range(kv_count):
                key = read_string(f)
                val_type = struct.unpack("<I", f.read(4))[0]
                val = read_value(f, val_type)
                if key.endswith(".block_count") or key == "block_count":
                    return int(val)
    except Exception as e:
        logging.warning(f"[CLUSTER] Error parsing GGUF metadata: {e}")
    return None

def estimate_block_count(file_size_bytes):
    # Estimate block count if parsing fails
    gb = file_size_bytes / (1024**3)
    if gb > 30: return 80
    if gb > 15: return 40
    if gb > 7: return 32
    return 24

def get_local_gpu_vram():
    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )
        vram_mib = int(res.stdout.strip().split("\n")[0])
        return vram_mib * 1024 * 1024
    except Exception as e:
        logging.warning(f"[CLUSTER] Error querying local GPU VRAM via nvidia-smi: {e}. Using fallback 16.0 GB.")
        return 16 * 1024 * 1024 * 1024

class ClusterManager:
    def __init__(self):
        self.windows_bin_dir = Path.home() / ".orchai" / "bin"
        self.windows_llama_server = self.windows_bin_dir / "llama-server.exe"
        self.windows_process = None
        self.worker_started = False
        self.remote_gpu_vram = 6 * 1024 * 1024 * 1024 # default fallback
        self.current_model_path = None
        self.init_event = asyncio.Event()
        
    async def ensure_windows_binary(self):
        """Download llama-server.exe for Windows if it doesn't exist."""
        if self.windows_llama_server.exists():
            logging.info("Windows llama-server binary already exists.")
            return True
            
        logging.info("Downloading llama-server (CUDA) for Windows...")
        self.windows_bin_dir.mkdir(parents=True, exist_ok=True)
        zip_path = self.windows_bin_dir / "llama-windows.zip"
        cudart_zip_path = self.windows_bin_dir / "cudart-windows.zip"
        
        def download():
            urllib.request.urlretrieve(LLAMA_WINDOWS_URL, zip_path)
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(self.windows_bin_dir)
            zip_path.unlink()
            
            urllib.request.urlretrieve(LLAMA_WINDOWS_CUDART_URL, cudart_zip_path)
            with zipfile.ZipFile(cudart_zip_path, 'r') as zip_ref:
                zip_ref.extractall(self.windows_bin_dir)
            cudart_zip_path.unlink()
            
        await asyncio.to_thread(download)
        logging.info("Windows llama-server (CUDA) download complete.")
        return True

    def start_debian_worker(self):
        """SSH into Debian and start the RPC server."""
        if not DEBIAN_PASSWORD:
            logging.info("Warning: DEBIAN_SSH_PASSWORD not set in .env. Skipping Debian worker setup.")
            return False
            
        logging.info(f"Connecting to Debian worker {DEBIAN_HOST}...")
        try:
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(DEBIAN_HOST, username=DEBIAN_USER, password=DEBIAN_PASSWORD, timeout=10)
            
            # Check if the correct version is already compiled
            check_cmd = f"cat {DEBIAN_VERSION_STAMP} 2>/dev/null"
            stdin, stdout, stderr = ssh.exec_command(check_cmd)
            installed_version = stdout.read().decode().strip()
            
            needs_compile = installed_version != LLAMA_CPP_VERSION
            
            if needs_compile:
                logging.info(f"Debian worker needs compile (have: '{installed_version}', need: '{LLAMA_CPP_VERSION}')...")
                compile_script = f"""
set -e
mkdir -p ~/.orchai/bin
cd ~/.orchai/bin

# Install build deps
echo "{DEBIAN_PASSWORD}" | sudo -S apt-get update -qq
echo "{DEBIAN_PASSWORD}" | sudo -S apt-get install -y -qq build-essential cmake git

# Clone or update llama.cpp
if [ ! -d "llama.cpp" ]; then
    git clone https://github.com/ggerganov/llama.cpp.git
fi
cd llama.cpp
git fetch --all --quiet
git checkout {LLAMA_CPP_VERSION} --quiet

# Clean build
rm -rf build
mkdir build && cd build
cmake .. -DGGML_RPC=ON -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release 2>&1 | tail -5

# Try multiple possible target names (changed across versions)
make ggml-rpc-server -j4 2>/dev/null || make rpc-server -j4 2>/dev/null || make llama-rpc-server -j4

# Find and copy the binary
find . -name "*rpc-server" -type f -executable | head -1 | xargs -I{{}} cp {{}} ~/.orchai/bin/llama-rpc-server
chmod +x ~/.orchai/bin/llama-rpc-server

# Stamp the version
echo "{LLAMA_CPP_VERSION}" > {DEBIAN_VERSION_STAMP}
echo "COMPILE_DONE"
"""
                stdin, stdout, stderr = ssh.exec_command(compile_script, timeout=300)
                compile_output = stdout.read().decode()
                compile_err = stderr.read().decode()
                
                # Check if compilation succeeded
                check_bin = "ls ~/.orchai/bin/llama.cpp/build/bin/llama-rpc-server 2>/dev/null || ls ~/.orchai/bin/llama.cpp/build/bin/rpc-server 2>/dev/null || ls ~/.orchai/bin/llama.cpp/build/bin/ggml-rpc-server 2>/dev/null"
                stdin, stdout, stderr = ssh.exec_command(check_bin)
                bin_path = stdout.read().decode().strip()
                
                if bin_path:
                    logging.info(f"Compilation successful: {bin_path}")
                    ssh.exec_command(f"cp {bin_path} ~/.orchai/bin/llama-rpc-server")
                    ssh.exec_command(f"echo '{LLAMA_CPP_VERSION}' > {DEBIAN_VERSION_STAMP}")
                else:
                    logging.info(f"Failed to compile Debian worker.\nSTDOUT: {compile_out}\nSTDERR: {compile_err}")
                    return False
            else:
                logging.info(f"Debian worker binary is up to date (version {LLAMA_CPP_VERSION}).")
            
            # Kill any existing RPC server and start fresh
            start_script = f"""
killall llama-rpc-server 2>/dev/null
sleep 1
nohup ~/.orchai/bin/llama-rpc-server -H 0.0.0.0 -p {RPC_PORT} </dev/null > ~/.orchai/bin/rpc.log 2>&1 &
sleep 2
ps aux | grep -v grep | grep llama-rpc-server | wc -l
"""
            stdin, stdout, stderr = ssh.exec_command(start_script)
            output = stdout.read().decode().strip()
            
            # The last line should be "1" (one process running)
            running_count = output.strip().split('\n')[-1].strip()
            
            # Query remote GPU total memory via nvidia-smi before closing SSH
            try:
                stdin_v, stdout_v, stderr_v = ssh.exec_command("nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits")
                vram_out = stdout_v.read().decode().strip()
                if vram_out:
                    self.remote_gpu_vram = int(vram_out.split('\n')[0].strip()) * 1024 * 1024
                    logging.info(f"[CLUSTER] Detected remote GPU VRAM: {self.remote_gpu_vram / (1024**3):.2f} GB")
            except Exception as e:
                logging.warning(f"[CLUSTER] Failed to query remote GPU VRAM: {e}. Using fallback 6.0 GB.")
                self.remote_gpu_vram = 6 * 1024 * 1024 * 1024

            ssh.close()
            
            if running_count == "1":
                logging.info(f"Debian worker started successfully on port {RPC_PORT}!")
                return True
            else:
                logging.info(f"Debian worker failed to start. Process count: {running_count}")
                return False
                
        except Exception as e:
            logging.info(f"Error connecting to Debian worker: {e}")
            return False

    async def start_distributed_cluster(self):
        """Start the Debian worker at launch."""
        try:
            await self.ensure_windows_binary()
            self.worker_started = await asyncio.to_thread(self.start_debian_worker)
            if self.worker_started:
                logging.info("Distributed Inference Cluster backend is READY! (Waiting for model selection)")
            else:
                logging.info("Distributed Inference Cluster: Debian worker unavailable, will run locally only.")
        finally:
            self.init_event.set()

    async def _wait_for_server(self, url: str, timeout: float = 60.0):
        """Wait until the llama-server HTTP endpoint is responding."""
        start = time.time()
        last_log = 0
        async with httpx.AsyncClient() as client:
            while time.time() - start < timeout:
                elapsed = time.time() - start
                try:
                    resp = await client.get(f"{url}/health", timeout=2.0)
                    if resp.status_code == 200:
                        logging.info(f"[CLUSTER] Server ready after {elapsed:.1f}s")
                        return True
                    else:
                        if elapsed - last_log > 5:
                            logging.info(f"[CLUSTER] Health check returned {resp.status_code} after {elapsed:.1f}s")
                            last_log = elapsed
                except httpx.ConnectError:
                    if elapsed - last_log > 10:
                        logging.info(f"[CLUSTER] Waiting for server... ({elapsed:.0f}s / {timeout:.0f}s)")
                        last_log = elapsed
                except Exception as e:
                    if elapsed - last_log > 10:
                        logging.info(f"[CLUSTER] Health check error after {elapsed:.1f}s: {type(e).__name__}: {e}")
                        last_log = elapsed
                await asyncio.sleep(1.0)
        logging.info(f"[CLUSTER] TIMEOUT: Server did not respond after {timeout}s")
        return False

    async def ensure_running(self, model_path: str):
        """Ensure the master node is running with the specified model path."""
        if not self.init_event.is_set():
            logging.info("[CLUSTER] Waiting for Debian worker compilation/initialization to complete...")
            await self.init_event.wait()
            
        logging.info(f"[CLUSTER] ensure_running called with: {model_path}")
        
        if not model_path:
            logging.info("[CLUSTER] ERROR: Empty model path, cannot start cluster.")
            return False
            
        # Already running this model — check process is alive
        if self.current_model_path == model_path and self.windows_process is not None and self.windows_process.poll() is None:
            logging.info(f"[CLUSTER] Already running this model (PID {self.windows_process.pid}), reusing.")
            return True
            
        # Kill existing master if switching models
        if self.windows_process:
            poll = self.windows_process.poll()
            if poll is None:
                logging.info(f"[CLUSTER] Stopping old master node (PID {self.windows_process.pid})...")
                self.windows_process.kill()
                self.windows_process.wait()
                logging.info(f"[CLUSTER] Old master node stopped.")
            else:
                logging.info(f"[CLUSTER] Old master node already exited (code {poll}).")
            
        logging.info(f"[CLUSTER] Starting Windows master node...")
        logging.info(f"[CLUSTER]   Binary: {self.windows_llama_server}")
        logging.info(f"[CLUSTER]   Model:  {model_path}")
        logging.info(f"[CLUSTER]   Worker: {'Yes - ' + DEBIAN_HOST + ':' + str(RPC_PORT) if self.worker_started else 'No (local only)'}")
        
        log_path = self.windows_bin_dir / "master.log"
        log_file = open(log_path, "w")
        
        # Calculate dynamic layers and tensor-split
        model_size_bytes = os.path.getsize(model_path)
        num_layers = parse_gguf_metadata(model_path)
        if not num_layers:
            num_layers = estimate_block_count(model_size_bytes)
            logging.info(f"[CLUSTER] Could not parse block count from metadata. Estimated: {num_layers}")
        else:
            logging.info(f"[CLUSTER] Parsed block count from metadata: {num_layers}")
            
        # Query local VRAM
        local_vram_total = get_local_gpu_vram()
        logging.info(f"[CLUSTER] Local GPU VRAM: {local_vram_total / (1024**3):.2f} GB")
        
        # Calculate context size from environment (defaulting to 131072 for massive, limitless context)
        ctx_size = int(os.getenv("ORCHAI_CTX_SIZE", "131072"))
        logging.info(f"[CLUSTER] Using context size: {ctx_size}")

        # KV cache footprint per layer: ctx_size * 2048 bytes (assumes GQA with 8 KV heads, 128 head_dim, 8-bit quantized)
        kv_cache_per_layer = ctx_size * 2048
        total_size_per_layer = (model_size_bytes / num_layers) + kv_cache_per_layer
        logging.info(f"[CLUSTER] Memory footprint per layer (weights + KV cache): {total_size_per_layer / (1024**2):.1f} MB")

        # Calculate usable VRAM with fixed overhead (excluding KV Cache since we account for it per layer)
        # Reserve 1.3 GB on Windows for GUI and CUDA driver/buffers
        local_vram_usable = max(1 * 1024**3, local_vram_total - 1.3 * 1024**3)
        
        # Calculate layers to allocate to local GPU
        local_layers = int(local_vram_usable // total_size_per_layer)
        local_layers = min(local_layers, num_layers)
        
        cmd = [
            str(self.windows_llama_server),
            "-m", model_path,
            "--port", "8081",
            "--ctx-size", str(ctx_size),
            "-fa", "on",  # Enable Flash Attention for speed and memory savings
            "-np", "1",   # Restrict to 1 slot to save KV cache VRAM
            "-ctk", "q8_0", # Quantize Key cache to 8-bit
            "-ctv", "q8_0", # Quantize Value cache to 8-bit
        ]
        
        if self.worker_started:
            # Reserve 0.3 GB (300 MB) on Debian for GUI and CUDA driver/buffers
            remote_vram_usable = max(300 * 1024**2, self.remote_gpu_vram - 0.3 * 1024**3)
            
            remaining_layers = num_layers - local_layers
            remote_layers = int(remote_vram_usable // total_size_per_layer)
            remote_layers = min(remaining_layers, remote_layers)
            
            n_gpu_layers = local_layers + remote_layers
            
            if n_gpu_layers > 0:
                cmd.extend(["-ngl", str(n_gpu_layers)])
                cmd.extend(["--tensor-split", f"{local_layers},{remote_layers}"])
            else:
                cmd.extend(["-ngl", "0"])
                
            cmd.extend(["--rpc", f"{DEBIAN_HOST}:{RPC_PORT}"])
            
            logging.info(f"[CLUSTER] Dynamic allocation: {local_layers} layers local GPU, {remote_layers} layers remote GPU, {num_layers - n_gpu_layers} layers on CPU")
        else:
            # Local only
            if local_layers > 0:
                cmd.extend(["-ngl", str(local_layers)])
            else:
                cmd.extend(["-ngl", "0"])
            logging.info(f"[CLUSTER] Local-only dynamic allocation: {local_layers} layers local GPU, {num_layers - local_layers} layers on CPU")
            
        logging.info(f"[CLUSTER] Command: {' '.join(cmd)}")
        
        self.windows_process = subprocess.Popen(
            cmd,
            creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
        logging.info(f"[CLUSTER] Master node started (PID {self.windows_process.pid})")
        
        self.current_model_path = model_path
        
        # Wait for the server to actually be ready (model loading can take time)
        logging.info(f"[CLUSTER] Waiting for master node health check on http://127.0.0.1:8081/health (timeout 180s)...")
        ready = await self._wait_for_server("http://127.0.0.1:8081", timeout=180.0)
        
        if ready:
            logging.info("[CLUSTER] === Distributed Inference Cluster is RUNNING! ===")
            return True
        else:
            # Check if process died
            poll = self.windows_process.poll()
            if poll is not None:
                logging.info(f"[CLUSTER] FATAL: Master node CRASHED (exit code {poll})")
                try:
                    log_file.close()
                    with open(log_path, "r") as f:
                        log_content = f.read()[-2000:]
                    logging.info(f"[CLUSTER] Master log:\n{log_content}")
                except Exception as e:
                    logging.info(f"[CLUSTER] Could not read log: {e}")
            else:
                logging.info(f"[CLUSTER] WARNING: Master node still loading after timeout (PID {self.windows_process.pid})")
                # Read what we have so far
                try:
                    log_file.flush()
                    with open(log_path, "r") as f:
                        log_content = f.read()[-1000:]
                    logging.info(f"[CLUSTER] Current log:\n{log_content}")
                except Exception:
                    pass
            return False

cluster_manager = ClusterManager()
