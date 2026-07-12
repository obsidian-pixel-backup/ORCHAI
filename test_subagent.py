import asyncio
from backend.sub_agents import delegate_to_subagent

async def main():
    result = await delegate_to_subagent("web-researcher", "Cape Town weather next 3 days", model="hf.co/llmfan46/Qwen3.6-35B-A3B-uncensored-heretic-GGUF:q4_K_M")
    print("RESULT:", result)

asyncio.run(main())
