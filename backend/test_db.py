import sqlite3, json

with sqlite3.connect('E:/DEVELOPER PROJECTS/ORCHAI/backend/orchai_memory.db') as conn:
    c = conn.cursor()
    c.execute("SELECT role, tool_calls_json, name FROM messages WHERE session_id = 'default' ORDER BY msg_index ASC")
    rows = c.fetchall()

for r in rows[-5:]:
    print(r)
