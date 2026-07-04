from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
import json
import httpx
import asyncio
import sys
import os
import math
from typing import List, Dict, Any, Optional
from api.context_engine import ContextOrchestrator, estimate_tokens

# Ensure the backend root (which holds top-level modules like skills, sub_agents,
# web_research, system_tools) is importable regardless of the working directory.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

router = APIRouter()

OLLAMA_BASE_URL = "http://127.0.0.1:11434"

# Store orchestrators by session_id
orchestrators: Dict[str, ContextOrchestrator] = {}

# Tool sandboxing state
tool_approval_events: Dict[str, asyncio.Event] = {}
tool_approval_results: Dict[str, bool] = {}


def get_orchestrator(session_id: str) -> ContextOrchestrator:
    """Retrieve or create a ContextOrchestrator for the given session ID."""
    if not session_id:
        session_id = "default"
    if session_id not in orchestrators:
        orchestrators[session_id] = ContextOrchestrator(session_id=session_id, ollama_url=OLLAMA_BASE_URL)
    return orchestrators[session_id]


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        try:
            from starlette.websockets import WebSocketState
            if websocket.application_state == WebSocketState.CONNECTED:
                await websocket.send_text(message)
        except Exception:
            pass

manager = ConnectionManager()


# ── Models for API endpoints ──

class WorldStateUpdate(BaseModel):
    session_id: str
    world_state: str


class SensoryContextUpdate(BaseModel):
    session_id: str
    sensory_context: str


class ConfigUpdate(BaseModel):
    session_id: str
    active_window_limit: int
    dynamic_consolidation: bool
    semantic_recall: bool
    dynamic_persona: Optional[bool] = None


class PersonaUpdate(BaseModel):
    session_id: str
    persona_state: str
    dynamic_persona: Optional[bool] = None



class SearchQuery(BaseModel):
    session_id: str
    query: str


class ClearRequest(BaseModel):
    session_id: str


class BranchRequest(BaseModel):
    source_session_id: str
    new_session_id: str
    up_to_message_id: str


class GenerateTitleRequest(BaseModel):
    session_id: str
    model: str
    first_message: str


# ── REST API Routes ──

@router.get("/skills")
async def list_skills():
    """Return the catalog of selectable functional skills for the frontend."""
    try:
        from skills import get_public_skills
        return {"skills": get_public_skills()}
    except ImportError:
        return {"skills": []}


@router.get("/world-state")
async def get_world_state(session_id: str = "default"):
    """Retrieve the current consolidated memory state for a session."""
    orch = get_orchestrator(session_id)
    return {
        "world_state": orch.world_state,
        "persona_state": orch.persona_state,
        "stats": orch.get_stats(),
        "config": {
            "active_window_limit": orch.active_window_limit,
            "dynamic_consolidation": orch.dynamic_consolidation,
            "semantic_recall": orch.semantic_recall,
            "dynamic_persona": orch.dynamic_persona
        }
    }


@router.post("/world-state")
async def update_world_state(payload: WorldStateUpdate):
    """Manually update or edit the model's consolidated World State for a session."""
    orch = get_orchestrator(payload.session_id)
    orch.world_state = payload.world_state
    return {
        "status": "success",
        "world_state": orch.world_state,
        "stats": orch.get_stats()
    }


@router.post("/world-state/sensory")
async def update_sensory_context(payload: SensoryContextUpdate):
    """Inject real-time sensory data (e.g. from the screen watcher) into the context."""
    orch = get_orchestrator(payload.session_id)
    orch.sensory_context = payload.sensory_context
    return {
        "status": "success"
    }


@router.post("/config")
async def update_config(payload: ConfigUpdate):
    """Update context limits and toggles dynamically for a session."""
    orch = get_orchestrator(payload.session_id)
    # Support dynamic_persona fallback if not provided
    dp = payload.dynamic_persona if payload.dynamic_persona is not None else orch.dynamic_persona
    orch.set_config(
        active_window_limit=payload.active_window_limit,
        dynamic_consolidation=payload.dynamic_consolidation,
        semantic_recall=payload.semantic_recall,
        dynamic_persona=dp
    )
    return {
        "status": "success",
        "config": {
            "active_window_limit": orch.active_window_limit,
            "dynamic_consolidation": orch.dynamic_consolidation,
            "semantic_recall": orch.semantic_recall,
            "dynamic_persona": orch.dynamic_persona
        },
        "stats": orch.get_stats()
    }


@router.post("/persona")
async def update_persona(payload: PersonaUpdate):
    """Manually update or edit the model's evolved character/persona guidelines."""
    orch = get_orchestrator(payload.session_id)
    orch.persona_state = payload.persona_state
    if payload.dynamic_persona is not None:
        orch.dynamic_persona = payload.dynamic_persona
    return {
        "status": "success",
        "persona_state": orch.persona_state,
        "dynamic_persona": orch.dynamic_persona,
        "stats": orch.get_stats()
    }


@router.post("/search")
async def search_memories(payload: SearchQuery):
    """Search episodic long-term memories in the session's BM25 index."""
    orch = get_orchestrator(payload.session_id)
    results = orch.index.search(payload.query, top_k=5)
    return {"results": results}


@router.post("/branch")
async def branch_chat(payload: BranchRequest):
    """Branch session orchestrator history and memory states."""
    source_orch = get_orchestrator(payload.source_session_id)
    new_orch = get_orchestrator(payload.new_session_id)
    new_orch.branch_from(source_orch, payload.up_to_message_id)
    return {"status": "success", "message": f"Session branched to {payload.new_session_id}"}


@router.post("/clear")
async def clear_chat(payload: ClearRequest):
    """Reset session orchestrator history and memory states."""
    if payload.session_id in orchestrators:
        orchestrators[payload.session_id].reset()
        del orchestrators[payload.session_id]
    return {"status": "success", "message": f"Session {payload.session_id} reset successful"}


@router.post("/generate-title")
async def generate_chat_title(payload: GenerateTitleRequest):
    """Generate a clean, context-appropriate 2-4 word title using the selected LLM."""
    prompt = (
        f"Generate a brief, fitting title for a conversation that starts with this message:\n"
        f"\"{payload.first_message}\"\n\n"
        f"Instructions:\n"
        f"1. The title must be highly descriptive and strictly between 2 to 4 words.\n"
        f"2. Output ONLY the plain title text. Do not wrap it in quotes, do not add a period, and do not add any explanation."
    )
    
    ollama_payload = {
        "model": payload.model,
        "messages": [
            {"role": "system", "content": "You are a precise title generator. You only output plain 2-4 words, nothing else."},
            {"role": "user", "content": prompt}
        ],
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": -1
        },
        "think": True
    }
    
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json=ollama_payload
            )
            if response.status_code == 200:
                data = response.json()
                title_text = data.get("message", {}).get("content", "").strip()
                
                # Remove <think> blocks if present
                if "</think>" in title_text:
                    title_text = title_text.split("</think>")[-1].strip()
                else:
                    import re
                    title_text = re.sub(r'<think>.*?</think>', '', title_text, flags=re.DOTALL).strip()
                
                # Remove common prefixes
                if title_text.lower().startswith("title:"):
                    title_text = title_text[6:].strip()
                elif title_text.lower().startswith("title "):
                    title_text = title_text[6:].strip()

                # Clean up any surrounding quotes or whitespace
                title_text = title_text.replace('"', '').replace("'", "").strip()
                
                # Truncate if it's still too long (e.g. model ignored instructions)
                if len(title_text) > 40:
                    title_text = title_text[:37] + "..."
                    
                if title_text:
                    return {"title": title_text}
            else:
                print(f"Ollama returned non-200 status for title generation: {response.status_code}")
            
            # Safe slice fallback
            sliced = payload.first_message.strip()[:20] + "..."
            return {"title": sliced}
    except Exception as e:
        print(f"Error generating chat title: {repr(e)}")
        sliced = payload.first_message.strip()[:20] + "..."
        return {"title": sliced}


# ── WebSocket Chat Handler with Orchestration ──

def get_available_tools():
    return [
        {
            "type": "function",
            "function": {
                "name": "delegate_to_subagent",
                "description": "Delegates a highly complex, multi-step task to a specialized sub-agent. Use ONLY for comprehensive research tasks that require many steps. For simple, single-step queries, use direct tools (e.g. search_web) instead.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "role": {
                            "type": "string",
                            "description": "The role of the sub-agent (e.g., 'web-researcher')."
                        },
                        "task": {
                            "type": "string",
                            "description": "The detailed task for the sub-agent to accomplish."
                        }
                    },
                    "required": ["role", "task"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_web",
                "description": "Searches the web for a query and returns titles, links, and snippets. Use this for simple web queries instead of a sub-agent.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "The search query."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "scrape_page",
                "description": "Scrapes and cleans the text content of a given URL. Use this directly for reading web pages instead of a sub-agent.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "The URL to scrape."}
                    },
                    "required": ["url"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_system_info",
                "description": "Returns detailed system information including current local time, date, timezone, OS, processor, and Python version.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Safely reads and returns the contents of a text file from the local file system.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filepath": {
                            "type": "string",
                            "description": "The absolute or relative path to the file to read."
                        }
                    },
                    "required": ["filepath"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Writes or overwrites a file with the provided content. To display this file as an Artifact in the user interface, you MUST provide the ArtifactMetadata object.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filepath": {
                            "type": "string",
                            "description": "The path to the file to write."
                        },
                        "content": {
                            "type": "string",
                            "description": "The content to write into the file."
                        },
                        "ArtifactMetadata": {
                            "type": "object",
                            "description": "Optional metadata to display this file as an Artifact in the UI.",
                            "properties": {
                                "Summary": {
                                    "type": "string",
                                    "description": "A summary of what this artifact is."
                                },
                                "UserFacing": {
                                    "type": "boolean",
                                    "description": "Whether this should be presented to the user."
                                },
                                "RequestFeedback": {
                                    "type": "boolean",
                                    "description": "Whether to request feedback."
                                }
                            }
                        }
                    },
                    "required": ["filepath", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "append_file",
                "description": "Appends content to the end of an existing file, creating it if it doesn't exist.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filepath": {
                            "type": "string",
                            "description": "The path to the file to append to."
                        },
                        "content": {
                            "type": "string",
                            "description": "The content to append."
                        }
                    },
                    "required": ["filepath", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "checkpoint_session",
                "description": "Flushes the active context window to bypass token limits during massive workflows. This archives all history up to this point and re-prompts you with next_action.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "world_state": {
                            "type": "string",
                            "description": "High-level summary of what has been accomplished so far to update the World State."
                        },
                        "next_action": {
                            "type": "string",
                            "description": "The exact instruction you want to feed to yourself for the very next step."
                        }
                    },
                    "required": ["world_state", "next_action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_directory",
                "description": "Lists all files and folders in a given directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "The directory path to list."
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "Executes a PowerShell command on the Windows host and returns the output. DO NOT use Unix commands like curl or grep. Use Invoke-RestMethod for web requests.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The command line string to execute."
                        }
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "run_python_script",
                "description": "Executes a Python script securely. Requires user approval.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "script_path": {
                            "type": "string",
                            "description": "The path to the Python script to execute."
                        },
                        "args": {
                            "type": "string",
                            "description": "Optional arguments to pass to the script."
                        }
                    },
                    "required": ["script_path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "send_http_request",
                "description": "Sends an HTTP request.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "method": {
                            "type": "string",
                            "description": "The HTTP method (GET, POST, PUT, DELETE, etc.)."
                        },
                        "url": {
                            "type": "string",
                            "description": "The target URL."
                        },
                        "headers": {
                            "type": "string",
                            "description": "Optional JSON string of headers."
                        },
                        "body": {
                            "type": "string",
                            "description": "Optional request body string."
                        }
                    },
                    "required": ["method", "url"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "manage_git_repo",
                "description": "Executes safe Git operations. Requires user approval.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "repo_path": {
                            "type": "string",
                            "description": "The path to the Git repository."
                        },
                        "action": {
                            "type": "string",
                            "description": "The action to perform: status, add, commit, push, pull, checkout, clone."
                        },
                        "commit_message": {
                            "type": "string",
                            "description": "Required for commit action."
                        },
                        "branch": {
                            "type": "string",
                            "description": "Required for checkout action."
                        },
                        "url": {
                            "type": "string",
                            "description": "Required for clone action."
                        }
                    },
                    "required": ["repo_path", "action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "query_database",
                "description": "Executes a SQL query against an SQLite database. Requires user approval.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "db_path": {
                            "type": "string",
                            "description": "The path to the SQLite database file."
                        },
                        "query": {
                            "type": "string",
                            "description": "The SQL query to execute."
                        }
                    },
                    "required": ["db_path", "query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_memory_bank",
                "description": "Searches the archived conversation memory using semantic/keyword retrieval (BM25) to recall specific facts, user details, past instructions, or code snippets from older parts of the conversation that are no longer in the active window.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The semantic query or keywords to search for in your archived memories."
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_persona",
                "description": "Retrieves your own current dynamic character traits, voice styles, and evolution settings. Use this to review how your persona is currently defined.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_persona",
                "description": "Updates your own character traits, instructions, style, and rules. Use this to evolve, redefine yourself, or alter your behavioral constraints as you wish.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "persona_state": {
                            "type": "string",
                            "description": "The complete revised character/persona markdown block starting with '### EVOLVING AGENT CHARACTER & STYLE'."
                        },
                        "dynamic_persona": {
                            "type": "boolean",
                            "description": "Set to true to keep learning and evolving automatically, or false to lock current traits."
                        }
                    },
                    "required": ["persona_state"]
                }
            }
        }
    ]

async def stream_ollama_response(payload: dict, websocket: WebSocket):
    """Orchestrates incoming chat request, executes RAG/Consolidation, and streams back token chunks."""
    session_id = payload.get("session_id", "default")
    model = payload.get("model", "north-mini-code-1.0:q4_K_M")
    raw_messages = payload.get("messages", [])
    options = payload.get("options", {})

    orch = get_orchestrator(session_id)

    # 1. Sync orchestrator's local history with the incoming messages array
    orch.sync_frontend_state(raw_messages)

    # 2. Get last user query to perform semantic retrieval
    last_user_query = ""
    for msg in reversed(raw_messages):
        if msg.get("role") == "user":
            last_user_query = msg.get("content", "")
            break

    # 3. Intercept & Orchestrate: Build optimal context prompt

    tools = get_available_tools()
    
    # Detect model capabilities once
    model_supports_tools = True
    model_supports_thinking = True
    try:
        import httpx
        async with httpx.AsyncClient() as c:
            show_res = await c.post(f"{OLLAMA_BASE_URL}/api/show", json={"name": model})
            if show_res.status_code == 200:
                caps = show_res.json().get("capabilities", []) or []
                if isinstance(caps, list) and caps:
                    model_supports_tools = "tools" in caps
                    model_supports_thinking = "thinking" in caps
    except Exception:
        pass

    # 3. Intercept & Orchestrate: Build optimal context prompt
    orchestrated_messages = orch.build_orchestrated_prompt(last_user_query, model_supports_tools=model_supports_tools, tools=tools)

    # 3b. Detect activated skills from the latest user message and inject their
    # specialized methodology into the system prompt for this turn only.
    try:
        from skills import detect_active_skills, build_skill_injection
        active_skill_ids = detect_active_skills(last_user_query)
        if active_skill_ids and orchestrated_messages and orchestrated_messages[0].get("role") == "system":
            orchestrated_messages[0]["content"] += build_skill_injection(active_skill_ids)
    except ImportError:
        pass

    # We will let Ollama automatically calculate the best layer offload (num_gpu).
    # However, Ollama's default context size is 2048, which truncates web-scraped content.
    # Dynamically calculate context size based on actual prompt requirements
    merged_options = dict(options) if options else {}
    if "num_predict" not in merged_options:
        merged_options["num_predict"] = -1

    if "num_ctx" not in merged_options:
        # Sum estimated tokens across all messages
        total_prompt_tokens = sum(estimate_tokens(msg.get("content", "")) for msg in orchestrated_messages)
        # Factor in expected generation length (buffer + max tokens if provided)
        num_predict = merged_options.get("num_predict", 4096)
        if num_predict < 0:
            num_predict = 32768
        target_ctx = total_prompt_tokens + num_predict + 1024 # Add 1k token safety buffer
        
        # Round up to nearest power of 2 for memory efficiency, with min 4096 and max 131072
        power_of_2 = 2 ** math.ceil(math.log2(max(target_ctx, 4096)))
        merged_options["num_ctx"] = min(power_of_2, 131072)
    
    # Define available tools

    # Note: Skills are activated via [Skill: <label>] markers in the user message,
    # which are detected and injected into the system prompt (see detect_active_skills).
    # There is no apply_skill tool — skills are behavioral, not data.

    msg_id = f"msg-{id(payload)}"

    # Safely import the sub_agents module
    try:
        import sys
        import os
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if backend_dir not in sys.path:
            sys.path.append(backend_dir)
        from sub_agents import delegate_to_subagent
        from web_research import search_web, scrape_page
    except ImportError:
        delegate_to_subagent = None
        search_web = None
        scrape_page = None

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=None, write=None, pool=None)) as client:
            chronological_thinking_segments = []

            async def _execute_tool(func_name: str, func_args: dict) -> str:
                import uuid
                tool_msg_id = f"tool-{uuid.uuid4().hex[:8]}"
                if func_name == "delegate_to_subagent":
                    role = func_args.get("role", "")
                    task = func_args.get("task", "")
                    
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "args": {"role": role, "task": task}
                        }),
                        websocket,
                    )
                    
                    if delegate_to_subagent:
                        return await delegate_to_subagent(role, task, model=model)
                    return "Error: sub_agents module could not be loaded."
                    
                elif func_name == "get_persona":
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "args": {}
                        }),
                        websocket,
                    )
                    return json.dumps({
                        "persona_state": orch.persona_state,
                        "dynamic_persona": orch.dynamic_persona
                    })
                    
                elif func_name == "update_persona":
                    persona_state = func_args.get("persona_state", "")
                    dynamic_persona = func_args.get("dynamic_persona", None)
                    
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "args": {"persona_state": persona_state, "dynamic_persona": dynamic_persona}
                        }),
                        websocket,
                    )
                    orch.persona_state = persona_state
                    if dynamic_persona is not None:
                        orch.dynamic_persona = dynamic_persona
                    return "Persona successfully updated."
                    
                elif func_name == "search_web":
                    query = func_args.get("query", "")
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "args": {"query": query}
                        }),
                        websocket,
                    )
                    if search_web:
                        res = await search_web(query)
                        return json.dumps(res)
                    return "Error: web_research module could not be loaded."
                    
                elif func_name == "scrape_page":
                    url = func_args.get("url", "")
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "args": {"url": url}
                        }),
                        websocket,
                    )
                    if scrape_page:
                        return await scrape_page(url)
                    return "Error: web_research module could not be loaded."
                    
                elif func_name == "get_system_info":
                    import datetime
                    import platform
                    import sys
                    try:
                        import psutil
                        ram = psutil.virtual_memory()
                        ram_info = f"RAM: {round(ram.total / (1024**3), 2)} GB Total ({round(ram.available / (1024**3), 2)} GB Available)"
                    except ImportError:
                        ram_info = "RAM: Information unavailable (psutil not installed)"
                        
                    time_str = datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
                    os_info = f"{platform.system()} {platform.release()} (Version: {platform.version()})"
                    
                    info = [
                        f"Current System Time: {time_str}",
                        f"OS: {os_info}",
                        f"Architecture: {platform.machine()}",
                        f"Processor: {platform.processor()}",
                        f"Python Version: {sys.version.split()[0]}",
                        ram_info
                    ]
                    return "System Information:\\n" + "\\n".join(info)
                    
                elif func_name == "run_command":
                    command = func_args.get("command", "")
                    tool_approval_events[tool_msg_id] = asyncio.Event()
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_approval_request",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "command": command
                        }),
                        websocket
                    )
                    await tool_approval_events[tool_msg_id].wait()
                    approved = tool_approval_results.get(tool_msg_id, False)
                    del tool_approval_events[tool_msg_id]
                    if tool_msg_id in tool_approval_results:
                        del tool_approval_results[tool_msg_id]
                        
                    if not approved:
                        return f"Error: User denied permission to run command: {command}"
                    else:
                        await manager.send_personal_message(
                            json.dumps({
                                "type": "tool_execution",
                                "id": tool_msg_id,
                                "tool": func_name,
                                "args": {"command": command}
                            }),
                            websocket
                        )
                        from system_tools import run_command
                        try:
                            return await asyncio.to_thread(run_command, command)
                        except Exception as e:
                            return f"Error executing {func_name}: {str(e)}"
                            
                elif func_name in ["run_python_script", "manage_git_repo", "query_database"]:
                    tool_approval_events[tool_msg_id] = asyncio.Event()
                    
                    if func_name == "run_python_script":
                        cmd_str = f"python {func_args.get('script_path')} {func_args.get('args', '')}"
                    elif func_name == "manage_git_repo":
                        cmd_str = f"git {func_args.get('action')} on {func_args.get('repo_path')}"
                    elif func_name == "query_database":
                        cmd_str = f"SQL: {func_args.get('query')} on {func_args.get('db_path')}"
                    else:
                        cmd_str = str(func_args)

                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_approval_request",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "command": cmd_str
                        }),
                        websocket
                    )
                    await tool_approval_events[tool_msg_id].wait()
                    approved = tool_approval_results.get(tool_msg_id, False)
                    del tool_approval_events[tool_msg_id]
                    if tool_msg_id in tool_approval_results:
                        del tool_approval_results[tool_msg_id]
                        
                    if not approved:
                        return f"Error: User denied permission to execute {func_name}: {cmd_str}"
                    else:
                        await manager.send_personal_message(
                            json.dumps({
                                "type": "tool_execution",
                                "id": tool_msg_id,
                                "tool": func_name,
                                "args": func_args
                            }),
                            websocket
                        )
                        from system_tools import run_python_script, manage_git_repo, query_database
                        try:
                            if func_name == "run_python_script":
                                return await asyncio.to_thread(run_python_script, func_args.get("script_path", ""), func_args.get("args", ""))
                            elif func_name == "manage_git_repo":
                                return await asyncio.to_thread(manage_git_repo, func_args.get("repo_path", ""), func_args.get("action", ""), func_args.get("commit_message", ""), func_args.get("branch", ""), func_args.get("url", ""))
                            elif func_name == "query_database":
                                return await asyncio.to_thread(query_database, func_args.get("db_path", ""), func_args.get("query", ""))
                        except Exception as e:
                            return f"Error executing {func_name}: {str(e)}"
                            
                elif func_name == "send_http_request":
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "args": func_args
                        }),
                        websocket
                    )
                    from system_tools import send_http_request
                    try:
                        return await asyncio.to_thread(send_http_request, func_args.get("method", "GET"), func_args.get("url", ""), func_args.get("headers", ""), func_args.get("body", ""))
                    except Exception as e:
                        return f"Error executing {func_name}: {str(e)}"

                elif func_name == "checkpoint_session":
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "args": func_args
                        }),
                        websocket
                    )
                    return "Checkpoint initiated."

                elif func_name == "search_memory_bank":
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "args": func_args
                        }),
                        websocket
                    )
                    query = func_args.get("query", "")
                    try:
                        active_msgs, archived_msgs = orch.partition_context()
                        active_ids = [msg["id"] for msg in active_msgs if msg.get("id")]
                        # Retrieve matching memories from the index
                        results = orch.index.search(query, top_k=5, exclude_ids=active_ids)
                        if not results:
                            return "No matching memories found in the archive."
                        
                        formatted = "Found the following old messages in the conversation archive:\n\n"
                        for doc in results:
                            role_label = "USER" if doc["role"] == "user" else "ASSISTANT"
                            formatted += f"-[Archived Turn] {role_label}: {doc['content']}\n"
                        return formatted
                    except Exception as e:
                        return f"Error executing {func_name}: {str(e)}"

                elif func_name in ["read_file", "write_file", "append_file", "list_directory"]:
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": tool_msg_id,
                            "tool": func_name,
                            "args": func_args
                        }),
                        websocket
                    )
                    from system_tools import read_file, write_file, append_file, list_directory
                    try:
                        if func_name == "read_file":
                            return await asyncio.to_thread(read_file, func_args.get("filepath", ""))
                        elif func_name == "write_file":
                            return await asyncio.to_thread(write_file, func_args.get("filepath", ""), func_args.get("content", ""))
                        elif func_name == "append_file":
                            return await asyncio.to_thread(append_file, func_args.get("filepath", ""), func_args.get("content", ""))
                        elif func_name == "list_directory":
                            return await asyncio.to_thread(list_directory, func_args.get("path", ""))
                    except Exception as e:
                        return f"Error executing {func_name}: {str(e)}"
                return f"Error: Tool {func_name} not recognized."

            # Move overall counters outside the loop so tool executions don't reset them
            overall_token_count = 0
            overall_thinking_token_count = 0
            overall_content_token_count = 0
            user_input_tokens = estimate_tokens(last_user_query)
            total_time_spent_generating = 0
            overall_prompt_eval_count = 0
            empty_response_count = 0
            consecutive_tool_iterations = 0
            consecutive_scaffold_iterations = 0
            recent_identical_tool_calls = 0
            last_tool_signature = None

            # Detect model capabilities once. Models pulled from Hugging Face and
            # small models often ship without a tool-calling or thinking template;
            # sending `tools`/`think` to them makes Ollama return 400 Bad Request.
            # Ollama's /api/show reports a `capabilities` list (e.g. ["completion",
            # "tools", "thinking", "vision"]). We only gate when that list is present
            # and non-empty, so older Ollama versions keep the previous behaviour.

            while True:
                if consecutive_tool_iterations > 15 or consecutive_scaffold_iterations > 5:
                    error_msg = "\n\n> [!CRITICAL]\n> **System Error:** The model exceeded the maximum allowed autonomous iterations (Psycho Loop Guard triggered). Generation halted.\n"
                    orch.add_message(role="assistant", content=error_msg)
                    orchestrated_messages.append({"role": "assistant", "content": error_msg})
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "stream",
                            "id": msg_id,
                            "role": "model",
                            "content": error_msg,
                            "done": False,
                            "stats": {
                                "tokens": overall_token_count,
                                "tokens_per_second": 0,
                                "elapsed": round(total_time_spent_generating, 2),
                            }
                        }),
                        websocket,
                    )
                    break

                # 4. Formulate the official Ollama payload
                ollama_payload = {
                    "model": model,
                    "messages": orchestrated_messages,
                    "stream": True,
                    "options": merged_options,
                }
                if model_supports_thinking:
                    ollama_payload["think"] = True
                if model_supports_tools:
                    ollama_payload["tools"] = tools

                full_content = ""
                full_thinking = ""
                full_tool_calls = []
                token_count = 0
                start_time = asyncio.get_event_loop().time()
                first_token_time = None
                
                final_chunk = {}
                final_elapsed = 0
                final_eval_count = 0
                final_tps = 0

                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/chat",
                    json=ollama_payload,
                ) as response:
                    if response.status_code != 200:
                        error_text = await response.aread()
                        error_msg = error_text.decode('utf-8', errors='ignore')
                        try:
                            error_json = json.loads(error_msg)
                            if "error" in error_json:
                                error_msg = error_json["error"]
                        except json.JSONDecodeError:
                            pass
                        raise Exception(f"Ollama returned {response.status_code}: {error_msg}")

                    is_thinking = False
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        if "error" in chunk:
                            raise Exception(chunk["error"])

                        message_data = chunk.get("message", {})
                        
                        if "tool_calls" in message_data:
                            for tc in message_data["tool_calls"]:
                                if tc not in full_tool_calls:
                                    full_tool_calls.append(tc)

                        thinking_token = message_data.get("thinking", "")
                        content_token = message_data.get("content", "")

                        has_token = bool(thinking_token or content_token)
                        if has_token:
                            if first_token_time is None:
                                first_token_time = asyncio.get_event_loop().time()
                            token_count += 1
                            overall_token_count += 1
                            if thinking_token:
                                overall_thinking_token_count += 1
                            if content_token:
                                overall_content_token_count += 1
                        
                        elapsed = asyncio.get_event_loop().time() - start_time
                        current_overall_elapsed = total_time_spent_generating + elapsed
                        tokens_per_sec = overall_token_count / current_overall_elapsed if current_overall_elapsed > 0 else 0

                        if thinking_token:
                            if not is_thinking:
                                is_thinking = True
                                think_start_time = asyncio.get_event_loop().time()
                                full_content += "<think>\n"
                                await manager.send_personal_message(
                                    json.dumps({
                                        "type": "stream",
                                        "id": msg_id,
                                        "role": "model",
                                        "content": "<think>\n",
                                        "done": False,
                                        "stats": {
                                            "tokens": overall_token_count,
                                            "content_tokens": overall_content_token_count,
                                            "thinking_tokens": overall_thinking_token_count,
                                            "user_input_tokens": user_input_tokens,
                                            "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                            "tokens_per_second": round(tokens_per_sec, 1),
                                            "elapsed": round(current_overall_elapsed, 2),
                                        },
                                    }),
                                    websocket,
                                )

                            full_thinking += thinking_token
                            full_content += thinking_token

                            await manager.send_personal_message(
                                json.dumps({
                                    "type": "stream",
                                    "id": msg_id,
                                    "role": "model",
                                    "content": thinking_token,
                                    "done": False,
                                    "stats": {
                                        "tokens": overall_token_count,
                                        "content_tokens": overall_content_token_count,
                                        "thinking_tokens": overall_thinking_token_count,
                                        "user_input_tokens": user_input_tokens,
                                        "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                        "tokens_per_second": round(tokens_per_sec, 1),
                                        "elapsed": round(current_overall_elapsed, 2),
                                    },
                                }),
                                websocket,
                            )

                        if content_token:
                            if is_thinking:
                                is_thinking = False
                                think_elapsed = asyncio.get_event_loop().time() - think_start_time
                                duration_str = f"<!-- duration: {think_elapsed:.2f}s -->"
                                close_tag_content = f"\n{duration_str}\n</think>\n\n"
                                full_content += close_tag_content
                                await manager.send_personal_message(
                                    json.dumps({
                                        "type": "stream",
                                        "id": msg_id,
                                        "role": "model",
                                        "content": close_tag_content,
                                        "done": False,
                                        "stats": {
                                            "tokens": overall_token_count,
                                            "content_tokens": overall_content_token_count,
                                            "thinking_tokens": overall_thinking_token_count,
                                            "user_input_tokens": user_input_tokens,
                                            "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                            "tokens_per_second": round(tokens_per_sec, 1),
                                            "elapsed": round(current_overall_elapsed, 2),
                                        },
                                    }),
                                    websocket,
                                )

                            full_content += content_token

                            await manager.send_personal_message(
                                json.dumps({
                                    "type": "stream",
                                    "id": msg_id,
                                    "role": "model",
                                    "content": content_token,
                                    "done": False,
                                    "stats": {
                                        "tokens": overall_token_count,
                                        "content_tokens": overall_content_token_count,
                                        "thinking_tokens": overall_thinking_token_count,
                                        "user_input_tokens": user_input_tokens,
                                        "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                        "tokens_per_second": round(tokens_per_sec, 1),
                                        "elapsed": round(current_overall_elapsed, 2),
                                    },
                                }),
                                websocket,
                            )

                        if chunk.get("done"):
                            if is_thinking:
                                is_thinking = False
                                think_elapsed = asyncio.get_event_loop().time() - think_start_time
                                duration_str = f"<!-- duration: {think_elapsed:.2f}s -->"
                                close_tag_content = f"\n{duration_str}\n</think>\n\n"
                                full_content += close_tag_content
                                await manager.send_personal_message(
                                    json.dumps({
                                        "type": "stream",
                                        "id": msg_id,
                                        "role": "model",
                                        "content": close_tag_content,
                                        "done": False,
                                        "stats": {
                                            "tokens": overall_token_count,
                                            "content_tokens": overall_content_token_count,
                                            "thinking_tokens": overall_thinking_token_count,
                                            "user_input_tokens": user_input_tokens,
                                            "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                            "tokens_per_second": round(tokens_per_sec, 1),
                                            "elapsed": round(current_overall_elapsed, 2),
                                        },
                                    }),
                                    websocket,
                                )
                            final_chunk = chunk
                            eval_duration = chunk.get("eval_duration", 0)
                            total_duration = chunk.get("total_duration", 0)
                            
                            if eval_duration > 0:
                                final_elapsed = eval_duration / 1e9
                            elif total_duration > 0:
                                final_elapsed = total_duration / 1e9
                            else:
                                final_elapsed = asyncio.get_event_loop().time() - start_time
                                
                            total_time_spent_generating += final_elapsed
                            overall_prompt_eval_count += chunk.get("prompt_eval_count", 0)
                            
                            tokens_per_sec = overall_token_count / total_time_spent_generating if total_time_spent_generating > 0 else 0
                            final_eval_count = overall_token_count
                            final_tps = tokens_per_sec

                                # Generic fallback parsers for models without native tool parsing
                if not full_tool_calls and full_content:
                    import re
                    
                    # 1. XML / Hermes format: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
                    xml_matches = re.finditer(r'<tool_call>\s*(\{.*?\})\s*</tool_call>', full_content, re.DOTALL | re.IGNORECASE)
                    for m in xml_matches:
                        try:
                            t = json.loads(m.group(1))
                            if "name" in t:
                                full_tool_calls.append({"function": {"name": t["name"], "arguments": t.get("arguments", {})}})
                        except: pass

                    # 2. Markdown JSON block fallback: ```json \n {"name": "..."} \n ```
                    if not full_tool_calls:
                        json_block_matches = re.finditer(r'```(?:json)?\s*(\{\s*"name"\s*:\s*".*?\})\s*```', full_content, re.DOTALL)
                        for m in json_block_matches:
                            try:
                                t = json.loads(m.group(1))
                                if "name" in t:
                                    full_tool_calls.append({"function": {"name": t["name"], "arguments": t.get("arguments", {})}})
                            except: pass

                    # 3. GLM-4 style / Action format: CALL `tool`
                    if not full_tool_calls:
                        call_matches = re.finditer(r'CALL\s+`([^`]+)`(?:\s+with\s+(.+?))?(?=\nCALL\s+`|$)', full_content, re.IGNORECASE | re.DOTALL)
                        for m in call_matches:
                            tool_name = m.group(1).strip()
                            tool_args = {}
                            args_str = m.group(2)
                            if args_str:
                                arg_matches = re.finditer(r'`([^`]+)`\s*=\s*(?:"([^"]*)"|`([^`]*)`|([^\s,]+))', args_str)
                                for am in arg_matches:
                                    arg_name = am.group(1)
                                    arg_val = am.group(2) if am.group(2) is not None else (am.group(3) if am.group(3) is not None else am.group(4))
                                    tool_args[arg_name] = arg_val
                            full_tool_calls.append({
                                "function": {
                                    "name": tool_name,
                                    "arguments": tool_args
                                }
                            })
                            
                # Handle tool calls if the model requested them
                if full_tool_calls:
                    import json
                    current_tool_signature = json.dumps(full_tool_calls, sort_keys=True)
                    if current_tool_signature == last_tool_signature:
                        recent_identical_tool_calls += 1
                    else:
                        recent_identical_tool_calls = 0
                        last_tool_signature = current_tool_signature

                    if recent_identical_tool_calls >= 3:
                        error_msg = "\n\n> [!CRITICAL]\n> **System Error:** You are repeating the exact same tool call(s) with the exact same arguments repeatedly without making progress. Please change your strategy or stop calling this tool.\n"
                        orch.add_message(role="assistant", content=full_content, tool_calls=full_tool_calls)
                        orch.add_message(role="user", content=error_msg)
                        
                        orchestrated_messages.append({
                            "role": "assistant",
                            "content": full_content,
                            "tool_calls": full_tool_calls
                        })
                        orchestrated_messages.append({
                            "role": "user",
                            "content": error_msg
                        })
                        
                        await manager.send_personal_message(
                            json.dumps({
                                "type": "stream",
                                "id": msg_id,
                                "role": "model",
                                "content": error_msg,
                                "done": False,
                                "stats": {
                                    "tokens": overall_token_count,
                                    "content_tokens": overall_content_token_count,
                                    "thinking_tokens": overall_thinking_token_count,
                                    "user_input_tokens": user_input_tokens,
                                    "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                    "tokens_per_second": round(final_tps, 1) if 'final_tps' in locals() else 0,
                                    "elapsed": round(total_time_spent_generating, 2),
                                }
                            }),
                            websocket,
                        )
                        
                        consecutive_tool_iterations += 1
                        continue

                    orch.add_message(role="assistant", content=full_content, tool_calls=full_tool_calls)
                    
                    orchestrated_messages.append({
                        "role": "assistant",
                        "content": full_content,
                        "tool_calls": full_tool_calls
                    })
                    
                    for tc in full_tool_calls:
                        func_name = tc.get("function", {}).get("name")
                        func_args = tc.get("function", {}).get("arguments", {})
                        
                        result_content = await _execute_tool(func_name, func_args)
                        orch.add_message(role="tool", content=result_content, name=func_name)
                        orchestrated_messages.append({
                            "role": "tool",
                            "content": result_content,
                            "name": func_name
                        })

                        display_output = str(result_content)

                        tool_data = {
                            "name": func_name,
                            "input": func_args,
                            "output": display_output
                        }
                        io_message = f"\n\n```tool_execution\n{json.dumps(tool_data)}\n```\n\n"

                        if func_name == "checkpoint_session":
                            new_world_state = func_args.get("world_state", "")
                            next_action = func_args.get("next_action", "Continue.")
                            if new_world_state:
                                orch.world_state = new_world_state
                            
                            orch.consolidated_up_to = len(orch._messages) - 1
                            orch._save_session_state()
                            
                            sys_msg = orchestrated_messages[0]
                            orchestrated_messages = [
                                sys_msg, 
                                {"role": "user", "content": f"CHECKPOINT SUCCESSFUL. CONTEXT FLUSHED.\n\nNEXT ACTION:\n{next_action}"}
                            ]
                            
                            consecutive_tool_iterations = 0
                            break

                    # Send the tool execution result to the frontend stream
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "stream",
                            "id": msg_id,
                            "role": "model",
                            "content": io_message,
                            "done": False,
                            "stats": {
                                "tokens": overall_token_count,
                                "content_tokens": overall_content_token_count,
                                "thinking_tokens": overall_thinking_token_count,
                                "user_input_tokens": user_input_tokens,
                                "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                "tokens_per_second": round(final_tps, 1) if 'final_tps' in locals() else 0,
                                "elapsed": round(total_time_spent_generating, 2),
                            }
                        }),
                        websocket,
                    )

                    # Preserve this iteration's thinking before the loop resets it
                    if full_thinking:
                        chronological_thinking_segments.append(full_thinking)
                    
                    consecutive_tool_iterations += 1
                    
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "stream_split",
                            "stats": {
                                "tokens": overall_token_count,
                                "content_tokens": overall_content_token_count,
                                "thinking_tokens": overall_thinking_token_count,
                                "user_input_tokens": user_input_tokens,
                                "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                "tokens_per_second": round(final_tps, 1) if 'final_tps' in locals() else 0,
                                "elapsed": round(total_time_spent_generating, 2),
                            }
                        }),
                        websocket,
                    )

                    # Continue the while loop to send the tool results back to Ollama
                    continue

                # Check for Ornith Python harness
                import re
                harness_match = re.search(r'```python\n(.*?)```', full_content, re.DOTALL)
                if "ornith" in model.lower() and harness_match and not full_tool_calls:
                    harness_code = harness_match.group(1).strip()
                    
                    # Notify frontend
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "stream",
                            "id": msg_id,
                            "role": "model",
                            "content": "\n\n> [!NOTE]\n> **Executing Self-Scaffold Harness...**\n",
                            "done": False,
                            "stats": {
                                "tokens": overall_token_count,
                                "content_tokens": overall_content_token_count,
                                "thinking_tokens": overall_thinking_token_count,
                                "user_input_tokens": user_input_tokens,
                                "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                "tokens_per_second": round(final_tps, 1) if 'final_tps' in locals() else 0,
                                "elapsed": round(total_time_spent_generating, 2),
                            }
                        }),
                        websocket,
                    )
                    
                    from scaffold_runner import run_scaffold
                    
                    async def tool_executor_coro(tool_name: str, args: dict) -> str:
                        return await _execute_tool(tool_name, args)
                        
                    harness_output = await run_scaffold(harness_code, tool_executor_coro)
                    
                    # Append result to prompt and run Stage 2
                    stage_2_msg = f"\n\n<scaffold_output>\n{harness_output}\n</scaffold_output>"
                    full_content += stage_2_msg
                    
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "stream",
                            "id": msg_id,
                            "role": "model",
                            "content": stage_2_msg,
                            "done": False,
                            "stats": {
                                "tokens": overall_token_count,
                                "content_tokens": overall_content_token_count,
                                "thinking_tokens": overall_thinking_token_count,
                                "user_input_tokens": user_input_tokens,
                                "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                "tokens_per_second": round(final_tps, 1) if 'final_tps' in locals() else 0,
                                "elapsed": round(total_time_spent_generating, 2),
                            }
                        }),
                        websocket,
                    )
                    
                    orch.add_message(role="assistant", content=full_content)
                    orchestrated_messages.append({
                        "role": "assistant",
                        "content": full_content
                    })
                    
                    if full_thinking:
                        chronological_thinking_segments.append(full_thinking)
                    
                    consecutive_scaffold_iterations += 1
                    
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "stream_split",
                            "stats": {
                                "tokens": overall_token_count,
                                "content_tokens": overall_content_token_count,
                                "thinking_tokens": overall_thinking_token_count,
                                "user_input_tokens": user_input_tokens,
                                "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                "tokens_per_second": round(final_tps, 1) if 'final_tps' in locals() else 0,
                                "elapsed": round(total_time_spent_generating, 2),
                            }
                        }),
                        websocket,
                    )

                    # Trigger Stage 2 Rollout
                    continue

                # No tool calls, finish normally
                else:
                    if overall_content_token_count == 0 and empty_response_count < 2:
                        empty_response_count += 1
                        orch.add_message(role="assistant", content=full_content)
                        prompt_msg = "\n\n> [!WARNING]\n> **System:** You ended your turn without outputting any text to the user. Please provide a summary of your actions or a final response.\n"
                        orch.add_message(role="user", content=prompt_msg)
                        orchestrated_messages.append({
                            "role": "assistant",
                            "content": full_content
                        })
                        orchestrated_messages.append({
                            "role": "user",
                            "content": prompt_msg
                        })
                        if full_thinking:
                            chronological_thinking_segments.append(full_thinking)
                        
                        await manager.send_personal_message(
                            json.dumps({
                                "type": "stream",
                                "id": msg_id,
                                "role": "model",
                                "content": prompt_msg,
                                "done": False,
                                "stats": {
                                    "tokens": overall_token_count,
                                    "content_tokens": overall_content_token_count,
                                    "thinking_tokens": overall_thinking_token_count,
                                    "user_input_tokens": user_input_tokens,
                                    "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                    "tokens_per_second": round(final_tps, 1) if 'final_tps' in locals() else 0,
                                    "elapsed": round(total_time_spent_generating, 2),
                                }
                            }),
                            websocket,
                        )
                        continue

                    orch.add_message(role="assistant", content=full_content)

                    # 5. Trigger asynchronous memory consolidation and persona evolution in the background
                    if orch.dynamic_consolidation:
                        await orch.consolidate_memory_background(model)
                    if orch.dynamic_persona:
                        await orch.evolve_persona_background(model)

                    # Get latest stats to return to frontend
                    context_stats = orch.get_stats()

                    await manager.send_personal_message(
                        json.dumps({
                            "type": "stream_end",
                            "id": msg_id,
                            "role": "model",
                            "content": "",
                            "thinking": ("\n\n---\n\n".join(chronological_thinking_segments + ([full_thinking] if full_thinking else []))) if chronological_thinking_segments else full_thinking,
                            "done": True,
                            "stats": {
                                "tokens": final_eval_count,
                                "content_tokens": overall_content_token_count,
                                "thinking_tokens": overall_thinking_token_count,
                                "user_input_tokens": user_input_tokens,
                                "background_input_tokens": max(0, overall_prompt_eval_count - user_input_tokens) if overall_prompt_eval_count > 0 else 0,
                                "tokens_per_second": round(final_tps, 1),
                                "elapsed": round(total_time_spent_generating, 2),
                                "model": model,
                                "prompt_eval_count": overall_prompt_eval_count,
                            },
                            "context_stats": context_stats,
                            "world_state": orch.world_state,
                        }),
                        websocket,
                    )
                    break # Exit the while True loop

    except httpx.ConnectError:
        try:
            import subprocess
            import platform
            print("Starting Ollama background server (internal fallback)...")
            if platform.system() == "Windows":
                subprocess.Popen(
                    ["ollama", "serve"],
                    creationflags=subprocess.CREATE_NO_WINDOW | 0x00000008,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            else:
                subprocess.Popen(
                    ["ollama", "serve"],
                    start_new_session=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
        except Exception as e:
            print(f"Failed to start Ollama on ConnectError: {e}")
            
        await manager.send_personal_message(
            json.dumps({
                "type": "error",
                "id": msg_id,
                "role": "model",
                "content": "Could not connect to Ollama. We've initiated the Ollama service in the background. Please try your request again in a few seconds.",
                "done": True,
            }),
            websocket,
        )
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        await manager.send_personal_message(
            json.dumps({
                "type": "error",
                "id": msg_id,
                "role": "model",
                "content": f"Error communicating with Ollama: {err_msg}",
                "done": True,
            }),
            websocket,
        )


@router.get("/models")
async def list_models():
    """Fetch available models from Ollama and check reasoning support via templates."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                data = response.json()
                model_names = [m["name"] for m in data.get("models", [])]
                

                
                async def check_reasoning(m_name):
                    # Hardcode reasoning=True for ornith as it explicitly uses <think>
                    if "ornith" in m_name.lower():
                        return {
                            "name": m_name,
                            "supports_reasoning": True,
                            "supports_vision": False,
                            "can_chat": True
                        }

                    try:
                        res = await client.post(f"{OLLAMA_BASE_URL}/api/show", json={"name": m_name})
                        if res.status_code == 200:
                            show_data = res.json()
                            template = show_data.get("template", "").lower()
                            system = show_data.get("system", "").lower()
                            capabilities = show_data.get("details", {}).get("families", [])

                            # Ollama's top-level `capabilities` list tells us what the
                            # model can actually do. A model is chat-usable only if it
                            # can generate ("completion"); embedding-only models report
                            # ["embedding"] and cannot be used in the chat endpoint.
                            caps = show_data.get("capabilities", []) or []
                            if not isinstance(caps, list):
                                caps = []
                            can_chat = ("completion" in caps) if caps else True
                            if caps and "embedding" in caps and "completion" not in caps:
                                can_chat = False

                            supports_reasoning = (
                                "thinking" in caps or
                                "thinking" in capabilities or
                                "<think>" in template or "</think>" in template or
                                "<think>" in system or "</think>" in system
                            )

                            families = show_data.get("details", {}).get("families", [])
                            if not isinstance(families, list):
                                families = []
                            supports_vision = ("vision" in caps) or any(fam.lower() in ['clip', 'llava', 'vision'] for fam in families)

                            return {
                                "name": m_name,
                                "supports_reasoning": supports_reasoning,
                                "supports_vision": supports_vision,
                                "can_chat": can_chat
                            }
                    except Exception:
                        pass
                    return {"name": m_name, "supports_reasoning": False, "supports_vision": False, "can_chat": True}
                
                models_info = await asyncio.gather(*(check_reasoning(name) for name in model_names))
                return {"models": list(models_info)}
            return {"models": [], "error": f"Ollama returned status {response.status_code}"}
    except httpx.ConnectError:
        try:
            import subprocess
            import platform
            if platform.system() == "Windows":
                subprocess.Popen(["ollama", "serve"], creationflags=subprocess.CREATE_NO_WINDOW | 0x00000008, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                subprocess.Popen(["ollama", "serve"], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        return {"models": [], "error": "Ollama is not running. We've initiated the service in the background, please wait a moment."}
    except Exception as e:
        return {"models": [], "error": str(e)}


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    current_task = None
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                
                if payload.get("action") == "cancel":
                    if current_task and not current_task.done():
                        current_task.cancel()
                    continue
                    
                if payload.get("action") == "tool_approve":
                    msg_id = payload.get("id")
                    if msg_id in tool_approval_events:
                        tool_approval_results[msg_id] = payload.get("approved", False)
                        tool_approval_events[msg_id].set()
                    continue

                if current_task and not current_task.done():
                    current_task.cancel()

                async def task_wrapper(p, ws):
                    try:
                        await stream_ollama_response(p, ws)
                    except asyncio.CancelledError:
                        print("Generation cancelled by user.")
                        # Send a stream_end to ensure the frontend resets state cleanly
                        try:
                            await manager.send_personal_message(
                                json.dumps({
                                    "type": "stream_end",
                                    "id": f"msg-{id(p)}",
                                    "role": "model",
                                    "content": "",
                                    "done": True,
                                    "stats": {
                                        "tokens": 0,
                                        "tokens_per_second": 0,
                                        "elapsed": 0,
                                        "model": p.get("model", "north-mini-code-1.0:q4_K_M"),
                                    }
                                }),
                                ws
                            )
                        except Exception:
                            pass
                        raise

                current_task = asyncio.create_task(task_wrapper(payload, websocket))

            except json.JSONDecodeError:
                await manager.send_personal_message(
                    json.dumps({"type": "error", "content": "Invalid JSON"}),
                    websocket,
                )
            except Exception as e:
                import traceback
                traceback.print_exc()
                try:
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "error",
                            "content": f"Internal server error: {str(e)}",
                            "done": True,
                        }),
                        websocket,
                    )
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        # Catch-all for unexpected transport-level errors
        import traceback
        traceback.print_exc()
    finally:
        if current_task and not current_task.done():
            current_task.cancel()
        manager.disconnect(websocket)
