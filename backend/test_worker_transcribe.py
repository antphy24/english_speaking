import os
import time
from rq import Queue
from redis import Redis
from rq.job import Job

redis_conn = Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))
q = Queue(connection=redis_conn)

# create a dummy valid audio file
with open("test.webm", "wb") as f:
    f.write(b"0" * 3000)

job = q.enqueue(
    "utils.ai.transcribe_audio_from_file",
    "test.webm",
    "test.webm"
)
print("Job enqueued:", job.id)

# wait for job to finish
while True:
    job.refresh()
    if job.is_finished:
        print("Result:", job.result)
        break
    if job.is_failed:
        print("Failed:", job.exc_info)
        break
    time.sleep(1)
