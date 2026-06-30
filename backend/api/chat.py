from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
import json
import httpx
import asyncio
import sys
import os
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
        "stats": orch.get_stats(),
        "config": {
            "active_window_limit": orch.active_window_limit,
            "dynamic_consolidation": orch.dynamic_consolidation,
            "semantic_recall": orch.semantic_recall
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
    orch.set_config(
        active_window_limit=payload.active_window_limit,
        dynamic_consolidation=payload.dynamic_consolidation,
        semantic_recall=payload.semantic_recall
    )
    return {
        "status": "success",
        "config": {
            "active_window_limit": orch.active_window_limit,
            "dynamic_consolidation": orch.dynamic_consolidation,
            "semantic_recall": orch.semantic_recall
        },
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
    orchestrated_messages = orch.build_orchestrated_prompt(last_user_query)

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
    # Set it to 131072 to prevent output truncation when processing large data and allow full context windows.
    merged_options = dict(options) if options else {}
    if "num_ctx" not in merged_options:
        merged_options["num_ctx"] = 131072
    
    # Define available tools
    tools = [
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
                "description": "Writes or overwrites a file with the provided content.",
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
                        }
                    },
                    "required": ["filepath", "content"]
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
        }
    ]

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
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
            chronological_thinking_segments = []

            async def _execute_tool(func_name: str, func_args: dict) -> str:
                if func_name == "delegate_to_subagent":
                    role = func_args.get("role", "")
                    task = func_args.get("task", "")
                    
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": msg_id,
                            "tool": func_name,
                            "args": {"role": role, "task": task}
                        }),
                        websocket,
                    )
                    
                    if delegate_to_subagent:
                        return await delegate_to_subagent(role, task, model=model)
                    return "Error: sub_agents module could not be loaded."
                    
                elif func_name == "search_web":
                    query = func_args.get("query", "")
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": msg_id,
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
                            "id": msg_id,
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
                    tool_approval_events[msg_id] = asyncio.Event()
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_approval_request",
                            "id": msg_id,
                            "tool": func_name,
                            "command": command
                        }),
                        websocket
                    )
                    await tool_approval_events[msg_id].wait()
                    approved = tool_approval_results.get(msg_id, False)
                    del tool_approval_events[msg_id]
                    if msg_id in tool_approval_results:
                        del tool_approval_results[msg_id]
                        
                    if not approved:
                        return f"Error: User denied permission to run command: {command}"
                    else:
                        await manager.send_personal_message(
                            json.dumps({
                                "type": "tool_execution",
                                "id": msg_id,
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
                            
                elif func_name in ["read_file", "write_file", "list_directory"]:
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "tool_execution",
                            "id": msg_id,
                            "tool": func_name,
                            "args": func_args
                        }),
                        websocket
                    )
                    from system_tools import read_file, write_file, list_directory
                    try:
                        if func_name == "read_file":
                            return await asyncio.to_thread(read_file, func_args.get("filepath", ""))
                        elif func_name == "write_file":
                            return await asyncio.to_thread(write_file, func_args.get("filepath", ""), func_args.get("content", ""))
                        elif func_name == "list_directory":
                            return await asyncio.to_thread(list_directory, func_args.get("path", ""))
                    except Exception as e:
                        return f"Error executing {func_name}: {str(e)}"
                return f"Error: Tool {func_name} not recognized."

                # Move overall counters outside the loop so tool executions don't reset them
                overall_token_count = 0
                total_time_spent_generating = 0
                overall_prompt_eval_count = 0

            while True:
                # 4. Formulate the official Ollama payload
                ollama_payload = {
                    "model": model,
                    "messages": orchestrated_messages,
                    "stream": True,
                    "options": merged_options,
                    "think": True,
                }
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
                    is_thinking = False
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue

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

                # Handle tool calls if the model requested them
                if full_tool_calls:
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
                                "tokens_per_second": round(final_tps, 1) if 'final_tps' in locals() else 0,
                                "elapsed": round(total_time_spent_generating, 2),
                            }
                        }),
                        websocket,
                    )

                    # Preserve this iteration's thinking before the loop resets it
                    if full_thinking:
                        chronological_thinking_segments.append(full_thinking)
                    
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
                    
                    # Trigger Stage 2 Rollout
                    continue

                # No tool calls, finish normally
                else:
                    orch.add_message(role="assistant", content=full_content)

                    # 5. Trigger asynchronous memory consolidation in the background
                    if orch.dynamic_consolidation:
                        await orch.consolidate_memory_background(model)

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
        await manager.send_personal_message(
            json.dumps({
                "type": "error",
                "id": msg_id,
                "role": "model",
                "content": f"Error communicating with Ollama: {str(e)}",
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
                
                # Auto-inject Ornith models for self-evolving agentic coding
                for ornith_model in ["ornith:9b", "ornith:35b"]:
                    if not any(ornith_model in m for m in model_names):
                        model_names.append(ornith_model)
                
                async def check_reasoning(m_name):
                    # Hardcode reasoning=True for ornith as it explicitly uses <think>
                    if "ornith" in m_name.lower():
                        return {
                            "name": m_name, 
                            "supports_reasoning": True,
                            "supports_vision": False
                        }
                        
                    try:
                        res = await client.post(f"{OLLAMA_BASE_URL}/api/show", json={"name": m_name})
                        if res.status_code == 200:
                            show_data = res.json()
                            template = show_data.get("template", "").lower()
                            system = show_data.get("system", "").lower()
                            capabilities = show_data.get("details", {}).get("families", [])
                            
                            supports_reasoning = (
                                "thinking" in capabilities or
                                "<think>" in template or "</think>" in template or 
                                "<think>" in system or "</think>" in system
                            )
                            
                            families = show_data.get("details", {}).get("families", [])
                            if not isinstance(families, list):
                                families = []
                            supports_vision = any(fam.lower() in ['clip', 'llava', 'vision'] for fam in families)
                            
                            return {
                                "name": m_name, 
                                "supports_reasoning": supports_reasoning,
                                "supports_vision": supports_vision
                            }
                    except Exception:
                        pass
                    return {"name": m_name, "supports_reasoning": False, "supports_vision": False}
                
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
