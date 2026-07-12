import paramiko

DEBIAN_HOST = "192.168.0.102"
DEBIAN_USER = "debian"
DEBIAN_PASSWORD = "123"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(DEBIAN_HOST, username=DEBIAN_USER, password=DEBIAN_PASSWORD, timeout=5)

setup_script = f"""
mkdir -p ~/.orchai/bin
cd ~/.orchai/bin
echo "{DEBIAN_PASSWORD}" | sudo -S apt-get update
echo "{DEBIAN_PASSWORD}" | sudo -S apt-get install -y build-essential cmake git
if [ ! -d "llama.cpp" ]; then
    git clone https://github.com/ggerganov/llama.cpp.git
fi
cd llama.cpp
git checkout b3394
mkdir -p build
cd build
cmake .. -DGGML_RPC=ON
make rpc-server -j4 || make ggml-rpc-server -j4 || make llama-rpc-server -j4
find . -name "*rpc-server" -type f -exec cp {{}} ~/.orchai/bin/llama-rpc-server \\;
"""

stdin, stdout, stderr = ssh.exec_command(setup_script)
print("STDOUT:")
print(stdout.read().decode())
print("STDERR:")
print(stderr.read().decode())
ssh.close()
