from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import sys
import asyncio
from api.chat import router as chat_router, manager
from api.speech import router as speech_router, set_whisper_model

# Import our sensory modules
try:
    from sensory.audio_listener import AudioListener
    from sensory.screen_watcher import ScreenWatcher
    SENSORY_MODULES_LOADED = True
except ImportError as e:
    print(f"Warning: Could not load Sensory modules: {e}")
    SENSORY_MODULES_LOADED = False


# ── Configure logging to route INFO/DEBUG to stdout, ERROR/WARNING to stderr ──
# This prevents Electron from mislabeling normal log output as errors,
# since Python's default logging writes everything to stderr.
class StdoutFilter(logging.Filter):
    """Allow only records at INFO level or below (DEBUG, INFO)."""
    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno <= logging.INFO

class StderrFilter(logging.Filter):
    """Allow only records at WARNING level or above (WARNING, ERROR, CRITICAL)."""
    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno >= logging.WARNING

def configure_logging():
    """Set up root logging so INFO goes to stdout and WARNING+ goes to stderr."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # Remove any default handlers
    root.handlers.clear()

    fmt = logging.Formatter("%(levelname)s:     %(message)s")

    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(logging.DEBUG)
    stdout_handler.addFilter(StdoutFilter())
    stdout_handler.setFormatter(fmt)

    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.WARNING)
    stderr_handler.addFilter(StderrFilter())
    stderr_handler.setFormatter(fmt)

    root.addHandler(stdout_handler)
    root.addHandler(stderr_handler)

configure_logging()


# Global instances
audio_listener = None
screen_watcher = None
main_loop = None

import subprocess
import platform
import urllib.request

def ensure_ollama_running():
    """Ensure Ollama is running in the background as a fallback."""
    try:
        urllib.request.urlopen("http://127.0.0.1:11434/", timeout=1)
        return True
    except Exception:
        pass

    print("Starting Ollama background server (internal fallback)...")
    try:
        if platform.system() == "Windows":
            subprocess.Popen(
                ["ollama", "serve"],
                creationflags=subprocess.CREATE_NO_WINDOW | 0x00000008, # DETACHED_PROCESS
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        else:
            subprocess.Popen(
                ["ollama", "serve"],
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        return True
    except Exception as e:
        print(f"Failed to start Ollama: {e}")
        return False

def on_speech_detected(text: str):
    """Callback for when the microphone picks up speech."""
    if not main_loop: return
    try:
        asyncio.run_coroutine_threadsafe(process_sensory_audio(text), main_loop)
    except Exception as e:
        print(f"Error scheduling audio processing: {e}")

async def process_sensory_audio(text: str):
    import json
    for ws in manager.active_connections:
        try:
            await manager.send_personal_message(
                json.dumps({
                    "type": "sensory_input",
                    "content": text
                }),
                ws
            )
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger = logging.getLogger("orchai")
    logger.info("ORCHAI Backend starting up...")
    
    # Internal fallback to ensure Ollama is running
    ensure_ollama_running()
    
    global audio_listener, screen_watcher, main_loop
    main_loop = asyncio.get_running_loop()
    
    if SENSORY_MODULES_LOADED:
        # Initialize Sensors
        audio_listener = AudioListener()
        audio_listener.set_callback(on_speech_detected)
        screen_watcher = ScreenWatcher(capture_interval=5.0)
        
        # Start Sensors
        audio_listener.start()
        screen_watcher.start()
        
        # Share the whisper model with the speech API to avoid loading it twice
        if audio_listener.whisper_model:
            set_whisper_model(audio_listener.whisper_model)
        
        logger.info("Sensory Inputs Started.")

    yield
    
    logger.info("ORCHAI Backend shutting down...")
    if SENSORY_MODULES_LOADED:
        if audio_listener: audio_listener.stop()
        if screen_watcher: screen_watcher.stop()


app = FastAPI(title="ORCHAI Backend", lifespan=lifespan)

# Allow CORS for Electron frontend (which may run on a local dev server initially)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router, prefix="/api/chat")
app.include_router(speech_router, prefix="/api/speech")

@app.get("/")
def root():
    return {"status": "ok", "message": "ORCHAI Backend Running"}

@app.get("/api/vision/status")
def get_vision_status():
    if not SENSORY_MODULES_LOADED or not screen_watcher:
        return {"enabled": False, "installed": False}
    return {"enabled": screen_watcher.vision_enabled, "installed": screen_watcher.vision_installed}

@app.post("/api/vision/toggle")
def toggle_vision_status():
    if not SENSORY_MODULES_LOADED or not screen_watcher:
        return {"enabled": False, "installed": False}
    screen_watcher.vision_enabled = not screen_watcher.vision_enabled
    return {"enabled": screen_watcher.vision_enabled, "installed": screen_watcher.vision_installed}

@app.get("/api/audio/status")
def get_audio_status():
    if not SENSORY_MODULES_LOADED or not audio_listener:
        return {"enabled": False, "installed": False}
    # If AUDIO_AVAILABLE is False in audio_listener, we can assume not installed
    installed = getattr(audio_listener, 'whisper_model', None) is not None
    return {"enabled": audio_listener.audio_enabled, "installed": installed}

@app.post("/api/audio/toggle")
def toggle_audio_status():
    if not SENSORY_MODULES_LOADED or not audio_listener:
        return {"enabled": False, "installed": False}
    audio_listener.audio_enabled = not audio_listener.audio_enabled
    installed = getattr(audio_listener, 'whisper_model', None) is not None
    return {"enabled": audio_listener.audio_enabled, "installed": installed}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        reload_excludes=["*.db", "*.db-journal", "*.sqlite", "*.sqlite3"],
        log_config=None,  # Use our custom logging config instead of uvicorn's default
    )
