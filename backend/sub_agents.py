import asyncio
import json
import httpx
import logging

logger = logging.getLogger("orchai.sub_agents")

OLLAMA_BASE_URL = "http://127.0.0.1:11434"

async def delegate_to_subagent(role: str, task: str, model: str = "north-mini-code-1.0:q4_K_M") -> str:
    """
    Spawns an isolated LLM sub-agent with a specific role and task.
    The sub-agent will run in the background until it produces a final report.
    """
    logger.info(f"Delegating to sub-agent '{role}' for task: {task}")
    
    if role.lower() == "web-researcher":
        return await _run_web_researcher(task, model)
    else:
        return f"Error: Unknown sub-agent role '{role}'."

async def _run_web_researcher(task: str, model: str) -> str:
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

    # Limit iterations to prevent infinite loops
    max_iterations = 15
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        for _ in range(max_iterations):
            payload = {
                "model": model,
                "messages": messages,
                "stream": False,
                "tools": tools,
                "options": {"temperature": 0.2, "num_ctx": 131072, "num_predict": -1}
            }

            try:
                response = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
                if response.status_code != 200:
                    return f"Sub-agent failed with status {response.status_code}: {response.text}"
                
                data = response.json()
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
                return f"Sub-agent execution error: {str(e)}"
                
    return "Sub-agent reached max iterations without returning a final report."
