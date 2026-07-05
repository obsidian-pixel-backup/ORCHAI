import urllib.request, json
req = urllib.request.Request('http://127.0.0.1:11434/api/show', data=b'{"name": "north-mini-code-1.0:q4_K_M"}', headers={'Content-Type': 'application/json'})
try:
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    print(data.get('template', 'No template'))
except Exception as e:
    print('Error:', e)
