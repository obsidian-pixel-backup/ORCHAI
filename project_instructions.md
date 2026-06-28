# ORCHAI - Project Instructions and Architecture Rules

## Core Philosophy
This project is an Orchestration Wrapper focused on reducing attention rot and throughput decay. It provides a robust, native desktop experience on Windows using Electron and a Python backend.

## Architectural Rules
1. **Windows Native Desktop**: The application is an Electron desktop app. No browser-based web interfaces.
2. **Backend**: Python backend for orchestration logic.
3. **Strict Modularity**:
   - The application must be built like lego bricks.
   - Each component or feature MUST be in its own separate TypeScript (`.ts` or `.tsx`) file.
   - Each component's TypeScript file MUST have an accompanying, separate `.css` stylesheet.
4. **No Inline Styles**: 
   - Inline styling is strictly forbidden. 
   - All styles must be defined in the component's dedicated CSS file and applied via class names.
5. **Initial Focus**: The first deliverable will be the Chat Interface component.

## Modularity Benefits
By strictly enforcing this modularity (one `.ts` + one `.css` per component), we ensure:
- Extremely fast isolation of faulty modules when bugs arise.
- Highly scalable and manageable codebase as the orchestration wrapper grows in complexity.
