import os
from system_tools import read_file, write_file, list_directory, run_command

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

if __name__ == "__main__":
    test_file_operations()
