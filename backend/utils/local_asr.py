"""
Backup transcription that runs on this server's own CPU (open-source Whisper via
faster-whisper). No quota and no cost. Used when Groq's free Whisper allowance is
used up, keeps failing, or would make students wait too long.

Settings (env vars):
  LOCAL_ASR_ENABLED            "true"/"false"             (default true)
  LOCAL_WHISPER_MODEL          tiny.en / base.en / small.en (default base.en)
  LOCAL_WHISPER_THREADS        CPU threads per transcription (default 2)
  LOCAL_WHISPER_DIR            where the model files live (default /models)
"""
import os
import threading
import time
import uuid

ENABLED = os.getenv("LOCAL_ASR_ENABLED", "true").lower() == "true"
MODEL_NAME = os.getenv("LOCAL_WHISPER_MODEL", "base.en")
THREADS = int(os.getenv("LOCAL_WHISPER_THREADS", "2"))
MODEL_DIR = os.getenv("LOCAL_WHISPER_DIR", "/models")
LOCK_KEY = "local_asr:lock"
LOCK_TTL = 900  # seconds; long debate speeches can take a minute or two on CPU

_model = None
_model_lock = threading.Lock()
_import_error = None


def available():
    """True if the backup transcriber can be used on this machine."""
    global _import_error
    if not ENABLED:
        return False
    if _import_error is not None:
        return False
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception as e:  # not installed (e.g. local Windows dev)
        _import_error = e
        print(f"[local_asr] backup transcriber unavailable: {e}")
        return False


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel
            start = time.time()
            _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8",
                                  cpu_threads=THREADS, download_root=MODEL_DIR)
            print(f"[local_asr] loaded {MODEL_NAME} in {time.time() - start:.1f}s")
        return _model


def transcribe(file_path, redis_conn, on_wait=None, max_wait=3 * 3600):
    """
    Transcribe on this server. Only one transcription runs at a time across all
    worker processes (the free server has 2 CPUs), coordinated through Redis.
    """
    token = uuid.uuid4().hex
    waited = 0.0
    while not redis_conn.set(LOCK_KEY, token, nx=True, ex=LOCK_TTL):
        if waited >= max_wait:
            raise TimeoutError("Backup transcriber busy for too long")
        if on_wait and int(waited) % 10 == 0:
            try:
                on_wait()
            except Exception:
                pass
        time.sleep(0.5)
        waited += 0.5
    try:
        model = _get_model()
        start = time.time()
        segments, info = model.transcribe(
            file_path,
            language="en",
            beam_size=1,                       # fastest; accuracy is fine for scoring
            vad_filter=True,                   # skip silence (avoids made-up words)
            condition_on_previous_text=False,  # avoids repeated phrases on long audio
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        print(f"[local_asr] {info.duration:.0f}s of audio transcribed in {time.time() - start:.1f}s")
        return text
    finally:
        try:
            if redis_conn.get(LOCK_KEY) in (token, token.encode()):
                redis_conn.delete(LOCK_KEY)
        except Exception:
            pass
