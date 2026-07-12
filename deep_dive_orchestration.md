# ORCHAI Orchestration Wrapper — Deep Dive Analysis

## Project Overview

**Location:** `E:\DEVELOPER PROJECTS\ORCHAI`  
**Type:** Windows-native desktop application combining Electron frontend + Python FastAPI backend  
**Purpose:** Autonomous agent orchestration wrapper enabling real-time chat with local LLMs (via Ollama) for solving complex development and computing problems.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                    ELECTRON FRONTEND                     │
│  React + TypeScript + Vite → Desktop App                │
│  - ChatInterfacePanel (streaming, tool visualization)   │
│  - ChatManagementPanel (sessions CRUD)                  │
│  - ModelSettingsPanel (model selection, config)         │
└──────────────┬──────────────────────────────────────────┘
               │ WebSocket (/api/chat/ws) + REST API
               ▼
┌─────────────────────────────────────────────────────────┐
│                   FASTAPI BACKEND                        │
│  Port: 127.0.0.1:8000                                   │
│                                                          │
│  main.py — App entry, lifespan, sensor init             │
│  ┌──────────────────────────────────────────────────┐   │
│  │ api/chat.py — WebSocket handler + stream_ollama  │   │
│  │ • Core orchestration loop (while True)           │   │
│  │ • Tool call detection & execution                │   │
│  │ • Hyperspace cluster routing                     │   │
│  │ • Psycho Loop / scaffold guards                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  api/context_engine.py — ContextOrchestrator            │
│  api/autonomous_loop.py — Goal formation/reflection     │
│  sensory/audio_listener.py — Real-time speech-to-text   │
│  sensory/screen_watcher.py — Periodic vision analysis   │
│  sub_agents.py — Delegated LLM agents                   │
│  web_research.py — DuckDuckGo + Google search/scraping  │
│  skills.py — Functional skill registry                  │
│  cluster_manager.py — Distributed Hyperspace nodes      │
│  scaffold_runner.py — Ornith Python harness             │
│  system_tools.py — File/command execution               │
└─────────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│                    STORAGE & INFERENCE                   │
│  SQLite: orchai_memory.db (sessions, messages)          │
│  Ollama: 127.0.0.1:11434 (default LLM server)          │
│  Hyperspace: 127.0.0.1:8081 (distributed cluster)      │
└─────────────────────────────────────────────────────────┘
```

---

## Core Components Deep Dive

### 1. `main.py` — Application Entry & Lifespan

**Responsibilities:**
- FastAPI app initialization with custom logging (INFO→stdout, WARNING+→stderr for Electron compatibility)
- Ollama auto-start fallback if not running on port 11434
- Distributed Inference Cluster Manager (`cluster_manager`) startup
- Sensory module initialization (AudioListener + ScreenWatcher) in background thread
- Autonomous background task loop for goal formation/reflection
- REST endpoints for sensor status/toggles, world state management

**Key Pattern:** Uses `@asynccontextmanager lifespan()` to coordinate async startup/shutdown of all subsystems.

---

### 2. `api/chat.py` — The Heart of Orchestration (300+ lines)

This is the core orchestration engine. It handles:

#### WebSocket Connection Management
- `ConnectionManager` tracks active WebSocket connections per session
- Handles actions: `cancel`, `tool_approve`, and chat message payloads

#### Tool Definition & Execution (`_execute_tool`)
The tool sandboxing system supports 15+ tools with two execution modes:

**Approval-required tools** (user must approve in UI):
- `run_command` — PowerShell command execution
- `run_python_script` — Python script execution  
- `manage_git_repo` — Git operations
- `query_database` — SQLite queries

**Direct-execute tools:**
- `search_web`, `scrape_page`, `get_system_info`
- `read_file`, `write_file`, `append_file`, `list_directory`
- `send_http_request`
- `delegate_to_subagent` (spawns background LLM agent)
- `get_persona`, `update_persona`
- `search_memory_bank` (BM25 search across archived messages)
- `checkpoint_session` (context window flush with world state preservation)

**Tool Approval Flow:**
1. Model requests tool execution → backend sends `tool_approval_request` via WebSocket
2. User approves/denies in UI
3. Command executes in background thread (`asyncio.to_thread`)
4. Results streamed back as `stream` message

#### The Orchestration Loop (`stream_ollama_response`)

This is the main generation loop — a sophisticated `while True` cycle:

```python
while True:
    # 1. Hard loop guards (consecutive_tool_iterations > 100, etc.)
    # 2. Build request payload based on provider (Ollama vs Hyperspace)
    # 3. Stream response from LLM
    # 4. Parse tool calls from streaming output (native or fallback regex parsers)
    # 5. Execute each tool call → add results to message history
    # 6. If checkpoint_session: flush context, update world state, restart loop
    # 7. If Ornith model + harness match: run self-scaffold stage 1
    # 8. If no tool calls: send stream_end, trigger background consolidation/evolution
```

**Key Features:**
- **Dual Provider Support**: Ollama (default) and Hyperspace (distributed cluster via `cluster_manager`)
- **Auto Token Budgeting**: Dynamically calculates `num_ctx` based on prompt size
- **Tool Call Parsing**: Native + 3 fallback regex parsers (XML/Hermes, Markdown JSON, GLM-4 CALL format)
- **Psycho Loop Guard**: Detects identical content/tool repetition and halts generation
- **Ornith Harness**: Special support for "ornith" models with Python self-scaffold execution
- **Thinking Token Tracking**: Full <think>/</think> block streaming with timing

---

### 3. `api/context_engine.py` — ContextOrchestrator (400+ lines)

The memory management engine with three-layer architecture:

#### Layer 1: Active Window (`partition_context`)
- Maintains recent messages within configurable token limit (default 64k)
- Iterates backwards from most recent, filling up to `effective_limit`
- Strips orphaned tool messages at the start for Jinja parser compatibility

#### Layer 2: BM25 Sparse Memory Index (`SparseMemoryIndex`)
- Zero-dependency Python BM25 implementation
- Tokenizes with lowercase, alphanumeric filtering, English stopwords removal
- Supports `search(query, top_k=3)` returning ranked message snippets
- Emotional valence weighting (±10% boost for emotionally charged memories)

#### Layer 3: World State Consolidation (`consolidate_memory_background`)
- Asynchronously merges archived messages into a compressed world state summary (~600 words max)
- Triggered via `dynamic_consolidation` flag after each turn
- Uses Ollama/Hyperspace to generate the consolidation prompt
- Persists to SQLite + writes to `{project}/memories/{session_id}/world_state.md`

#### Persona Evolution (`evolve_persona_background`)
- Analyzes last 6 messages (3 turns) for personality shifts
- Updates `persona_state` and `emotional_state` via LLM prompt
- Parses output markdown blocks with rollback on generation mismatch
- Persists to SQLite + `{project}/memories/{session_id}/persona_state.md`

#### Key Methods:
| Method | Purpose |
|--------|---------|
| `sync_frontend_state()` | Syncs local history with frontend (handles edits/truncations) |
| `add_message()` | Adds message, indexes it, persists to SQLite (async via thread) |
| `build_orchestrated_prompt()` | Constructs full LLM input: system prompt + persona + world state + active window + dynamic context |
| `branch_from()` | Duplicates session from source up to a specific message |
| `get_stats()` | Computes context distribution stats for frontend dashboard |

---

### 4. `sub_agents.py` — Delegated LLM Agents

Spawns isolated, autonomous LLM agents:

**Web Researcher Sub-Agent:**
- Runs an independent chat loop with `search_web` + `scrape_page` tools
- Temperature 0.2 for focused research
- Context window: 131k tokens
- Loops until final report is generated (no tool calls = done)
- Truncates scraped pages at 10k chars to prevent context blowup

---

### 5. `web_research.py` — Web Research Pipeline

**Search:** DuckDuckGo via `ddgs` library → Google fallback via `nodriver` headless browser
**Scraping:** httpx (fast) → nodriver (JS/Cloudflare bypass) fallback chain
**Research Topic:** Master function that searches, semaphores concurrent scraping (max 2), and aggregates results

---

### 6. `skills.py` — Functional Skill Registry

Skills are activated via `[Skill: <label>]` markers in user messages. The system detects them and injects specialized methodology into the system prompt for that turn only.

**Built-in Skills:**
| ID | Label | Description |
|----|-------|-------------|
| `code_review` | Code review | Bug & quality audit with severity tagging |
| `security_audit` | Security audit | Threat modeling, vulnerability scanning |
| `deep_research` | Deep research | Multi-source cited investigation |
| `doc_writer` | Documentation | Technical docs from code |
| `long_form_writer` | Long-Form Writer | Iterative document generation with checkpointing |
| `infinite_architect` | Infinite Architect | Ledger-based infinite-horizon workflows |
| `self_evolution` | Self-Evolution | Reflect and update goals/persona |

**Persistence:** Skills saved to `orchai_skills.json`, user-editable via management UI.

---

### 7. `cluster_manager.py` — Distributed Inference Cluster

Manages Hyperspace distributed inference nodes:
- Starts/stops individual GPU compute nodes
- Resolves GGUF model paths via Ollama's `--modelfile` mechanism
- Routes requests to appropriate cluster endpoints (`127.0.0.1:8081`)
- Ensures the right model is loaded on a node before routing

---

### 8. `sensory/audio_listener.py` — Real-Time Speech Input

- Uses `sounddevice` for raw PCM audio capture (16kHz, mono)
- Energy-based voice activity detection with 1.5s silence threshold
- Transcribes via faster-whisper (`base.en`, CPU int8)
- Callback fires into chat as user message when speech detected
- Mock mode available for testing without hardware

---

### 9. `sensory/screen_watcher.py` — Automated Vision Monitoring

- Captures screenshots at configurable intervals (default 5s)
- Scales to 1024×1024 for vision model input
- Routes captured images to Ollama's `llava` vision model
- Injects desktop context descriptions into the ContextOrchestrator

---

## Data Flow: User Message → Response

```
User types message in Electron UI
  │
  ▼
WebSocket sends payload {session_id, messages[], model, options} to FastAPI
  │
  ▼
stream_ollama_response() called
  │
  ├─→ ContextOrchestrator.sync_frontend_state(raw_messages)
  │   (syncs local history with frontend edits/truncations)
  │
  ├─→ ContextOrchestrator.build_orchestrated_prompt(last_query, tools)
  │   (assembles: system prompt + persona + world state + 
  │    active window messages + dynamic context [time, sensory, recalled memories])
  │
  ├─→ stream to Ollama/Hyperspace with full payload
  │
  ├─→ Parse streaming chunks for tool calls
  │   (native parsing + fallback regex: XML/JSON/GLM)
  │
  ├─→ Execute each tool call via _execute_tool()
  │   (approval-gated or direct, results streamed back to frontend)
  │
  ├─→ Add tool results to orchestrated_messages
  │
  └─→ Loop continues until no more tool calls
      │
      ├─→ If Ornith model + harness: run stage 1 scaffold → stage 2 rollout
      │
      └─→ Send stream_end with stats, thinking blocks, world state update
          │
          ├─→ ContextOrchestrator.consolidate_memory_background() (async)
          └─→ ContextOrchestrator.evolve_persona_background() (async)
```

---

## Persistence Layer

**SQLite Database (`orchai_memory.db`):**
- `sessions` table: session_id, world_state, persona_state, config settings
- `messages` table: id, role, content, timestamp, estimated_tokens, tool_calls_json, emotional_valence
- All DB operations run in background threads via `_run_in_db_thread()` for async non-blocking

**File System:**
- `{project}/memories/{session_id}/world_state.md` — Consolidated world state per session
- `{project}/memories/{session_id}/persona_state.md` — Evolved persona per session
- `orchai_skills.json` — User-customized skill registry
- Frontend localStorage: `orchai_chats`, `orchai_active_chat_id`

---

## Guard & Safety Mechanisms

1. **Hard Loop Guards**: `consecutive_tool_iterations > 100` or `consecutive_scaffold_iterations > 50` → halt
2. **Psycho Loop Guard**: Detects identical content/tool signatures (3+ repeats) → error injection + retry
3. **Orphaned Tool Message Safety**: Strips orphaned `tool` messages in prompt assembly for Jinja parser compatibility
4. **Tool Approval Flow**: User-gated execution for destructive operations (commands, file writes, git, DB queries)
5. **Dynamic Context Window**: Auto-calculates `num_ctx` as power of 2 with min/max bounds (4096–131072)
6. **Generation Mismatch Guards**: Persona/world state updates only apply if generation counter hasn't changed

---

## Key Design Decisions

- **Async-first backend**: All I/O uses `asyncio`, DB operations offloaded to threads
- **Session-per-context-engine**: Each chat session gets its own `ContextOrchestrator` with independent memory
- **BM25 for recall**: No vector embeddings — lightweight sparse indexing avoids ML dependencies
- **Skill injection over tool abstraction**: Skills modify behavior at the prompt level, not via a separate API
- **Dual inference providers**: Ollama (local) + Hyperspace (distributed GPU cluster) unified under same interface
