import sqlite3, json

with sqlite3.connect('E:/DEVELOPER PROJECTS/ORCHAI/backend/orchai_memory.db') as conn:
    c = conn.cursor()
    c.execute("SELECT id, role, content, tool_calls_json, name FROM messages WHERE session_id = 'default' ORDER BY msg_index ASC")
    rows = c.fetchall()

messages = []
for r in rows:
    msg = {'id': r[0], 'role': r[1], 'content': r[2]}
    if r[3]: msg['tool_calls'] = json.loads(r[3])
    if r[4]: msg['name'] = r[4]
    messages.append(msg)

safe_messages = []
for msg in messages:
    if msg['role'] == 'tool':
        if not safe_messages or safe_messages[-1]['role'] not in ('assistant', 'tool'):
            print(f"Dropped orphaned tool message! Prev role was {safe_messages[-1]['role'] if safe_messages else None}")
            continue
    safe_messages.append(msg)

for i, m in enumerate(safe_messages):
    if m['role'] == 'tool':
        prev = safe_messages[i-1]
        print(f"Tool message found. Prev: {prev['role']}, has_tool_calls: {'tool_calls' in prev}")
