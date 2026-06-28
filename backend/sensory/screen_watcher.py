import os
import time
import mss
import pygetwindow as gw
from PIL import Image
import threading
import logging
import base64
import requests

logger = logging.getLogger("orchai.sensory.screen")

class ScreenWatcher:
    def __init__(self, capture_interval=5.0):
        self.capture_interval = capture_interval
        self.running = False
        self.thread = None
        self.last_capture_path = None
        
        # Ensure a directory exists for temp captures
        self.capture_dir = os.path.join(os.path.dirname(__file__), '..', 'temp_captures')
        os.makedirs(self.capture_dir, exist_ok=True)

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._watch_loop, daemon=True)
        self.thread.start()
        logger.info("ScreenWatcher started.")

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=2.0)
        logger.info("ScreenWatcher stopped.")

    def _watch_loop(self):
        with mss.mss() as sct:
            while self.running:
                try:
                    # Capture the primary monitor
                    monitor = sct.monitors[1]
                    sct_img = sct.grab(monitor)
                    
                    # Convert to PIL Image and save
                    img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                    
                    filepath = os.path.join(self.capture_dir, 'latest_screen.png')
                    # Scale down the image for faster Vision LLM processing
                    img_resized = img.copy()
                    img_resized.thumbnail((1024, 1024))
                    img_resized.save(filepath, format="PNG")
                    self.last_capture_path = filepath
                    
                    # Describe the screen using Ollama's llava model
                    description = self._describe_screen(filepath)
                    if description:
                        # Inject into the primary active session (defaulting to 'default' session_id)
                        self._inject_sensory_context(description)
                        
                except Exception as e:
                    logger.error(f"Error capturing screen: {e}")
                
                time.sleep(self.capture_interval)

    def _describe_screen(self, filepath):
        try:
            with open(filepath, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode("utf-8")
                
            payload = {
                "model": "llava",
                "messages": [
                    {
                        "role": "user",
                        "content": "Describe what the user is currently looking at on their screen in one concise sentence.",
                        "images": [encoded_string]
                    }
                ],
                "stream": False
            }
            
            response = requests.post("http://127.0.0.1:11434/api/chat", json=payload, timeout=20)
            if response.status_code == 200:
                data = response.json()
                return data.get("message", {}).get("content", "").strip()
            else:
                logger.warning(f"Vision model returned {response.status_code}. Is 'llava' pulled in Ollama?")
                return None
        except requests.exceptions.RequestException as e:
            logger.debug(f"Failed to reach Vision LLM: {e}")
            return None
        except Exception as e:
            logger.error(f"Error describing screen: {e}")
            return None

    def _inject_sensory_context(self, description):
        try:
            payload = {
                "session_id": "default",
                "sensory_context": description
            }
            requests.post("http://127.0.0.1:8000/api/chat/world-state/sensory", json=payload, timeout=2)
            logger.info(f"Screen context injected: {description}")
        except Exception as e:
            logger.debug(f"Failed to inject sensory context (is backend running?): {e}")

    def get_latest_capture(self):
        return self.last_capture_path

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    watcher = ScreenWatcher(capture_interval=2.0)
    watcher.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        watcher.stop()
