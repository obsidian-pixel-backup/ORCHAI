# ORCHAI - TODO List

## Current Status
- **Foundation Built**: Dual-stack architecture (Electron + FastAPI) is operational.
- **Chat Interface**: Fully functional Chat Interface component with bidirectional WebSocket communication.
- **Agent Tools**: Core system tools (`read_file`, `write_file`, `list_directory`, `run_command`, `research_topic`) are implemented and thread-safe.
- **Cognitive Systems**: Basic BM25-based memory consolidation is implemented.

## High Priority

### 1. Vision & Sensory Modalities
- [ ] **Screen Watcher Integration**: Connect the screen watcher module (`sensory/screen_watcher.py`) to a Vision LLM to allow the agent to "see" the desktop context.
- [ ] **Local Audio Transcriber**: Replace the placeholder speech-to-text logic in `sensory/audio_listener.py` with a fully local Whisper model (e.g., `whisper.cpp` or `faster-whisper`) for privacy-respecting audio processing.

### 2. UI / UX Expansion
- [ ] **Chat Management Panel**: Implement UI for managing historical chats, deleting old chats, and branching conversations.
- [ ] **Model Settings Panel**: Implement a settings UI to switch between models, adjust temperature, context limits, and other hyper-parameters.
- [ ] **Tool Usage Visualization**: Enhance the Chat Message component to better visualize when tools are actively running or streaming data, avoiding the generic "thinking" loader.

### 3. Agent Architecture & Security
- [ ] **Sandboxing**: Improve the security of `run_command` in `system_tools.py` to prevent accidental destructive commands, perhaps via an approval-based loop for dangerous operations.
- [ ] **Prompt Tuning**: Refine the memory consolidation prompts in `context_engine.py` to improve how the model compresses old dialogue into dense knowledge artifacts.
- [ ] **Sub-agents**: Explore adding hierarchical sub-agents for specialized tasks (e.g., a dedicated web-researcher agent that feeds data back to the primary orchestrator).

## Low Priority / Polish
- [ ] **Test Coverage**: Expand the `test_*.py` suite to cover edge cases in WebSocket disconnection and reconnection.
- [ ] **Cross-Platform**: While currently Windows-focused, evaluate the feasibility of abstracting Windows-specific logic (like screen capture APIs) for macOS/Linux compatibility in the future.
- [ ] **Theming**: Add a comprehensive dark/light mode toggle with CSS variables.
