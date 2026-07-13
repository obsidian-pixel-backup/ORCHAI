# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KLYDIS is a Windows-native desktop application that combines an Electron frontend with a Python FastAPI backend. The app acts as an autonomous agent orchestration wrapper, enabling users to solve complex development and computing problems through real-time chat with local LLMs (via Ollama).

**Key Architecture:**
- **Frontend**: React + TypeScript using Vite, packaged for Electron desktop
- **Backend**: Python FastAPI server on `127.0.0.1:8000` with WebSocket support
- **Communication**: Real-time bidirectional via WebSocket (`/api/chat/ws`) plus REST endpoints
- **Sensory Input**: Audio listener (speech-to-text) and screen watcher modules
- **Modularity**: One `.ts`/`.tsx` file + one `.css` per component (no inline styles)

## Development Commands

### Frontend Development (in `frontend/` directory)

**Building & Running:**
```bash
cd frontend
npm run dev          # Start Vite development server on port 5173
npm run electron:dev   # Build with Electron and start desktop app concurrently
npm run build        # TypeScript compile + Vite production build
npm run lint         # ESLint code linting (TypeScript)
npm run preview      # Preview production build locally
```

**Testing & Debugging:**
```bash
cd frontend
# Tests are located in the root directory, not in this folder
cd ..
python -m pytest test_*.py -v          # Run all Python tests
python test_debug.py                   # Debug mode for testing
node test_electron.cjs                 # Electron debugging helper (from root)
```

### Backend Development (in `backend/` directory)

**Starting the backend:**
```bash
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
# Or if running via start.bat:
.\start.bat
```

**Backend Testing:**
```bash
cd backend
# Python tests are in the root directory
python ../test_*.py -v               # Run all backend-related tests
cat requirements.txt                   # View Python dependencies
```

## Project Structure & Key Files

### Frontend (`frontend/`)
- **Entry Points:** `src/main.tsx` (React), `electron/main.ts` (Electron process)
- **Components:** Each in separate folders under `src/components/`:
  - `ChatInterfacePanel/` — Main chat UI with message streaming and tool visualization
  - `ChatManagementPanel/` — Chat session list, creation, deletion, renaming
  - `ModelSettingsPanel/` — Model selection, temperature, max tokens, context optimizer
- **Configuration:** 
  - TypeScript configs: `tsconfig.app.json`, `tsconfig.electron.json`
  - Build tool: Vite (`vite.config.ts`)
  - Linting: ESLint (`eslint.config.js`)

### Backend (`backend/`)
- **API Entry:** `main.py` (FastAPI server with lifespan management)
- **Core Logic:** 
  - `api/chat.py` — WebSocket chat router, tool execution orchestration, Ollama streaming
  - `api/context_engine.py` — ContextOrchestrator: active window partitioning, BM25 indexing, background memory consolidation
  - `api/speech.py` — Speech-to-text REST endpoint
- **Sensory Systems:** 
  - `sensory/audio_listener.py` — Real-time audio transcription using faster-whisper (base.en model)
  - `sensory/screen_watcher.py` — Periodic screen capture with vision LLM analysis via Ollama's llava
- **Data Storage:** SQLite database (`klydis_memory.db`) for session state persistence
- **System Tools:** `system_tools.py` for safe file/command operations
- **Agent Orchestration:** `sub_agents.py`, `web_research.py`, `skills.py`

## Architecture Details

### Communication Flow

1. **WebSocket (`/api/chat/ws`)**: Primary real-time channel for chat streaming
   - Message types: `stream`, `stream_end`, `tool_execution`, `tool_approval_request`, `sensory_input`, `error`
   - Actions: `cancel` (stop generation), `tool_approve` (approve sandboxed commands)

2. **REST API**: 
   - `/api/chat/skills` — List available functional skills
   - `/api/chat/models` — Fetch available Ollama models with reasoning/vision support
   - `/api/chat/generate-title` — Generate chat titles via LLM
   - `/api/chat/world-state` — Get/set consolidated world state
   - `/api/chat/config` — Update context limits and toggles
   - `/api/vision/status`, `/api/audio/status` — Sensor status endpoints

### Context Engine (`ContextOrchestrator`)

The context engine manages conversation history across sessions:
- **Active Window**: Recent messages within token limit (default 2000 tokens)
- **Archived History**: Older messages indexed for semantic retrieval
- **World State**: Consolidated summary of long-term context, updated asynchronously
- **BM25 Indexing**: Sparse memory index for fast episodic recall

Key methods:
- `partition_context()` — Split history into active vs archived based on token limits
- `consolidate_memory_background()` — Async task to merge new messages into world state via Ollama
- `build_orchestrated_prompt()` — Construct optimized LLM input with system prompt, world state, sensory data, and recalled memories

### Tool Execution Architecture

Tools are sandboxed with user approval:
1. Model requests tool execution (e.g., `run_command`)
2. Backend sends `tool_approval_request` to frontend via WebSocket
3. User approves/denies in UI
4. If approved, command executes in background thread (`asyncio.to_thread`)
5. Results streamed back as `stream` message with tool output

Available tools: `search_web`, `scrape_page`, `get_system_info`, `read_file`, `write_file`, `list_directory`, `run_command`, `delegate_to_subagent`

### Sensory Systems

**Audio Listener**: 
- Uses faster-whisper (`base.en`) for local speech-to-text
- Processes raw PCM audio (16kHz, mono) without requiring ffmpeg
- Energy-based voice activity detection with 1.5s silence threshold
- Callback mechanism: `on_speech_detected(text)` → injects into chat as user message

**Screen Watcher**: 
- Captures screenshots at configurable intervals (default 5s)
- Scales to 1024x1024 for vision model input
- Routes to Ollama's `llava` vision model for desktop context description
- Injects into ContextOrchestrator via `/world-state/sensory` endpoint

## Important Notes

### Windows Desktop Focus
This is specifically a Windows native desktop application using Electron. There are no web-based interfaces or APIs serving user-facing content directly. The backend runs locally on `127.0.0.1:8000`.

### Dependency Management
- **Frontend**: `npm install` in frontend directory
- **Backend**: Python dependencies via requirements.txt, system tools available at project root

### Key Features to Explore
1. **Real-time Chat**: WebSocket-based communication between Electron and FastAPI
2. **Audio Processing**: Automatic speech detection and processing capabilities
3. **Screen Watching**: Automated screen monitoring (interval-based)
4. **Context Management**: Persistent conversation context handling with BM25 indexing

### Ollama Integration
- Default URL: `http://127.0.0.1:11434`
- Auto-starts Ollama if not running (fallback mechanism in `main.py`)
- Supports reasoning models (ornith) with `<anth Thinking>` blocks
- Vision support detected via model family metadata (`clip`, `llava`, `vision`)

### State Persistence
- **Frontend**: Chat sessions stored in localStorage (`klydis_chats`, `klydis_active_chat_id`)
- **Backend**: Session state persisted to SQLite (`klydis_memory.db`) with session tables for world state and messages

## Development Workflow Guidelines

### Component Creation
When adding new features or components:

1. **Strict Modularity**: Create one `.ts`/`.tsx` file for the component logic AND a corresponding `.css` file with styles
2. **No Inline Styles**: All CSS must be in dedicated stylesheet files, applied via class names
3. **Isolation**: Each component should be self-contained and testable independently
4. **TypeScript**: Leverage strict typing - run `npm run build` regularly to catch type errors early

### Backend Development Patterns

1. **Async/Await First**: Use asyncio throughout the Python backend
2. **WebSocket Communication**: The chat router manages real-time bidirectional communication between frontend and backend
3. **Logging Configuration**: INFO/DEBUG goes to stdout (for Electron visibility), WARNING+ goes to stderr
4. **Sensory Integration**: AudioListener provides speech-to-text callback mechanism for user input processing

### Testing Strategy

**Python Tests:**
- Located in project root as test_*.py files
- Use pytest framework
- Test web research functionality, system tools, and WebSocket operations

**Frontend Development:**
- Vite HMR (Hot Module Replacement) during development
- No explicit frontend tests in this repository structure (tests are Python-based for backend logic)
