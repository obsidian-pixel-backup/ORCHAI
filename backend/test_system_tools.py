import os
from system_tools import read_file, write_file, list_directory, run_command
from system_tools import run_python_script, send_http_request, query_database, manage_git_repo

def test_file_operations():
    test_file = "test_sys_tools.txt"
    content = "Hello ORCHAI System Tools!"
    
    # Write
    res_write = write_file(test_file, content)
    print(f"Write: {res_write}")
    
    # Read
    res_read = read_file(test_file)
    print(f"Read: {res_read}")
    
    # List
    res_list = list_directory(".")
    print("List dir (truncated):", res_list.split("\n")[:5])
    
    # Run command
    res_cmd = run_command("echo hello world")
    print(f"Command: {res_cmd}")
    
    # Cleanup
    if os.path.exists(test_file):
        os.remove(test_file)

def test_new_tools():
    print("\n--- Testing New Tools ---")
    
    # 1. run_python_script
    test_script = "test_script.py"
    write_file(test_script, "print('Hello from script!')")
    res_py = run_python_script(test_script)
    print(f"run_python_script:\n{res_py}")
    if os.path.exists(test_script):
        os.remove(test_script)
        
    # 2. send_http_request
    res_http = send_http_request("GET", "https://httpbin.org/get")
    print(f"send_http_request (truncated):\n{res_http[:100]}...")
    
    # 3. query_database
    test_db = "test.db"
    query_database(test_db, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    query_database(test_db, "INSERT INTO users (name) VALUES ('Alice'), ('Bob')")
    res_db = query_database(test_db, "SELECT * FROM users")
    print(f"query_database:\n{res_db}")
    if os.path.exists(test_db):
        os.remove(test_db)
        
    # 4. manage_git_repo
    test_repo = "test_repo"
    os.makedirs(test_repo, exist_ok=True)
    res_git_init = run_command(f"git init {test_repo}") # initialize it
    res_git_status = manage_git_repo(test_repo, "status")
    print(f"manage_git_repo (status):\n{res_git_status}")
    import shutil
    if os.path.exists(test_repo):
        shutil.rmtree(test_repo)

if __name__ == "__main__":
    test_file_operations()
    test_new_tools()
