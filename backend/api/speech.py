"""
Speech-to-text API endpoint.
Accepts audio blobs recorded in the frontend and transcribes them
using faster-whisper (same model already loaded by AudioListener).
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
import logging
import io
import asyncio

logger = logging.getLogger("klydis.api.speech")

router = APIRouter()

# Lazy-loaded whisper model (reuses AudioListener's if available)
_whisper_model = None


def _get_whisper_model():
    """Get or create a whisper model instance."""
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model

    try:
        from faster_whisper import WhisperModel
        logger.info("Loading faster-whisper model for speech endpoint...")
        _whisper_model = WhisperModel("base.en", device="cpu", compute_type="int8")
        logger.info("Whisper model loaded for speech endpoint.")
        return _whisper_model
    except Exception as e:
        logger.error(f"Failed to load faster-whisper model for speech endpoint: {e}")
        return None


def set_whisper_model(model):
    """Allow main.py to inject the AudioListener's model to avoid loading twice."""
    global _whisper_model
    _whisper_model = model


@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    """
    Receives an audio file (webm/wav/ogg) and returns transcribed text.
    """
    model = _get_whisper_model()
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Speech-to-text model not available. Install faster-whisper."
        )

    try:
        audio_bytes = await audio.read()
        if len(audio_bytes) < 100:
            return {"text": "", "success": True}

        audio_io = io.BytesIO(audio_bytes)

        def run_transcription():
            segments, _ = model.transcribe(
                audio_io,
                beam_size=5,
                initial_prompt="Hello KLYDIS. Can you get me the Cape Town weather for today?"
            )
            return " ".join([segment.text for segment in segments]).strip()

        text = await asyncio.to_thread(run_transcription)

        logger.info(f"Transcribed: {text}")
        return {"text": text, "success": True}

    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
