import os
import time
import mss
import pygetwindow as gw
from PIL import Image
import threading
import logging

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
                    img.save(filepath, format="PNG")
                    self.last_capture_path = filepath
                    
                    # Note: We can send this to a Vision LLM or perform OCR here.
                    # For now, we just save the latest frame.
                    
                except Exception as e:
                    logger.error(f"Error capturing screen: {e}")
                
                time.sleep(self.capture_interval)

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
