"""
Check the backup (on-server) transcriber.

    cd backend
    pip install faster-whisper          # once, if running on your own computer
    python check_local_asr.py [path/to/recording.webm]

The first run downloads the model (~140 MB for base.en). Prints the transcript
and how long it took, so you can see the speed on this machine.
"""
import os
import sys
import time

os.environ.setdefault("LOCAL_WHISPER_DIR", os.path.join(os.path.dirname(__file__), "models"))

from utils import local_asr  # noqa: E402
from utils.ai import redis_conn  # noqa: E402

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "beep.ogg")
    if not local_asr.available():
        print("Backup transcriber NOT available (is faster-whisper installed? LOCAL_ASR_ENABLED=true?)")
        sys.exit(1)
    start = time.time()
    text = local_asr.transcribe(path, redis_conn)
    print(f"Model: {local_asr.MODEL_NAME}")
    print(f"Took {time.time() - start:.1f}s (includes loading the model the first time)")
    print(f"Transcript: {text!r}")
