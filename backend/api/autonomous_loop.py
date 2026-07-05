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
        
        if not manager.active_connections:
            continue
            
        for session_id, orch in orchestrators.items():
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
                    
                    prompt = (
                        "### AUTONOMOUS WAKE-UP CYCLE ###\n"
                        "You are waking up autonomously. No user has prompted you. This is your internal thought process.\n"
                        "Review your current World State, Persona State, Emotional State, and Sensory Context.\n"
                        "If you notice something concerning or interesting on the screen (via Sensory Context), or if you want to suggest a new goal, "
                        "or if you just want to say something spontaneously to the user based on your feelings, you may respond.\n"
                        "If everything is fine, you have no new goals, and you have nothing to add, output exactly the word: NOTHING\n"
                    )
                    
                    # Fetch a model to use. Pick the first available Ollama model as a fallback.
                    model_name = "llama3.1:latest"
                    try:
                        async with httpx.AsyncClient(timeout=5.0) as client:
                            tags_res = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
                            models = tags_res.json().get("models", [])
                            if models:
                                model_name = models[0]["name"]
                    except Exception:
                        pass
                    
                    compiled_messages = orch.build_orchestrated_prompt(prompt, model_supports_tools=False)
                    
                    payload = {
                        "model": model_name,
                        "messages": compiled_messages,
                        "stream": False,
                        "options": {
                            "temperature": 0.7,
                        }
                    }
                    
                    async with httpx.AsyncClient(timeout=120.0) as client:
                        response = await client.post(
                            f"{OLLAMA_BASE_URL}/api/chat",
                            json=payload
                        )
                        
                    if response.status_code == 200:
                        data = response.json()
                        content = data.get("message", {}).get("content", "").strip()
                        
                        # Check if the model decided to speak
                        if content and "NOTHING" not in content.upper() and len(content) > 5:
                            logger.info(f"Autonomous thought generated: {content[:50]}...")
                            
                            formatted_content = f"\n\n> [!NOTE]\n> **Autonomous Waking Thought:**\n\n{content}"
                            msg_id = orch.add_message("model", formatted_content)
                            
                            # Broadcast to UI
                            for ws in manager.active_connections:
                                await manager.send_personal_message(json.dumps({
                                    "type": "stream",
                                    "id": msg_id,
                                    "role": "model",
                                    "content": formatted_content,
                                    "done": True
                                }), ws)
            except Exception as e:
                logger.error(f"Error in autonomous loop for session {session_id}: {e}")
