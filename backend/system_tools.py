import os
import subprocess
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
