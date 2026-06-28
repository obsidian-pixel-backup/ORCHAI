import threading
import logging
import time

try:
    import speech_recognition as sr
    from faster_whisper import WhisperModel
    import io
    AUDIO_AVAILABLE = True
except ImportError:
    sr = None
    WhisperModel = None
    AUDIO_AVAILABLE = False

logger = logging.getLogger("orchai.sensory.audio")

class AudioListener:
    def __init__(self, energy_threshold=300):
        if AUDIO_AVAILABLE:
            self.recognizer = sr.Recognizer()
            self.recognizer.energy_threshold = energy_threshold
            logger.info("Loading faster-whisper model...")
            # Use small or base model, CPU by default for broader compatibility
            self.whisper_model = WhisperModel("base.en", device="cpu", compute_type="int8")
            logger.info("Whisper model loaded.")
        else:
            self.recognizer = None
            self.whisper_model = None
            logger.warning("Audio dependencies missing. AudioListener will be disabled.")
        self.running = False
        self.thread = None
        self.on_speech_detected = None  # Callback function for when speech is heard

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
            # In a true interactive mock setup, we could read from a queue here.
            # For now, it simply sleeps to keep the thread alive and prevent crashes.


    def set_callback(self, callback):
        """Set a callback function that takes text as input."""
        self.on_speech_detected = callback

    def _listen_loop(self):
        # We try to use the default microphone
        try:
            with sr.Microphone() as source:
                self.recognizer.adjust_for_ambient_noise(source, duration=1)
                logger.info("Calibrated for ambient noise. Listening...")
                
                while self.running:
                    try:
                        # Listen for speech with a timeout so we can exit the loop cleanly
                        audio = self.recognizer.listen(source, timeout=2.0, phrase_time_limit=10.0)
                        
                        # Process audio in a separate thread to not block listening
                        threading.Thread(target=self._process_audio, args=(audio,), daemon=True).start()
                        
                    except sr.WaitTimeoutError:
                        pass # No speech detected in the timeout period
                    except Exception as e:
                        logger.error(f"Error listening to audio: {e}")
                        time.sleep(1)
        except Exception as e:
            logger.error(f"Microphone error: {e}")
            self.running = False

    def _process_audio(self, audio):
        try:
            # Convert SpeechRecognition AudioData to WAV file-like object
            wav_bytes = audio.get_wav_data()
            wav_io = io.BytesIO(wav_bytes)
            
            # Transcribe locally with faster-whisper
            segments, info = self.whisper_model.transcribe(wav_io, beam_size=5)
            
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
