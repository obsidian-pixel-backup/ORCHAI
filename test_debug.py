import asyncio
import httpx
import re

async def run():
    payload = {
        "model": "qwen3.5:4b",
        "messages": [
            {"role": "system", "content": "You are a precise title generator. You only output plain 2-4 words, nothing else."},
            {"role": "user", "content": "Hello there"}
        ],
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": 1000
        },
        "think": True
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post('http://127.0.0.1:11434/api/chat', json=payload)
            if response.status_code == 200:
                data = response.json()
                print("RAW DATA:", data)
                title_text = data.get("message", {}).get("content", "").strip()
                title_text = re.sub(r'<think>.*?</think>', '', title_text, flags=re.DOTALL).strip()
                if title_text.lower().startswith("title:"):
                    title_text = title_text[6:].strip()
                elif title_text.lower().startswith("title "):
                    title_text = title_text[6:].strip()
                title_text = title_text.replace('"', '').replace("'", "").strip()
                if len(title_text) > 40:
                    title_text = title_text[:37] + "..."
                if title_text:
                    print("SUCCESS:", title_text)
                else:
                    print("FALLBACK BECAUSE EMPTY TITLE")
            else:
                print("NON-200 STATUS:", response.status_code)
    except Exception as e:
        print("EXCEPTION:", repr(e))

asyncio.run(run())
