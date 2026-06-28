from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
import json
import httpx
import asyncio
from typing import List, Dict, Any, Optional
from api.context_engine import ContextOrchestrator, estimate_tokens

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
            "num_predict": 1000
        },
        "think": True
    }
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
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
    
    # We will let Ollama automatically calculate the best layer offload (num_gpu)
    # and context size based on your physical 16GB VRAM limit.
    merged_options = dict(options) if options else {}
    
    # Define available tools
    tools = [
        {
            "type": "function",
            "function": {
                "name": "delegate_to_subagent",
                "description": "Delegates a complex task to a specialized sub-agent. Use 'web-researcher' for comprehensive internet research tasks.",
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
                "name": "get_system_time",
                "description": "Returns the current local system time, date, and timezone.",
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
                "description": "Executes a terminal/PowerShell command and returns the output. Use for system info or advanced file manipulation. Warning: use carefully.",
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
    except ImportError:
        delegate_to_subagent = None

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
            chronological_thinking_segments = []

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
                        
                        elapsed = asyncio.get_event_loop().time() - start_time
                        tokens_per_sec = token_count / elapsed if elapsed > 0 else 0

                        if thinking_token:
                            if not is_thinking:
                                is_thinking = True
                                full_content += "<think>\n"
                                await manager.send_personal_message(
                                    json.dumps({
                                        "type": "stream",
                                        "id": msg_id,
                                        "role": "model",
                                        "content": "<think>\n",
                                        "done": False,
                                        "stats": {
                                            "tokens": token_count,
                                            "tokens_per_second": round(tokens_per_sec, 1),
                                            "elapsed": round(elapsed, 2),
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
                                        "tokens": token_count,
                                        "tokens_per_second": round(tokens_per_sec, 1),
                                        "elapsed": round(elapsed, 2),
                                    },
                                }),
                                websocket,
                            )

                        if content_token:
                            if is_thinking:
                                is_thinking = False
                                full_content += "\n</think>\n\n"
                                await manager.send_personal_message(
                                    json.dumps({
                                        "type": "stream",
                                        "id": msg_id,
                                        "role": "model",
                                        "content": "\n</think>\n\n",
                                        "done": False,
                                        "stats": {
                                            "tokens": token_count,
                                            "tokens_per_second": round(tokens_per_sec, 1),
                                            "elapsed": round(elapsed, 2),
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
                                        "tokens": token_count,
                                        "tokens_per_second": round(tokens_per_sec, 1),
                                        "elapsed": round(elapsed, 2),
                                    },
                                }),
                                websocket,
                            )

                        if chunk.get("done"):
                            if is_thinking:
                                is_thinking = False
                                full_content += "\n</think>\n\n"
                                await manager.send_personal_message(
                                    json.dumps({
                                        "type": "stream",
                                        "id": msg_id,
                                        "role": "model",
                                        "content": "\n</think>\n\n",
                                        "done": False,
                                        "stats": {
                                            "tokens": token_count,
                                            "tokens_per_second": round(tokens_per_sec, 1),
                                            "elapsed": round(elapsed, 2),
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
                                
                            tokens_per_sec = token_count / final_elapsed if final_elapsed > 0 else 0
                            final_eval_count = chunk.get("eval_count", token_count)
                            final_tps = final_eval_count / final_elapsed if final_elapsed > 0 else tokens_per_sec

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
                                result_content = await delegate_to_subagent(role, task, model=model)
                            else:
                                result_content = "Error: sub_agents module could not be loaded."
                                
                            orch.add_message(role="tool", content=result_content, name=func_name)
                            orchestrated_messages.append({
                                "role": "tool",
                                "content": result_content,
                                "name": func_name
                            })
                            
                        elif func_name == "get_system_time":
                            import datetime
                            time_str = datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
                            result_content = f"The current system date and time is: {time_str}"
                            orch.add_message(role="tool", content=result_content, name=func_name)
                            orchestrated_messages.append({
                                "role": "tool",
                                "content": result_content,
                                "name": func_name
                            })
                            
                        elif func_name == "run_command":
                            command = func_args.get("command", "")
                            
                            # Ask for approval
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
                            
                            # Wait for frontend approval
                            await tool_approval_events[msg_id].wait()
                            approved = tool_approval_results.get(msg_id, False)
                            
                            # Cleanup state
                            del tool_approval_events[msg_id]
                            if msg_id in tool_approval_results:
                                del tool_approval_results[msg_id]
                                
                            if not approved:
                                result_content = f"Error: User denied permission to run command: {command}"
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
                                    result_content = await asyncio.to_thread(run_command, command)
                                except Exception as e:
                                    result_content = f"Error executing {func_name}: {str(e)}"
                                
                            orch.add_message(role="tool", content=result_content, name=func_name)
                            orchestrated_messages.append({
                                "role": "tool",
                                "content": result_content,
                                "name": func_name
                            })
                            
                        elif func_name in ["read_file", "write_file", "list_directory"]:
                            # Safe tools just emit an execution event
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
                                    result_content = await asyncio.to_thread(read_file, func_args.get("filepath", ""))
                                elif func_name == "write_file":
                                    result_content = await asyncio.to_thread(write_file, func_args.get("filepath", ""), func_args.get("content", ""))
                                elif func_name == "list_directory":
                                    result_content = await asyncio.to_thread(list_directory, func_args.get("path", ""))
                            except Exception as e:
                                result_content = f"Error executing {func_name}: {str(e)}"
                                
                            orch.add_message(role="tool", content=result_content, name=func_name)
                            orchestrated_messages.append({
                                "role": "tool",
                                "content": result_content,
                                "name": func_name
                            })
                        else:
                            result_content = f"Error: Tool {func_name} not recognized."
                            orch.add_message(role="tool", content=result_content, name=func_name)
                            orchestrated_messages.append({
                                "role": "tool",
                                "content": result_content,
                                "name": func_name
                            })

                        # Format and send chronological tool I/O to frontend
                        display_output = str(result_content)
                        if len(display_output) > 2000:
                            display_output = display_output[:2000] + "\n\n... [Output Truncated]"

                        tool_data = {
                            "name": func_name,
                            "input": func_args,
                            "output": display_output
                        }
                        io_message = f"\n\n```tool_execution\n{json.dumps(tool_data)}\n```\n\n"

                    # Preserve this iteration's thinking before the loop resets it
                    if full_thinking:
                        chronological_thinking_segments.append(full_thinking)
                        await manager.send_personal_message(
                            json.dumps({
                                "type": "stream",
                                "id": msg_id,
                                "role": "model",
                                "content": io_message,
                                "done": False,
                                "stats": {
                                    "tokens": token_count,
                                    "tokens_per_second": 0,
                                    "elapsed": 0,
                                }
                            }),
                            websocket,
                        )
                    
                    # Continue the while loop to send the tool results back to Ollama
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
                                "elapsed": round(final_elapsed, 2),
                                "model": model,
                                "prompt_eval_count": final_chunk.get("prompt_eval_count", 0),
                            },
                            "context_stats": context_stats,
                            "world_state": orch.world_state,
                        }),
                        websocket,
                    )
                    break # Exit the while True loop

    except httpx.ConnectError:
        await manager.send_personal_message(
            json.dumps({
                "type": "error",
                "id": msg_id,
                "role": "model",
                "content": "Could not connect to Ollama. Make sure Ollama is running (run `ollama serve` in a terminal).",
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
                
                async def check_reasoning(m_name):
                    try:
                        res = await client.post(f"{OLLAMA_BASE_URL}/api/show", json={"name": m_name})
                        if res.status_code == 200:
                            show_data = res.json()
                            template = show_data.get("template", "").lower()
                            system = show_data.get("system", "").lower()
                            capabilities = show_data.get("capabilities", [])
                            supports_reasoning = (
                                "thinking" in capabilities or
                                "<think>" in template or "</think>" in template or 
                                "<think>" in system or "</think>" in system
                            )
                            return {"name": m_name, "supports_reasoning": supports_reasoning}
                    except Exception:
                        pass
                    return {"name": m_name, "supports_reasoning": False}
                
                models_info = await asyncio.gather(*(check_reasoning(name) for name in model_names))
                return {"models": list(models_info)}
            return {"models": [], "error": f"Ollama returned status {response.status_code}"}
    except httpx.ConnectError:
        return {"models": [], "error": "Ollama is not running"}
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
