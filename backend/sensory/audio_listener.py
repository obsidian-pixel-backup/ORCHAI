import threading
import logging
import time
import os

logger = logging.getLogger("klydis.sensory.audio")

# Defer imports of heavy/unstable libraries to avoid crashing/hanging startup.
sd = None
np = None
WhisperModel = None
AUDIO_AVAILABLE = None

def _initialize_audio_dependencies():
    global sd, np, WhisperModel, AUDIO_AVAILABLE
    if AUDIO_AVAILABLE is not None:
        return AUDIO_AVAILABLE
        
    if os.getenv("KLYDIS_DISABLE_AUDIO", "0") == "1":
        logger.info("Audio listener explicitly disabled via KLYDIS_DISABLE_AUDIO env var.")
        AUDIO_AVAILABLE = False
        return False
        
    try:
        logger.info("Initializing audio listener dependencies...")
        import numpy as _np
        import sounddevice as _sd
        from faster_whisper import WhisperModel as _WhisperModel
        
        # Test sounddevice query_devices to verify PortAudio works and won't crash later
        _sd.query_devices()
        
        sd = _sd
        np = _np
        WhisperModel = _WhisperModel
        AUDIO_AVAILABLE = True
        logger.info("Audio dependencies loaded successfully.")
    except Exception as e:
        logger.warning(f"Audio dependencies or PortAudio library not available: {e}")
        sd = None
        np = None
        WhisperModel = None
        AUDIO_AVAILABLE = False
    return AUDIO_AVAILABLE

class AudioListener:
    def __init__(self, energy_threshold=0.005):
        is_available = _initialize_audio_dependencies()
        if is_available:
            self.energy_threshold = energy_threshold
            logger.info("Loading faster-whisper model...")
            self.whisper_model = WhisperModel("base.en", device="cpu", compute_type="int8")
            logger.info("Whisper model loaded.")
        else:
            self.whisper_model = None
            logger.warning("Audio dependencies missing. AudioListener will be disabled.")
        self.running = False
        self.audio_enabled = False
        self.thread = None
        self.on_speech_detected = None

    def start(self):
        if self.running:
            return
        self.running = True

        if AUDIO_AVAILABLE:
            self.thread = threading.Thread(target=self._listen_loop, daemon=True)
            logger.info("AudioListener started.")
        else:
            self.thread = threading.Thread(target=self._mock_listen_loop, daemon=True)
            logger.info("AudioListener started in MOCK mode (No audio dependencies).")
            
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=2.0)
        logger.info("AudioListener stopped.")

    def inject_mock_audio_text(self, text):
        """Allows injecting text as if it were heard, useful for testing or fallback."""
        if self.on_speech_detected:
            self.on_speech_detected(text)
        else:
            logger.warning(f"No callback set. Ignored injected text: {text}")

    def _mock_listen_loop(self):
        """A background loop that keeps the listener active without crashing, allowing mock text injection."""
        logger.info("Mock AudioListener active. Waiting for mock inputs or text injection...")
        while self.running:
            time.sleep(1.0)

    def set_callback(self, callback):
        """Set a callback function that takes text as input."""
        self.on_speech_detected = callback

    def _listen_loop(self):
        samplerate = 16000
        chunk_duration = 0.5 # seconds
        chunk_samples = int(samplerate * chunk_duration)
        
        while self.running:
            if not self.audio_enabled:
                time.sleep(2.0)
                continue
                
            try:
                with sd.InputStream(samplerate=samplerate, channels=1, dtype='float32') as stream:
                    logger.info("Calibrated for ambient noise. Listening...")
                    audio_buffer = []
                    silence_frames = 0
                    max_silence_frames = 3 # 1.5 seconds of silence
                    
                    while self.running and self.audio_enabled:
                        chunk, overflowed = stream.read(chunk_samples)
                        
                        rms = np.sqrt(np.mean(chunk**2))
                        if rms > self.energy_threshold:
                            audio_buffer.append(chunk)
                            silence_frames = 0
                        elif len(audio_buffer) > 0:
                            audio_buffer.append(chunk)
                            silence_frames += 1
                            
                            if silence_frames >= max_silence_frames:
                                # We have a complete phrase
                                audio_data = np.concatenate(audio_buffer).flatten()
                                audio_buffer = []
                                silence_frames = 0
                                
                                # Process audio in a separate thread
                                threading.Thread(target=self._process_audio, args=(audio_data,), daemon=True).start()
            except Exception as e:
                logger.error(f"Microphone error: {e}")
                time.sleep(5.0)

    def _process_audio(self, audio_data):
        try:
            # Transcribe locally with faster-whisper
            segments, info = self.whisper_model.transcribe(audio_data, beam_size=5)
            
            # Join all segments
            text = " ".join([segment.text for segment in segments]).strip()
            
            if not text:
                return

            logger.info(f"Heard: {text}")
            
            if self.on_speech_detected:
                self.on_speech_detected(text)
                
        except Exception as e:
            logger.error(f"Error in transcription: {e}")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    def my_callback(text):
        print(f"CALLBACK RECEIVED: {text}")
        
    listener = AudioListener()
    listener.set_callback(my_callback)
    listener.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        listener.stop()
