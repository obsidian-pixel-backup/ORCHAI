import requests

payload = {
    "session_id": "test_123",
    "model": "qwen3.5:4b",
    "first_message": "Hello, can you help me write a poem?"
}

try:
    res = requests.post("http://127.0.0.1:8000/api/chat/generate-title", json=payload, timeout=60)
    print("Status Code:", res.status_code)
    print("Response JSON:", res.json())
except Exception as e:
    print("Error:", e)
