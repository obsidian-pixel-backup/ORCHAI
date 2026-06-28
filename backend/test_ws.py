import asyncio
import websockets
import json

async def test_chat():
    uri = "ws://127.0.0.1:8000/api/chat/ws"
    try:
        async with websockets.connect(uri) as websocket:
            payload = {
                "session_id": "test",
                "model": "qwen3.5:9b",
                "messages": [
                    {"role": "user", "content": "What is the current time and date?"}
                ]
            }
            await websocket.send(json.dumps(payload))
            
            while True:
                response = await websocket.recv()
                data = json.loads(response)
                print(data)
                if data.get("done") or data.get("type") == "stream_end":
                    break
    except Exception as e:
        print("Connection failed:", e)

asyncio.run(test_chat())
