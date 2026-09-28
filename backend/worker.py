"""
RQ worker.

Usage:
    python worker.py                                   # all queues, priority order
    python worker.py transcribe_priority transcribe    # transcription only
    python worker.py grade                             # grading only

Transcription and grading run in separate worker groups (see supervisord.conf) so
that grading jobs waiting for AI capacity never block transcriptions.
"""
import logging
import os
import sys

import redis
from dotenv import load_dotenv
from rq import Queue
from rq.worker import SimpleWorker

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

DEFAULT_QUEUES = ["transcribe_priority", "transcribe", "grade"]

if os.name == "nt":
    # Windows has no SIGALRM, so job timeouts cannot be enforced there (local dev only).
    class DummyDeathPenalty:
        def __init__(self, timeout, exception, **kwargs):
            pass

        def __enter__(self):
            pass

        def __exit__(self, type, value, traceback):
            pass

    SimpleWorker.death_penalty_class = DummyDeathPenalty

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_kwargs = {"socket_keepalive": True, "health_check_interval": 30}
if redis_url.startswith("rediss://"):
    redis_kwargs["ssl_cert_reqs"] = None

if __name__ == "__main__":
    queue_names = sys.argv[1:] or DEFAULT_QUEUES
    conn = redis.from_url(redis_url, **redis_kwargs)
    conn.ping()  # fail fast (supervisord restarts us) if Redis is not up yet
    logger = logging.getLogger("rq.worker")
    logger.info(f"Starting worker for queues: {queue_names}")
    worker = SimpleWorker([Queue(name, connection=conn) for name in queue_names], connection=conn)
    worker.work(logging_level=logging.INFO, with_scheduler=False)
