import paramiko
import os
import sys

DEBIAN_HOST = "192.168.0.102"
DEBIAN_USER = "debian"
DEBIAN_PASSWORD = "123"

try:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(DEBIAN_HOST, username=DEBIAN_USER, password=DEBIAN_PASSWORD, timeout=5)
    
    # Check if make is running
    stdin, stdout, stderr = ssh.exec_command("ps aux | grep make")
    print("Processes running make:")
    print(stdout.read().decode())
    
    # Check the latest log lines if compilation is happening
    stdin, stdout, stderr = ssh.exec_command("tail -n 20 ~/.klydis/bin/rpc.log || true")
    print("Log output:")
    print(stdout.read().decode())
    
    ssh.close()
except Exception as e:
    print(f"Error: {e}")
