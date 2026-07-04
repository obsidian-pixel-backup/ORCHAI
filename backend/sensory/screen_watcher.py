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
        self.vision_enabled = False # Default to disabled to prevent spam if not needed immediately
        self.vision_installed = True
        self.last_error = None
        self.last_screen_hash = None
        
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

    def _calculate_average_hash(self, img) -> str:
        """Calculate a 64-bit average hash of a PIL Image for screen change detection."""
        # Resize to 8x8, convert to grayscale
        img_tiny = img.resize((8, 8)).convert('L')
        pixels = list(img_tiny.getdata())
        avg = sum(pixels) / 64.0
        return "".join("1" if p >= avg else "0" for p in pixels)

    def _hamming_distance(self, hash1: str, hash2: str) -> int:
        """Compute the Hamming distance (number of bit differences) between two hashes."""
        return sum(c1 != c2 for c1, c2 in zip(hash1, hash2))

    def _watch_loop(self):
        with mss.mss() as sct:
            while self.running:
                if not self.vision_enabled:
                    time.sleep(self.capture_interval)
                    continue
                try:
                    # Capture the primary monitor
                    monitor = sct.monitors[1]
                    sct_img = sct.grab(monitor)
                    
                    # Convert to PIL Image
                    img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                    
                    # Perform fast perceptual hashing to check if the screen actually changed
                    current_hash = self._calculate_average_hash(img)
                    should_describe = True
                    if self.last_screen_hash is not None:
                        dist = self._hamming_distance(self.last_screen_hash, current_hash)
                        # Threshold of 3 filters out minor mouse changes but catches active window/text updates
                        if dist <= 3:
                            should_describe = False
                    
                    self.last_screen_hash = current_hash
                    
                    if should_describe:
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
                    else:
                        logger.debug("Screen unchanged. Skipping vision descriptor run.")
                        
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
                self.vision_installed = True
                self.last_error = None
                data = response.json()
                return data.get("message", {}).get("content", "").strip()
            elif response.status_code == 404:
                logger.warning("Vision model 'llava' not found in Ollama. Will retry next interval.")
                self.vision_installed = False
                self.last_error = "Missing llava model"
                return None
            else:
                logger.warning(f"Vision model returned {response.status_code}. Is 'llava' pulled in Ollama?")
                self.last_error = f"HTTP {response.status_code}"
                return None
        except requests.exceptions.RequestException as e:
            logger.debug(f"Failed to reach Vision LLM: {e}")
            self.last_error = "Connection failed"
            return None
        except Exception as e:
            logger.error(f"Error describing screen: {e}")
            self.last_error = str(e)
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
