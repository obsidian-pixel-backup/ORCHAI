import sounddevice as sd
import numpy as np

def test():
    try:
        print(sd.query_devices())
        print("Testing recording 1 second...")
        recording = sd.rec(int(1 * 16000), samplerate=16000, channels=1)
        sd.wait()
        print("Record done. RMS:", np.sqrt(np.mean(recording**2)))
    except Exception as e:
        print(f"Error: {e}")

test()
