"""
Model Library router for ORCHAI.

Provides a single place to discover, download, and remove local LLMs so the user
can manage disk space. Everything routes through the Ollama HTTP API (the same
way the rest of the backend talks to Ollama) — we never shell out to the CLI, so
this works regardless of whether `ollama` is on PATH.

Hugging Face integration uses Ollama's native `hf.co/<repo>:<quant>` pull, which:
  * needs no HF token for public GGUF repos,
  * lets Ollama handle disk layout / dedup, and
  * makes downloaded models show up in the normal model list automatically.

Endpoints (mounted at /api/models):
  GET  /installed              -> list installed models with human-readable sizes
  POST /delete                 -> remove an installed model to reclaim disk
  GET  /hf/search?query=       -> search Hugging Face for GGUF repos
  GET  /hf/files?repo=         -> list GGUF quantizations available in a repo
  POST /pull                   -> stream download progress (NDJSON) via Ollama
"""

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import asyncio
import json
import os
import re
import ssl

import httpx

OLLAMA_BASE_URL = "http://127.0.0.1:11434"
HF_API_URL = "https://huggingface.co/api"

# Verify HTTPS (Hugging Face) against the OS trust store when possible. On Windows
# this picks up corporate/AV TLS-interception root CAs that certifi's bundle lacks,
# which otherwise cause "unable to get local issuer certificate" failures. Falls
# back to httpx's default (certifi) if truststore isn't available.
try:
    import truststore
    _HF_SSL = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
except Exception:
    _HF_SSL = True

router = APIRouter()

# Matches the quantization token at the end of a GGUF filename, e.g.
# "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf" -> "Q4_K_M".
_QUANT_RE = re.compile(r"(?:^|[-_])(IQ[1-4]_[A-Z]+|Q[2-8]_[A-Z0-9]+(?:_[A-Z]+)?|BF16|F16|F32)(?:[-_.]|$)", re.IGNORECASE)
# Detects a split/multi-part GGUF shard, e.g. "...-00001-of-00003.gguf".
_SHARD_RE = re.compile(r"-\d{5}-of-\d{5}", re.IGNORECASE)


def _friendly_name(repo_id: str) -> str:
    """
    Turn a technical HF repo id into a readable model name for display.
    e.g. "unsloth/SmolLM2-135M-Instruct-GGUF" -> "SmolLM2 135M Instruct"
         "bartowski/Qwen2.5-3B-Instruct-GGUF" -> "Qwen2.5 3B Instruct"
    The original repo id is kept elsewhere for power users and for pulling.
    """
    name = repo_id.split("/")[-1] if "/" in repo_id else repo_id
    # Drop noisy quant/format suffixes that don't help a human scan the list.
    for junk in ("-GGUF", "_GGUF", ".GGUF", "-gguf", "-i1", "-IMat", "-imatrix"):
        if name.lower().endswith(junk.lower()):
            name = name[: -len(junk)]
    name = name.replace("-", " ").replace("_", " ")
    name = re.sub(r"\s+", " ", name).strip()
    return name or repo_id


def _human_size(num_bytes) -> str:
    """Format a byte count as a compact human-readable string."""
    try:
        size = float(num_bytes)
    except (TypeError, ValueError):
        return "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024.0:
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024.0
    return f"{size:.1f} PB"


# ─────────────────────────────── Installed ────────────────────────────────

async def _model_capabilities(client, name: str) -> list:
    """
    Return Ollama's capability list for a model via /api/show, e.g.
    ["completion", "tools", "thinking", "vision"] or ["embedding"].
    Returns [] if it can't be determined (older Ollama / error).
    """
    try:
        r = await client.post(f"{OLLAMA_BASE_URL}/api/show", json={"name": name})
        if r.status_code == 200:
            caps = r.json().get("capabilities", []) or []
            if isinstance(caps, list):
                return [str(c) for c in caps]
    except Exception:
        pass
    return []


@router.get("/installed")
async def list_installed_models():
    """Return locally installed Ollama models with size, metadata + capabilities."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if res.status_code != 200:
                return {"models": [], "error": f"Ollama returned status {res.status_code}"}
            data = res.json()
            raw = data.get("models", [])

            # Fetch capabilities for every model in parallel so we can tell which
            # ones actually support chat (generation) vs. embedding-only models.
            caps_list = await asyncio.gather(
                *(_model_capabilities(client, m.get("name", "")) for m in raw)
            )

            models = []
            total_bytes = 0
            for m, caps in zip(raw, caps_list):
                size = m.get("size", 0) or 0
                total_bytes += size
                details = m.get("details", {}) or {}
                # A model can chat if it can generate ("completion"). Embedding-only
                # models report ["embedding"] with no completion → not chat-usable.
                # When caps is empty (unknown), default to True to avoid false alarms.
                can_chat = ("completion" in caps) if caps else True
                if caps and "embedding" in caps and "completion" not in caps:
                    can_chat = False
                models.append({
                    "name": m.get("name", ""),
                    "size_bytes": size,
                    "size_human": _human_size(size),
                    "parameter_size": details.get("parameter_size", ""),
                    "quantization": details.get("quantization_level", ""),
                    "family": details.get("family", ""),
                    "modified_at": m.get("modified_at", ""),
                    "capabilities": caps,
                    "can_chat": can_chat,
                    "supports_tools": "tools" in caps,
                    "supports_vision": "vision" in caps,
                    "supports_thinking": "thinking" in caps,
                })
            models.sort(key=lambda x: x["size_bytes"], reverse=True)
            return {
                "models": models,
                "total_bytes": total_bytes,
                "total_human": _human_size(total_bytes),
            }
    except httpx.ConnectError:
        return {"models": [], "error": "Ollama is not running. Start it and try again."}
    except Exception as e:
        return {"models": [], "error": str(e)}


class DeleteRequest(BaseModel):
    name: str


@router.post("/delete")
async def delete_model(payload: DeleteRequest):
    """Delete an installed model to reclaim disk space."""
    name = (payload.name or "").strip()
    if not name:
        return {"success": False, "error": "No model name provided."}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Ollama's delete is DELETE with a JSON body, which httpx supports via request().
            res = await client.request(
                "DELETE",
                f"{OLLAMA_BASE_URL}/api/delete",
                json={"name": name},
            )
            if res.status_code == 200:
                return {"success": True, "message": f"Deleted {name}."}
            if res.status_code == 404:
                return {"success": False, "error": f"Model '{name}' not found."}
            return {"success": False, "error": f"Ollama returned status {res.status_code}: {res.text}"}
    except httpx.ConnectError:
        return {"success": False, "error": "Ollama is not running. Start it and try again."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ────────────────────────────── Hugging Face ──────────────────────────────

@router.get("/hf/search")
async def search_huggingface(query: str = "", limit: int = 20):
    """Search Hugging Face for GGUF model repos compatible with Ollama."""
    q = (query or "").strip()
    try:
        params = {
            "filter": "gguf",
            "sort": "downloads",
            "direction": "-1",
            "limit": str(max(1, min(limit, 50))),
        }
        if q:
            params["search"] = q
        async with httpx.AsyncClient(timeout=15.0, verify=_HF_SSL) as client:
            res = await client.get(f"{HF_API_URL}/models", params=params)
            if res.status_code != 200:
                return {"results": [], "error": f"Hugging Face returned status {res.status_code}"}
            data = res.json()
            results = []
            for m in data:
                repo_id = m.get("id", "")
                if not repo_id:
                    continue
                results.append({
                    "repo": repo_id,
                    "display_name": _friendly_name(repo_id),
                    "author": repo_id.split("/")[0] if "/" in repo_id else "",
                    "downloads": m.get("downloads", 0),
                    "likes": m.get("likes", 0),
                    "pipeline_tag": m.get("pipeline_tag", ""),
                    "updated_at": m.get("createdAt", ""),
                })
            return {"results": results}
    except httpx.ConnectError:
        return {"results": [], "error": "Could not reach Hugging Face. Check your connection."}
    except Exception as e:
        return {"results": [], "error": str(e)}


@router.get("/hf/files")
async def list_huggingface_files(repo: str = ""):
    """List the downloadable GGUF quantizations for a Hugging Face repo."""
    repo = (repo or "").strip().strip("/")
    if not repo or "/" not in repo:
        return {"files": [], "error": "Invalid repo id (expected 'author/name')."}
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, verify=_HF_SSL) as client:
            res = await client.get(f"{HF_API_URL}/models/{repo}/tree/main", params={"recursive": "true"})
            if res.status_code == 404:
                return {"files": [], "error": f"Repo '{repo}' not found on Hugging Face."}
            if res.status_code != 200:
                return {"files": [], "error": f"Hugging Face returned status {res.status_code}"}
            entries = res.json()
            files = []
            for entry in entries:
                path = entry.get("path", "")
                if not path.lower().endswith(".gguf"):
                    continue
                if _SHARD_RE.search(path):
                    # Split GGUFs need special handling; skip to keep pulls reliable.
                    continue
                filename = path.split("/")[-1]
                stem = filename[:-5]  # strip ".gguf"
                match = _QUANT_RE.search(stem)
                quant = match.group(1) if match else "latest"
                lfs = entry.get("lfs") or {}
                size = lfs.get("size") or entry.get("size") or 0
                files.append({
                    "filename": filename,
                    "quant": quant,
                    "size_bytes": size,
                    "size_human": _human_size(size),
                    # Ollama model string to pull this exact quantization.
                    "pull_model": f"hf.co/{repo}:{quant}",
                })
            files.sort(key=lambda x: x["size_bytes"])
            return {"files": files, "repo": repo}
    except httpx.ConnectError:
        return {"files": [], "error": "Could not reach Hugging Face. Check your connection."}
    except Exception as e:
        return {"files": [], "error": str(e)}


# ──────────────────────────────── Pull ────────────────────────────────────

class PullRequest(BaseModel):
    model: str


@router.post("/pull")
async def pull_model(payload: PullRequest):
    """
    Stream download progress for a model pull as newline-delimited JSON.

    Each line is one Ollama progress event, e.g.
      {"status": "pulling manifest"}
      {"status": "pulling <digest>", "total": 123, "completed": 45, "percent": 36.6}
      {"status": "success", "done": true}
    The frontend reads this stream to render a live progress bar.
    """
    model = (payload.model or "").strip()

    async def event_stream():
        if not model:
            yield json.dumps({"status": "error", "error": "No model specified.", "done": True}) + "\n"
            return

        # Check if the model name component exceeds 80 characters
        is_custom = False
        author = ""
        repo_name = ""
        quant = "latest"
        
        if model.startswith("hf.co/"):
            try:
                path_part = model[len("hf.co/"):]
                if ":" in path_part:
                    repo_part, quant = path_part.rsplit(":", 1)
                else:
                    repo_part = path_part
                    quant = "latest"
                
                if "/" in repo_part:
                    author, repo_name = repo_part.split("/", 1)
                    if len(repo_name) > 80:
                        is_custom = True
            except Exception:
                pass

        if is_custom:
            temp_filepath = None
            try:
                # 1. Resolve file on Hugging Face
                headers = {"User-Agent": "Mozilla/5.0"}
                async with httpx.AsyncClient(timeout=15.0, verify=_HF_SSL) as client:
                    hf_res = await client.get(
                        f"https://huggingface.co/api/models/{author}/{repo_name}/tree/main",
                        params={"recursive": "true"},
                        headers=headers
                    )
                    if hf_res.status_code != 200:
                        yield json.dumps({
                            "status": "error",
                            "error": f"Hugging Face API returned {hf_res.status_code}: {hf_res.text[:100]}",
                            "done": True
                        }) + "\n"
                        return
                    files_list = hf_res.json()
                
                target_file = None
                for entry in files_list:
                    path = entry.get("path", "")
                    if not path.lower().endswith(".gguf"):
                        continue
                    if _SHARD_RE.search(path):
                        continue
                    filename = path.split("/")[-1]
                    stem = filename[:-5]
                    match = _QUANT_RE.search(stem)
                    file_quant = match.group(1) if match else "latest"
                    if file_quant.lower() == quant.lower():
                        target_file = entry
                        break
                
                if not target_file:
                    yield json.dumps({
                        "status": "error",
                        "error": f"Could not find a GGUF file for quantization '{quant}' in repository.",
                        "done": True
                    }) + "\n"
                    return
                
                filename = target_file.get("path")
                lfs = target_file.get("lfs") or {}
                digest = lfs.get("oid")
                size = lfs.get("size") or target_file.get("size") or 0
                
                if not digest:
                    yield json.dumps({
                        "status": "error",
                        "error": "The GGUF file is not tracked by LFS (no SHA256 digest found).",
                        "done": True
                    }) + "\n"
                    return
                
                # 2. Check if the blob already exists in Ollama
                async with httpx.AsyncClient(timeout=10.0) as client:
                    try:
                        blob_check = await client.head(f"{OLLAMA_BASE_URL}/api/blobs/sha256:{digest}")
                        blob_exists = blob_check.status_code == 200
                    except Exception:
                        blob_exists = False
                
                # 3. Create truncated model name
                truncated_repo = repo_name[:70].rstrip(".-_")
                custom_model_name = f"hf.co/{author}/{truncated_repo}:{quant}"
                
                if not blob_exists:
                    # 4. Stream Download from Hugging Face
                    download_url = f"https://huggingface.co/{author}/{repo_name}/resolve/main/{filename}"
                    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    downloads_dir = os.path.join(backend_dir, "downloads")
                    os.makedirs(downloads_dir, exist_ok=True)
                    temp_filepath = os.path.join(downloads_dir, f"{digest}.gguf")
                    
                    completed = 0
                    async with httpx.AsyncClient(follow_redirects=True, timeout=None, verify=_HF_SSL) as dl_client:
                        async with dl_client.stream("GET", download_url, headers=headers) as dl_res:
                            if dl_res.status_code != 200:
                                raise Exception(f"Hugging Face download returned status {dl_res.status_code}")
                            total_size = int(dl_res.headers.get("content-length", 0)) or size
                            with open(temp_filepath, "wb") as f:
                                async for chunk in dl_res.aiter_bytes(chunk_size=1024*1024):
                                    f.write(chunk)
                                    completed += len(chunk)
                                    percent = round(completed / total_size * 100, 1) if total_size else 0.0
                                    yield json.dumps({
                                        "status": f"Downloading GGUF ({_human_size(completed)} / {_human_size(total_size)})...",
                                        "completed": completed,
                                        "total": total_size,
                                        "percent": percent
                                    }) + "\n"
                    
                    # 5. Upload blob to Ollama
                    yield json.dumps({
                        "status": "Registering model blob with Ollama (this may take a few seconds)...",
                        "completed": total_size,
                        "total": total_size,
                        "percent": 99.0
                    }) + "\n"
                    
                    async def file_sender():
                        with open(temp_filepath, "rb") as f:
                            while True:
                                chunk = f.read(1024*1024)
                                if not chunk:
                                    break
                                yield chunk
                    
                    async with httpx.AsyncClient(timeout=None) as client:
                        r = await client.post(
                            f"{OLLAMA_BASE_URL}/api/blobs/sha256:{digest}",
                            content=file_sender()
                        )
                        if r.status_code not in (200, 201):
                            raise Exception(f"Failed to upload blob to Ollama: {r.text}")
                
                # 6. Create model in Ollama
                yield json.dumps({
                    "status": "Creating model in Ollama...",
                    "percent": 99.5
                }) + "\n"
                
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream(
                        "POST",
                        f"{OLLAMA_BASE_URL}/api/create",
                        json={
                            "model": custom_model_name,
                            "files": {
                                "model.gguf": f"sha256:{digest}"
                            },
                            "stream": True
                        }
                    ) as create_res:
                        if create_res.status_code != 200:
                            raise Exception(f"Ollama create API returned status {create_res.status_code}")
                        async for line in create_res.aiter_lines():
                            if not line.strip():
                                continue
                            try:
                                evt = json.loads(line)
                                if evt.get("status") == "success":
                                    evt["done"] = True
                                yield json.dumps(evt) + "\n"
                            except Exception:
                                yield line + "\n"
                                
            except Exception as e:
                yield json.dumps({"status": "error", "error": str(e), "done": True}) + "\n"
            finally:
                if temp_filepath and os.path.exists(temp_filepath):
                    try:
                        os.remove(temp_filepath)
                    except Exception:
                        pass
            return

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/pull",
                    json={"model": model, "stream": True},
                ) as res:
                    if res.status_code != 200:
                        body = await res.aread()
                        detail = body.decode("utf-8", "ignore")[:200]
                        yield json.dumps({
                            "status": "error",
                            "error": f"Ollama returned status {res.status_code}: {detail}",
                            "done": True,
                        }) + "\n"
                        return
                    async for line in res.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            evt = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        total = evt.get("total")
                        completed = evt.get("completed")
                        if total and completed is not None:
                            evt["percent"] = round(completed / total * 100, 1)
                        if evt.get("status") == "success":
                            evt["done"] = True
                        if "error" in evt:
                            evt["done"] = True
                        yield json.dumps(evt) + "\n"
        except httpx.ConnectError:
            yield json.dumps({
                "status": "error",
                "error": "Ollama is not running. Start it and try again.",
                "done": True,
            }) + "\n"
        except Exception as e:
            yield json.dumps({"status": "error", "error": str(e), "done": True}) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")
