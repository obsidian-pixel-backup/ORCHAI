# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ORCHAI is a Windows native desktop application that combines an Electron frontend with a Python backend. The project follows strict modular design principles where each feature or component is encapsulated in its own separate TypeScript (`.ts`/`.tsx`) file and corresponding CSS stylesheet.

**Key Architecture:**
- **Frontend**: React + TypeScript using Vite, bundled for Electron desktop app
- **Backend**: Python FastAPI server running on 127.0.0.1:8000 with real-time WebSocket support
- **Sensory Input**: Audio listener and screen watcher modules for user interaction
- **Modularity**: One `.ts` file + one `.css` per component (no inline styles)

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
node test_electron.cjs                     # Electron debugging helper (from root)
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
- **Entry Points:** `src/main.tsx` (React), `electron/main.js` (Electron process)
- **Components:** Each in separate folders under `src/components/` (ChatInterfacePanel, ChatManagementPanel, ModelSettingsPanel)
- **Configuration:** 
  - TypeScript configs: `tsconfig.app.json`, `tsconfig.electron.json`
  - Build tool: Vite (`vite.config.ts`)
  - Linting: ESLint (`eslint.config.js`)

### Backend (`backend/`)
- **API Entry:** `main.py` (FastAPI server with lifespan management)
- **Core Logic:** 
  - `api/chat.py` - WebSocket chat implementation
  - `context_engine.py` - Context management system
- **Sensory Systems:** 
  - `sensory/audio_listener.py` - Speech-to-text processing
  - `sensory/screen_watcher.py` - Screen capture and monitoring
- **Data Storage:** SQLite database (`orchai_memory.db`)
- **System Tools:** `system_tools.py` for system interactions

### Root Directory Files
- **Development Scripts:**
  - `start.bat` - Entry point to start the entire app (Windows)
  - `test_*.py` files - Various testing utilities and tests
- **Dependencies:** `requirements.txt` (Python) + auto-generated from npm deps

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

## Important Notes

### Windows Desktop Focus
This is specifically a Windows native desktop application using Electron. There are no web-based interfaces or APIs serving user-facing content directly.

### Dependency Management
- **Frontend**: `npm install` in frontend directory
- **Backend**: Python dependencies via requirements.txt, system tools available at project root

### Key Features to Explore
1. **Real-time Chat**: WebSocket-based communication between Electron and FastAPI
2. **Audio Processing**: Automatic speech detection and processing capabilities
3. **Screen Watching**: Automated screen monitoring (interval-based)
4. **Context Management**: Persistent conversation context handling

## Support & Documentation

**For further development:**
- Project instructions in `project_instructions.md`
- Current implementation in App.tsx for Chat Interface component
- Sensory modules provide audio and input processing capabilities

**Development Commands Reference:**
```bash
# Full development stack
npm run electron:dev           # Complete Electron desktop app with live reload
cd frontend && npm run dev     # Just frontend development server
python ../test_debug.py    # Debug utilities
python -m pytest               # Run all tests
```

**Critical Files to Remember:**
- Frontend: `frontend/src/components/`, `frontend/package.json`
- Backend: `backend/main.py`, `backend/api/chat.py`, `backend/sensory/audio_listener.py`
- Root: `start.bat`, test_*.py files

## Recent Updates (June 2026)

### Git & GitHub Deployment
- **Repository**: Deployed the ORCHAI codebase to a private GitHub repository at `https://github.com/obsidian-pixel-backup/ORCHAI`.
- **Collaborators**: Invited `omesan` to the project as a collaborator.
- **Root `.gitignore`**: Established root-level rules to exclude build outputs (`frontend/dist/`), package dependencies (`frontend/node_modules/`), local python caches (`__pycache__/`), and local database files (`backend/orchai_memory.db`).

### Codebase Optimizations
- **Backend Chat Streaming (`backend/api/chat.py`)**: Enhanced WebSocket chat router to properly track and merge internal reasoning/thinking segments across multi-step tool iterations, and run blocking system tools asynchronously in threads.
- **Context Engine (`backend/api/context_engine.py`)**: Fixed indexing bounds during background memory consolidation and preserved extra message metadata (`tool_calls`, `name`) when replicating message contexts.
- **Frontend App & Streaming State (`frontend/src/App.tsx`, `ChatInterfacePanel.tsx`)**: Re-factored state cleanup when deleting the active chat, and synchronized mutable model options using refs during socket connection streams.

### Advanced Capabilities (June 28, 2026)
- **Local Audio Transcriber (Whisper)**: Replaced the Google Speech API with local `faster-whisper`. Audio is processed natively from raw PCM bytes without requiring `ffmpeg`.
- **Vision LLM Integration (Screen Watcher)**: The screen watcher module now automatically scales screenshots down to 1024x1024 and routes them to Ollama's `llava` vision model. The model generates a succinct description of the user's desktop context, which is actively injected into the ContextOrchestrator's world state via a new `/world-state/sensory` REST endpoint.
- **Tool Sandboxing**: To prevent destructive actions, the backend now pauses tool execution streams and sends an interactive approval request to the React frontend. Execution resumes only after the user explicitly approves the command payload from the chat interface.
- **Tool UI Visualization**: `ChatMessage.tsx` was enhanced to parse and chronologically render chronological blocks of tool executions (as informative pills) and tool approval prompts above the final streamed response.