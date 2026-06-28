import asyncio
from backend.sub_agents import delegate_to_subagent

async def main():
    result = await delegate_to_subagent("web-researcher", "Cape Town weather next 3 days", model="qwen3.5:4b")
    print("RESULT:", result)

asyncio.run(main())
