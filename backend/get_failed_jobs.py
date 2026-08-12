import redis
from rq import Queue
from rq.registry import FailedJobRegistry

redis_conn = redis.from_url("redis://localhost:6379")
registry = FailedJobRegistry(queue=Queue(connection=redis_conn))

job_ids = registry.get_job_ids()
print(f"Total failed jobs: {len(job_ids)}")

if job_ids:
    from rq.job import Job
    for job_id in job_ids[-3:]:
        job = Job.fetch(job_id, connection=redis_conn)
        print(f"--- Job {job_id} ---")
        print(f"Function: {job.func_name}")
        print(f"Exception: {job.exc_info}")

