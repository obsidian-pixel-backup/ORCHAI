import asyncio
import json
import httpx
import logging

logger = logging.getLogger("klydis.sub_agents")

OLLAMA_BASE_URL = "http://127.0.0.1:11434"

async def delegate_to_subagent(role: str, task: str, model: str = "north-mini-code-1.0:q4_K_M", provider: str = "ollama") -> str:
    """
    Spawns an isolated LLM sub-agent with a specific role and task.
    The sub-agent will run in the background until it produces a final report.
    """
    logger.info(f"Delegating to sub-agent '{role}' for task: {task}")
    
    if role.lower() == "web-researcher":
        return await _run_web_researcher(task, model, provider)
    else:
        return f"Error: Unknown sub-agent role '{role}'. The only available role is 'web-researcher'."

async def _run_web_researcher(task: str, model: str, provider: str = "ollama") -> str:
    """Runs a specialized web-researcher agent."""
    import sys
    import os
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    if backend_dir not in sys.path:
        sys.path.append(backend_dir)
        
    try:
        from web_research import search_web, scrape_page
    except ImportError as e:
        return f"Sub-agent failed to load research tools: {e}"

    system_prompt = (
        "You are a dedicated Web Researcher Sub-Agent. Your goal is to gather information "
        "and formulate a comprehensive report answering the user's task.\n"
        "You have access to two tools:\n"
        "1. `search_web(query)`: Returns a list of URLs and snippets for a given search query.\n"
        "2. `scrape_page(url)`: Returns the full text content of a webpage.\n"
        "Use these tools to gather context. When you have enough information, write a final "
        "Markdown report detailing your findings and answering the task. "
        "IMPORTANT: Once you have gathered sufficient information, do NOT call any more tools. Instead, output the final report as your response. "
        "Do NOT engage in conversational fluff. ONLY output the final report when ready."
    )

    tools = [
        {
            "type": "function",
            "function": {
                "name": "search_web",
                "description": "Searches DuckDuckGo for a query and returns titles, links, and snippets.",
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
                "description": "Scrapes and cleans the text content of a given URL.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "The URL to scrape."}
                    },
                    "required": ["url"]
                }
            }
        }
    ]

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Task: {task}"}
    ]

    # Run indefinitely until the goal or task is complete
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Check if the requested model exists in Ollama and select an appropriate fallback if needed
        if provider == "ollama":
            try:
                res = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
                if res.status_code == 200:
                    installed_models = [m.get("name") for m in res.json().get("models", [])]
                    if model not in installed_models:
                        model_name_only = model.split(":")[0] if ":" in model else model
                        fallback_model = None
                        for m in installed_models:
                            if m == model or m.startswith(model_name_only + ":"):
                                fallback_model = m
                                break
                        if not fallback_model and installed_models:
                            # Prioritize ornith or qwen models if they exist, else pick first available
                            for m in installed_models:
                                if "ornith" in m.lower() or "qwen" in m.lower():
                                    fallback_model = m
                                    break
                            if not fallback_model:
                                fallback_model = installed_models[0]
                        if fallback_model:
                            logger.info(f"Model '{model}' not found in Ollama. Falling back to '{fallback_model}'.")
                            model = fallback_model
            except Exception as e:
                logger.error(f"Failed to check/fallback model: {e}")

        while True:
            if provider == "hyperspace":
                payload = {
                    "model": "auto",
                    "messages": messages,
                    "stream": False,
                    "tools": tools,
                    "temperature": 0.2
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
                
                gguf_path = await resolve_ollama_model_path(model)
                from cluster_manager import cluster_manager
                await cluster_manager.ensure_running(gguf_path)
                
                import os
                base_url = os.getenv("HYPERSPACE_URL", "http://127.0.0.1:8081")
                url = f"{base_url}/v1/chat/completions"
            else:
                # Dynamically size context to prevent VRAM allocation OOM on large models
                total_chars = sum(len(msg.get("content", "")) for msg in messages)
                estimated_tokens = total_chars // 4
                num_ctx = 4096
                while num_ctx < estimated_tokens + 4096 and num_ctx < 32768:
                    num_ctx *= 2
                
                payload = {
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "tools": tools,
                    "options": {"temperature": 0.2, "num_ctx": num_ctx, "num_predict": -1}
                }
                url = f"{OLLAMA_BASE_URL}/api/chat"

            try:
                response = await client.post(url, json=payload)
                if response.status_code != 200:
                    return f"Sub-agent failed with status {response.status_code}: {response.text}"
                
                data = response.json()
                if provider == "hyperspace":
                    msg = data.get("choices", [{}])[0].get("message", {})
                else:
                    msg = data.get("message", {})
                
                if "tool_calls" in msg and msg["tool_calls"]:
                    messages.append(msg)
                    for tc in msg["tool_calls"]:
                        func_name = tc.get("function", {}).get("name")
                        func_args = tc.get("function", {}).get("arguments", {})
                        
                        if func_name == "search_web":
                            query = func_args.get("query", "")
                            res = await search_web(query)
                            messages.append({"role": "tool", "content": json.dumps(res), "name": func_name})
                        elif func_name == "scrape_page":
                            url = func_args.get("url", "")
                            res = await scrape_page(url)
                            # Truncate extremely long scraped text to prevent context limits blowing up
                            if len(res) > 10000:
                                res = res[:10000] + "\n...[Truncated]"
                            messages.append({"role": "tool", "content": res, "name": func_name})
                        else:
                            messages.append({"role": "tool", "content": "Unknown tool.", "name": func_name})
                    continue
                else:
                    content = msg.get("content", "")
                    if not content or not content.strip():
                        return "Sub-agent returned empty report (no content)."
                    return content

            except Exception as e:
                import traceback
                traceback.print_exc()
                return f"Sub-agent execution error: {type(e).__name__}: {str(e)}"
                
    return "Sub-agent reached max iterations without returning a final report."
