# ORCHAI

**ORCHAI** is an Orchestration Wrapper focused on reducing attention rot and throughput decay. It provides a robust, native desktop experience on Windows using Electron and a Python backend.

## Project Overview

ORCHAI is designed as an agent orchestration application to help users efficiently solve complex development and computing problems. The application is built with a dual-stack architecture:

- **Frontend**: A React + TypeScript UI built with Vite and packaged as a Windows native desktop application using Electron.
- **Backend**: A Python FastAPI server handling orchestration logic, memory consolidation, system tool execution, and real-time WebSocket communication.
- **Sensory Input**: Built-in modules for speech-to-text (audio listener) and automated screen monitoring (screen watcher).

## Core Architecture & Rules

1. **Windows Native Desktop**: The application runs purely as an Electron desktop app. There are no browser-based web interfaces.
2. **Strict Modularity**: 
   - The application is built like lego bricks.
   - Each component or feature MUST be isolated in its own separate TypeScript (`.ts` or `.tsx`) file.
   - Each component's TypeScript file MUST have an accompanying, separate `.css` stylesheet.
3. **No Inline Styles**:
   - Inline styling is strictly forbidden. 
   - All styles must be defined in the component's dedicated CSS file and applied via class names.

## Features

- **Real-time Chat**: Bidirectional WebSocket communication between Electron and FastAPI.
- **Agent Orchestration**: Integrated tool execution (`read_file`, `write_file`, `list_directory`, `run_command`, `research_topic`) allowing the AI to interact with the host system.
- **Cognitive World State**: Asynchronous BM25 index and memory consolidation to maintain context over long-running sessions.
- **Chronological Thinking**: Supports native model reasoning via Ollama and correctly parses sequential `<think>` tags generated during multi-turn tool usage loops.

## Getting Started

### Prerequisites

- Node.js (v18+)
- Python (3.10+)
- Ollama (installed locally)

### Installation & Running

The easiest way to start the entire application (both frontend and backend) on Windows is using the provided batch script:

```bash
.\start.bat
```

**To run the components manually:**

1. **Start the Backend:**
   ```bash
   cd backend
   pip install -r requirements.txt
   python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
   ```

2. **Start the Frontend:**
   ```bash
   cd frontend
   npm install
   npm run electron:dev
   ```

## Development & Testing

- Python backend tests can be run from the root directory using pytest:
  ```bash
  python -m pytest test_*.py -v
  ```
- To test the electron setup:
  ```bash
  node test_electron.cjs
  ```

For more details on developing within the project, see [CLAUDE.md](CLAUDE.md).
