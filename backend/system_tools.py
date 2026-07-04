import os
import subprocess
import json
import sqlite3
import urllib.request
import urllib.error
import shlex
from typing import Dict, Any, Optional

def read_file(filepath: str) -> str:
    """Safely reads and returns the contents of a text file."""
    try:
        if not os.path.exists(filepath):
            return f"Error: File '{filepath}' does not exist."
        if not os.path.isfile(filepath):
            return f"Error: '{filepath}' is not a file."
            
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        return f"Error reading file '{filepath}': {str(e)}"

def write_file(filepath: str, content: str) -> str:
    """Writes or overwrites a file with the provided content."""
    try:
        # Create directories if they don't exist
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return f"Successfully wrote to '{filepath}'."
    except Exception as e:
        return f"Error writing to file '{filepath}': {str(e)}"

def append_file(filepath: str, content: str) -> str:
    """Appends content to a file, creating it if it doesn't exist."""
    try:
        # Create directories if they don't exist
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        
        with open(filepath, 'a', encoding='utf-8') as f:
            f.write(content)
        return f"Successfully appended to '{filepath}'."
    except Exception as e:
        return f"Error appending to file '{filepath}': {str(e)}"

def list_directory(path: str) -> str:
    """Lists all files and folders in a given directory."""
    try:
        if not os.path.exists(path):
            return f"Error: Directory '{path}' does not exist."
        if not os.path.isdir(path):
            return f"Error: '{path}' is not a directory."
            
        entries = os.listdir(path)
        if not entries:
            return f"Directory '{path}' is empty."
            
        result = [f"Contents of {path}:"]
        for entry in sorted(entries):
            full_path = os.path.join(path, entry)
            if os.path.isdir(full_path):
                result.append(f"  [DIR]  {entry}")
            else:
                size = os.path.getsize(full_path)
                result.append(f"  [FILE] {entry} ({size} bytes)")
                
        return "\n".join(result)
    except Exception as e:
        return f"Error listing directory '{path}': {str(e)}"

def run_command(command: str) -> str:
    """
    Executes a terminal/PowerShell command and returns the output.
    Note: Requires explicit user approval for potentially harmful manipulations.
    """
    try:
        # Running with shell=True for windows command support
        process = subprocess.Popen(
            command, 
            shell=True, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = process.communicate(timeout=60)
        
        result = []
        if stdout:
            result.append("--- STDOUT ---")
            result.append(stdout.strip())
        if stderr:
            result.append("--- STDERR ---")
            result.append(stderr.strip())
            
        if not result:
            return f"Command executed successfully with no output (Exit Code: {process.returncode})."
            
        result.append(f"--- Exit Code: {process.returncode} ---")
        return "\n".join(result)
        
    except subprocess.TimeoutExpired:
        process.kill()
        return "Error: Command timed out after 60 seconds."
    except Exception as e:
        return f"Error executing command: {str(e)}"

def run_python_script(script_path: str, args: str = "") -> str:
    """
    Executes a Python script securely.
    """
    try:
        if not os.path.exists(script_path):
            return f"Error: Script '{script_path}' does not exist."
            
        cmd = ["python", script_path]
        if args:
            # Simple split by space, handling quotes is better with shlex
            try:
                parsed_args = shlex.split(args)
                cmd.extend(parsed_args)
            except Exception:
                cmd.extend(args.split())
                
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = process.communicate(timeout=120)
        
        result = []
        if stdout:
            result.append("--- STDOUT ---")
            result.append(stdout.strip())
        if stderr:
            result.append("--- STDERR ---")
            result.append(stderr.strip())
            
        if not result:
            return f"Script executed successfully with no output (Exit Code: {process.returncode})."
            
        result.append(f"--- Exit Code: {process.returncode} ---")
        return "\n".join(result)
        
    except subprocess.TimeoutExpired:
        process.kill()
        return "Error: Script timed out after 120 seconds."
    except Exception as e:
        return f"Error executing script '{script_path}': {str(e)}"

def send_http_request(method: str, url: str, headers: str = "", body: str = "") -> str:
    """
    Sends an HTTP request.
    """
    try:
        req_headers = {}
        if headers:
            try:
                req_headers = json.loads(headers)
            except json.JSONDecodeError:
                return "Error: headers must be a valid JSON string."
                
        req_body = body.encode('utf-8') if body else None
        
        req = urllib.request.Request(url, data=req_body, headers=req_headers, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                status = response.getcode()
                response_body = response.read().decode('utf-8')
                return f"Status: {status}\n\n{response_body}"
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            return f"HTTP Error {e.code}: {e.reason}\n\n{error_body}"
        except urllib.error.URLError as e:
            return f"URL Error: {e.reason}"
    except Exception as e:
        return f"Error sending HTTP request: {str(e)}"

def manage_git_repo(repo_path: str, action: str, commit_message: str = "", branch: str = "", url: str = "") -> str:
    """
    Executes safe Git operations.
    """
    try:
        if action.lower() != "clone" and not os.path.exists(repo_path):
            return f"Error: Repository path '{repo_path}' does not exist."
            
        action = action.lower()
        cmd = ["git"]
        
        if action == "status":
            cmd.extend(["status"])
        elif action == "add":
            cmd.extend(["add", "."])
        elif action == "commit":
            if not commit_message:
                return "Error: commit_message is required for commit action."
            cmd.extend(["commit", "-m", commit_message])
        elif action == "push":
            cmd.extend(["push"])
        elif action == "pull":
            cmd.extend(["pull"])
        elif action == "checkout":
            if not branch:
                return "Error: branch is required for checkout action."
            cmd.extend(["checkout", branch])
        elif action == "clone":
            if not url:
                return "Error: url is required for clone action."
            cmd.extend(["clone", url, repo_path])
            # For clone, we run outside the repo path (it creates it)
            repo_path = os.path.dirname(os.path.abspath(repo_path))
        else:
            return f"Error: Unsupported git action '{action}'."
            
        process = subprocess.Popen(
            cmd,
            cwd=repo_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = process.communicate(timeout=60)
        
        result = []
        if stdout:
            result.append(stdout.strip())
        if stderr:
            result.append(stderr.strip())
            
        if not result:
            return f"Git {action} executed successfully."
            
        return "\n".join(result)
        
    except subprocess.TimeoutExpired:
        process.kill()
        return "Error: Git command timed out."
    except Exception as e:
        return f"Error executing git command: {str(e)}"

def query_database(db_path: str, query: str) -> str:
    """
    Executes a SQL query against an SQLite database.
    """
    try:
        if not os.path.exists(db_path) and not query.lower().startswith("create"):
            return f"Error: Database '{db_path}' does not exist."
            
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute(query)
        if query.lower().strip().startswith("select"):
            rows = cursor.fetchall()
            columns = [description[0] for description in cursor.description] if cursor.description else []
            
            if not rows:
                result = "No rows returned."
            else:
                result = f"Columns: {', '.join(columns)}\n"
                for row in rows:
                    result += str(row) + "\n"
        else:
            conn.commit()
            result = f"Query executed successfully. {cursor.rowcount} row(s) affected."
            
        conn.close()
        return result
    except Exception as e:
        return f"Error executing database query: {str(e)}"
