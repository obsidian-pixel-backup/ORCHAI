import asyncio
import httpx

async def run():
    payload = {
        "model": "qwen3.5:4b",
        "messages": [
            {"role": "system", "content": "You are a precise title generator. You only output plain 2-4 words, nothing else."},
            {"role": "user", "content": "Generate a brief, fitting title for a conversation that starts with this message:\n\"Hello there\"\n\nInstructions:\n1. The title must be highly descriptive and strictly between 2 to 4 words.\n2. Output ONLY the plain title text. Do not wrap it in quotes, do not add a period, and do not add any explanation."}
        ],
        "stream": False,
        "options": {
            "temperature": 0.3
        },
        "think": True
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post('http://127.0.0.1:11434/api/chat', json=payload)
        print("Status Code:", r.status_code)
        print("Response Text:", r.text)

asyncio.run(run())
