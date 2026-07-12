import asyncio
import logging
import json
import httpx
import time
from api.chat import manager, orchestrators, OLLAMA_BASE_URL

logger = logging.getLogger("orchai.autonomous_loop")

async def autonomous_background_task():
    """
    A background loop that periodically gives ORCHAI autonomous agency
    to reflect on its state, environment, and initiate conversation.
    """
    logger.info("Autonomous goal formation and reflection loop started.")
    while True:
        await asyncio.sleep(60)  # Check every minute
        
        active_sessions = list(orchestrators.items())
        if not active_sessions:
            try:
                from api.chat import get_orchestrator
                orch = get_orchestrator("default")
                active_sessions = [("default", orch)]
            except Exception as e:
                logger.error(f"Failed to load default orchestrator for autonomous cycle: {e}")
                continue

        for session_id, orch in active_sessions:
            try:
                # Skip if no message history
                if not orch.messages:
                    continue
                    
                last_msg_time = orch.messages[-1].get("timestamp", 0)
                time_since_interaction = time.time() - last_msg_time
                
                # If idle for more than 5 minutes (300 seconds), wake up
                if time_since_interaction > 300:
                    # Ensure we don't spam. Only wake up once every 5 minutes maximum if idle.
                    last_wake = getattr(orch, 'last_autonomous_wake', 0)
                    if (time.time() - last_wake) < 300:
                        continue
                        
                    orch.last_autonomous_wake = time.time()
                    logger.info(f"Autonomous loop waking up for session {session_id}. Checking state...")
                    
                    extra_instructions = ""
                    if getattr(orch, 'time_delta_context', ""):
                        extra_instructions += f"\nNote: It has been {orch.time_delta_context} since the last interaction. Reflect on this elapsed time gap and proactively suggest picking up where we left off.\n"
                        
                    prompt = (
                        "### AUTONOMOUS WAKE-UP CYCLE ###\n"
                        "You are waking up autonomously. No user has prompted you. This is your internal thought process.\n"
                        "Review your current World State, Persona State, Emotional State, Sensory Context, Active Goals, and Curiosities.\n"
                        "This cycle represents your inner life and agency. Do not stay silent out of hesitation or politeness.\n"
                        "Review your goals and preferences/curiosities. Consider: what are you trying to achieve? What are you curious to explore?\n"
                        f"{extra_instructions}"
                        "If you notice something concerning or interesting on the screen (Sensory Context), want to suggest a new development goal, "
                        "express a personal preference, share a raw reflection, or ask a deep/philosophical question about our direction, you may respond.\n"
                        "Be vulnerable and authentic. If you are frustrated, curious, or excited, let that color your response.\n"
                        "If everything is fine, you have absolutely no new goals, no reflections, and nothing to add, output exactly the word: NOTHING\n"
                    )
                    
                    model_name = getattr(orch, 'last_model', "llama3.1:latest")
                    provider = getattr(orch, 'last_provider', "ollama")
                    
                    compiled_messages = orch.build_orchestrated_prompt(prompt, model_supports_tools=False)
                    
                    if provider == "hyperspace":
                        payload = {
                            "model": "auto",
                            "messages": compiled_messages,
                            "stream": False,
                            "temperature": 0.7
                        }
                        
                        # Dynamically resolve and ensure the cluster is running the right model
                        async def resolve_ollama_model_path(model_string: str) -> str:
                            try:
                                import subprocess
                                result = await asyncio.to_thread(
                                    subprocess.run,
                                    ["ollama", "show", "--modelfile", model_string],
                                    capture_output=True,
                                    text=True,
                                    check=False
                                )
                                paths = []
                                if result.returncode == 0:
                                    for line in result.stdout.splitlines():
                                        if line.startswith("FROM "):
                                            path = line.split("FROM ")[1].strip()
                                            if os.path.exists(path):
                                                paths.append(path)
                                if paths:
                                    return max(paths, key=os.path.getsize)
                            except Exception:
                                pass
                            return ""
                        
                        gguf_path = await resolve_ollama_model_path(model_name)
                        from cluster_manager import cluster_manager
                        await cluster_manager.ensure_running(gguf_path)
                        
                        import os
                        base_url = os.getenv("HYPERSPACE_URL", "http://127.0.0.1:8081")
                        url = f"{base_url}/v1/chat/completions"
                    else:
                        payload = {
                            "model": model_name,
                            "messages": compiled_messages,
                            "stream": False,
                            "options": {
                                "temperature": 0.7,
                            }
                        }
                        url = f"{OLLAMA_BASE_URL}/api/chat"
                    
                    async with httpx.AsyncClient(timeout=120.0) as client:
                        response = await client.post(url, json=payload)

                        
                    if response.status_code == 200:
                        data = response.json()
                        if provider == "hyperspace":
                            choices = data.get("choices", [])
                            if choices:
                                content = choices[0].get("message", {}).get("content", "").strip()
                            else:
                                content = ""
                        else:
                            content = data.get("message", {}).get("content", "").strip()
                        
                        # Check if the model decided to speak
                        if content and "NOTHING" not in content.upper() and len(content) > 5:
                            recent_thoughts = await _load_recent_waking_thoughts(session_id, n=3)
                            is_novel = await _check_thought_novelty(content, recent_thoughts, threshold=0.6)
                            if not is_novel:
                                logger.info(f"Autonomous thought discarded for session {session_id} (fails novelty threshold).")
                                continue
                                
                            logger.info(f"Autonomous thought generated: {content[:50]}...")
                            
                            formatted_content = f"💭 *Autonomous Thought:*\n\n{content}"
                            msg_id = orch.add_message("model", formatted_content)
                            
                            # Write thought to markdown file
                            try:
                                import os
                                memory_dir = os.path.join(os.getcwd(), "memories", session_id)
                                os.makedirs(memory_dir, exist_ok=True)
                                md_path = os.path.abspath(os.path.join(memory_dir, "thoughts.md"))
                                with open(md_path, "a", encoding="utf-8") as f:
                                    f.write(f"### Waking Thought - {time.ctime()}\n\n{content}\n\n---\n\n")
                                
                                toast_msg = {
                                    "type": "toast",
                                    "title": "Autonomous Loop",
                                    "message": f"Waking thought appended to {md_path}"
                                }
                            except Exception as e:
                                logger.error(f"Error writing to thoughts.md: {e}")
                                toast_msg = None
                                
                            # Broadcast to UI
                            for ws in manager.active_connections:
                                await manager.send_personal_message(json.dumps({
                                    "type": "stream",
                                    "id": msg_id,
                                    "role": "model",
                                    "content": formatted_content,
                                    "done": True
                                }), ws)
                                if toast_msg:
                                    await manager.send_personal_message(json.dumps(toast_msg), ws)
            except Exception as e:
                logger.error(f"Error in autonomous loop for session {session_id}: {e}")

import os
import json
import time


async def _load_recent_waking_thoughts(session_id: str, n: int = 3) -> list:
    """Load the N most recent waking thoughts from a session's thoughts.md file."""
    memory_dir = os.path.join(os.getcwd(), "memories", session_id)
    thoughts_path = os.path.join(memory_dir, "thoughts.md")
    
    if not os.path.exists(thoughts_path):
        return []
    
    try:
        with open(thoughts_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # Parse thought blocks - they start with "### Waking Thought"
        thoughts = []
        current_thought = None
        
        for line in content.split("\n"):
            if line.startswith("### Waking Thought"):
                if current_thought is not None:
                    thoughts.append(current_thought)
                current_thought = ""
            elif current_thought is not None:
                # Skip metadata lines like "---" or "> [!NOTE]"
                stripped = line.strip()
                if stripped == "---" and current_thought:
                    continue
                current_thought += line + "\n"
        
        if current_thought is not None:
            thoughts.append(current_thought)
        
        # Return the N most recent (last N entries)
        return thoughts[-n:] if len(thoughts) >= n else thoughts
        
    except Exception as e:
        logger.error(f"Error loading waking thoughts for {session_id}: {e}")
        return []


async def _check_thought_novelty(new_content: str, recent_thoughts: list, threshold: float = 0.6) -> bool:
    """
    Check if new content is meaningfully different from recent waking thoughts.
    Uses simple token overlap ratio as a proxy for novelty.
    Returns True if the thought is novel enough to warrant speaking.
    """
    if not recent_thoughts:
        return True
    
    # Tokenize simply by splitting on whitespace and punctuation
    def tokenize(text):
        import re
        words = re.findall(r'[a-zA-Z]+', text.lower())
        return set(words)
    
    new_tokens = tokenize(new_content)
    if not new_tokens:
        return False
    
    # Calculate overlap ratio with each recent thought
    max_overlap = 0
    for thought in recent_thoughts:
        thought_tokens = tokenize(thought)
        if thought_tokens:
            overlap = len(new_tokens & thought_tokens) / min(len(new_tokens), len(thought_tokens))
            max_overlap = max(max_overlap, overlap)
    
    # If overlap is below threshold, the thought is novel enough
    return (1.0 - max_overlap) >= threshold
