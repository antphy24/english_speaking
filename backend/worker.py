import os
import redis
import logging
from rq import Queue, Connection
from rq.worker import SimpleWorker
import rq.timeouts
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)

# Monkey-patch to fix Windows SIGALRM error
class DummyDeathPenalty:
    def __init__(self, timeout, exception, **kwargs):
        pass
    def __enter__(self):
        pass
    def __exit__(self, type, value, traceback):
        pass

SimpleWorker.death_penalty_class = DummyDeathPenalty

load_dotenv()

listen = ['transcribe', 'grade']

redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')

# Handle Upstash TLS connections safely on Windows
redis_kwargs = {'socket_keepalive': True}
if redis_url.startswith('rediss://'):
    redis_kwargs['ssl_cert_reqs'] = None

conn = redis.from_url(redis_url, **redis_kwargs)

if __name__ == '__main__':
    logger = logging.getLogger('rq.worker')
    logger.info("Starting optimized RQ worker...")
    try:
        with Connection(conn):
            worker = SimpleWorker(map(Queue, listen))
            worker.work(logging_level=logging.INFO)
    except Exception as e:
        logger.error(f"Worker crashed: {e}")
        import traceback
        traceback.print_exc()
