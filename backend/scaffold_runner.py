import asyncio
from typing import Callable, Dict, Any

class RestrictedEnvironment:
    def __init__(self, tool_executor: Callable):
        self.tool_executor = tool_executor
        
    def read_file(self, filepath: str) -> str:
        return self.tool_executor("read_file", {"filepath": filepath})
        
    def write_file(self, filepath: str, content: str) -> str:
        return self.tool_executor("write_file", {"filepath": filepath, "content": content})
        
    def list_directory(self, path: str) -> str:
        return self.tool_executor("list_directory", {"path": path})
        
    def run_command(self, command: str) -> str:
        return self.tool_executor("run_command", {"command": command})
        
    def delegate_to_subagent(self, role: str, task: str) -> str:
        return self.tool_executor("delegate_to_subagent", {"role": role, "task": task})
        
    def search_web(self, query: str) -> str:
        return self.tool_executor("search_web", {"query": query})
        
    def scrape_page(self, url: str) -> str:
        return self.tool_executor("scrape_page", {"url": url})
        
    def get_system_info(self) -> str:
        return self.tool_executor("get_system_info", {})

async def run_scaffold(harness_code: str, tool_executor_coro: Callable) -> str:
    """
    Executes the Python harness code in a restricted namespace.
    tool_executor_coro is an async function: async def execute(tool_name: str, args: dict) -> str
    """
    loop = asyncio.get_running_loop()
    
    def sync_executor(tool_name: str, args: dict) -> str:
        future = asyncio.run_coroutine_threadsafe(tool_executor_coro(tool_name, args), loop)
        return future.result()
        
    env = RestrictedEnvironment(sync_executor)
    
    # Safe namespace
    namespace = {
        "__builtins__": __builtins__,
        "read_file": env.read_file,
        "write_file": env.write_file,
        "list_directory": env.list_directory,
        "run_command": env.run_command,
        "delegate_to_subagent": env.delegate_to_subagent,
        "search_web": env.search_web,
        "scrape_page": env.scrape_page,
        "get_system_info": env.get_system_info,
        "print": print,
    }
    
    def target():
        try:
            exec(harness_code, namespace)
            if "run" in namespace and callable(namespace["run"]):
                return str(namespace["run"]())
            return "Harness executed successfully."
        except Exception as e:
            return f"Harness execution error: {str(e)}"
            
    return await asyncio.to_thread(target)
