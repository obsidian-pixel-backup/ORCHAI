# ORCHAI - TODO List

## Current Status
- **Foundation Built**: Dual-stack architecture (Electron + FastAPI) is operational.
- **Chat Interface**: Fully functional Chat Interface component with bidirectional WebSocket communication.
- **Agent Tools**: Core system tools (`read_file`, `write_file`, `list_directory`, `run_command`, `research_topic`) are implemented and thread-safe.
- **Cognitive Systems**: Basic BM25-based memory consolidation is implemented.

## Completed
- [x] **Chat Management Panel**: Implemented UI for managing historical chats, deleting old chats, and branching conversations.
- [x] **Model Settings Panel**: Implemented a settings UI to switch between models, adjust temperature, context limits, and other hyper-parameters.
- [x] **Screen Watcher Integration**: Connected the screen watcher module to a Vision LLM (`llava`) to allow the agent to "see" the desktop context.
- [x] **Local Audio Transcriber**: Replaced the Google speech-to-text logic with a fully local `faster-whisper` model.
- [x] **Sandboxing**: Improved the security of `run_command` in `system_tools.py` via an interactive approval-based websocket loop.
- [x] **Tool Usage Visualization**: Enhanced the Chat Message component to chronologically visualize tool execution payloads and commands.

## High Priority
- [ ] **Prompt Tuning**: Refine the memory consolidation prompts in `context_engine.py` to improve how the model compresses old dialogue into dense knowledge artifacts.
- [ ] **Sub-agents**: Explore adding hierarchical sub-agents for specialized tasks (e.g., a dedicated web-researcher agent that feeds data back to the primary orchestrator).

## Low Priority / Polish
- [ ] **Test Coverage**: Expand the `test_*.py` suite to cover edge cases in WebSocket disconnection and reconnection.
- [ ] **Cross-Platform**: While currently Windows-focused, evaluate the feasibility of abstracting Windows-specific logic (like screen capture APIs) for macOS/Linux compatibility in the future.
- [ ] **Theming**: Add a comprehensive dark/light mode toggle with CSS variables.
