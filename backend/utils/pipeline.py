"""
Submission pipeline: one student submission = upload -> transcribe -> grade.

The submission's state lives in Redis (key "sub:<id>", kept for 48h), so:
* the student can close the tab / lose Wi-Fi / refresh and pick the result up later,
* a failed step can be retried from where it stopped (the audio file is kept until
  transcription succeeds, the transcript is kept until grading succeeds),
* nothing is ever re-recorded unless the audio itself is unusable.

Jobs WAIT when the AI is busy (see utils.ai.run_with_fallback) instead of failing.
"""
import json
import os
import tempfile
import time
import traceback
import uuid

from rq import Queue

from utils import ai

r = ai.redis_conn

SUB_TTL = 48 * 3600
TRANSCRIBE_DEADLINE = int(os.getenv("TRANSCRIBE_DEADLINE_SECONDS", str(40 * 60)))
GRADE_DEADLINE = int(os.getenv("GRADE_DEADLINE_SECONDS", str(45 * 60)))
AUDIO_DIR = os.getenv("AUDIO_DIR", os.path.join(tempfile.gettempdir(), "hrefspeak_audio"))
os.makedirs(AUDIO_DIR, exist_ok=True)

Q_TRANSCRIBE_PRIORITY = "transcribe_priority"   # conversation turns (student is waiting live)
Q_TRANSCRIBE = "transcribe"
Q_GRADE = "grade"
queues = {name: Queue(name, connection=r) for name in (Q_TRANSCRIBE_PRIORITY, Q_TRANSCRIBE, Q_GRADE)}

GRADED_MODES = {"read_aloud", "qa", "debate", "conversation"}
AUDIO_MODES = {"read_aloud", "qa", "debate", "transcribe"}  # "transcribe" = conversation turn

ACTIVE = {"queued", "transcribing", "grading", "waiting"}


# --- storage -------------------------------------------------------------------

def _key(sub_id):
    return f"sub:{sub_id}"


def load(sub_id):
    raw = r.get(_key(sub_id))
    return json.loads(raw) if raw else None


def save(sub):
    sub["updated_at"] = time.time()
    r.setex(_key(sub["id"]), SUB_TTL, json.dumps(sub))
    return sub


def update(sub_id, **fields):
    sub = load(sub_id)
    if not sub:
        return None
    sub.update(fields)
    return save(sub)


def new_submission(user_id, mode, params, *, audio_path=None, filename=None,
                   duration=None, transcript=None):
    sub = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "mode": mode,
        "params": params,
        "audio_path": audio_path,
        "filename": filename,
        "duration": duration,
        "transcript": transcript,
        "result": None,
        "status": "queued",
        "stage": "transcribe" if audio_path else "grade",
        "message": "Waiting in line...",
        "error": None,
        "retryable": False,
        "attempts": 0,
        "job_id": None,
        "queue": None,
        "created_at": time.time(),
    }
    return save(sub)


def remove_audio(sub):
    path = sub.get("audio_path")
    if path:
        try:
            os.unlink(path)
        except OSError:
            pass


# --- queueing ------------------------------------------------------------------

def enqueue_stage(sub):
    """Put the submission's current stage on the right queue."""
    sub["attempts"] = int(sub.get("attempts") or 0) + 1
    if sub["stage"] == "transcribe":
        qname = Q_TRANSCRIBE_PRIORITY if sub["mode"] == "transcribe" else Q_TRANSCRIBE
        func = "utils.pipeline.job_transcribe"
    else:
        qname = Q_GRADE
        func = "utils.pipeline.job_grade"
    job_id = f"{sub['id']}-{sub['stage']}-{sub['attempts']}"
    sub.update(status="queued", queue=qname, job_id=job_id, error=None, retryable=False,
               message="Waiting in line...")
    save(sub)
    queues[qname].enqueue(
        func, sub["id"], job_id=job_id,
        job_timeout=max(TRANSCRIBE_DEADLINE, GRADE_DEADLINE) + 600,
        result_ttl=600, failure_ttl=24 * 3600,
    )
    return sub


def _record_done(stage):
    now = time.time()
    key = f"stats:done:{stage}"
    pipe = r.pipeline()
    pipe.zadd(key, {f"{now}:{uuid.uuid4().hex[:6]}": now})
    pipe.zremrangebyscore(key, 0, now - 900)
    pipe.expire(key, 1800)
    pipe.execute()


def _fail(sub_id, message, *, retryable, rerecord=False):
    update(sub_id, status="failed", error=message, retryable=retryable,
           needs_rerecord=rerecord, message=message)


def _waiting(sub_id, what):
    def on_wait(seconds):
        update(sub_id, status="waiting",
               message=f"The AI {what} is busy right now. You're still in line - please keep waiting.")
    return on_wait


# --- jobs (run inside RQ workers) --------------------------------------------------

def job_transcribe(sub_id):
    sub = load(sub_id)
    if not sub or sub.get("status") == "completed":
        return
    path = sub.get("audio_path")
    if not path or not os.path.exists(path):
        _fail(sub_id, "Your recording was not found on the server. Please upload it again.",
              retryable=True)
        return
    update(sub_id, status="transcribing", message="Transcribing your recording...")
    try:
        text = ai.transcribe_file(
            path, sub.get("filename") or os.path.basename(path), sub.get("duration"),
            deadline=time.time() + TRANSCRIBE_DEADLINE,
            on_wait=_waiting(sub_id, "transcriber"),
        )
    except ai.BadAudioError as e:
        print(f"[pipeline] bad audio for {sub_id}: {e}")
        remove_audio(sub)
        _fail(sub_id, "This recording could not be processed (the audio file may be empty or damaged). "
                      "Please record again.", retryable=False, rerecord=True)
        return
    except (ai.AIBusyError, ai.AITransientError) as e:
        print(f"[pipeline] transcription gave up for {sub_id}: {e}")
        _fail(sub_id, "The server has been very busy. Your recording is saved - tap Retry to continue.",
              retryable=True)
        return
    except Exception:
        traceback.print_exc()
        _fail(sub_id, "Something went wrong while transcribing. Your recording is saved - tap Retry.",
              retryable=True)
        return

    _record_done("transcribe")
    remove_audio(sub)
    sub = load(sub_id) or sub
    sub["audio_path"] = None
    sub["transcript"] = text

    if not text.strip():
        sub.update(status="failed", retryable=False, needs_rerecord=True,
                   error="No speech was detected. Check your microphone and record again.",
                   message="No speech was detected.")
        save(sub)
        return

    if sub["mode"] == "transcribe":  # conversation turn: no grading needed
        sub.update(status="completed", result={"text": text}, message="Done")
        save(sub)
        return

    sub["stage"] = "grade"
    enqueue_stage(sub)


def job_grade(sub_id):
    sub = load(sub_id)
    if not sub or sub.get("status") == "completed":
        return
    update(sub_id, status="grading", message="Grading your answer...")
    p = sub.get("params") or {}
    transcript = sub.get("transcript") or ""
    kwargs = dict(deadline=time.time() + GRADE_DEADLINE, on_wait=_waiting(sub_id, "grader"))
    try:
        mode = sub["mode"]
        if mode == "read_aloud":
            result = ai.evaluate_read_aloud(p.get("source_text", ""), transcript, **kwargs)
        elif mode == "qa":
            result = ai.evaluate_qa(p.get("question", ""), transcript, **kwargs)
        elif mode == "debate":
            result = ai.evaluate_debate(p.get("motion", ""), p.get("role", ""), transcript, **kwargs)
        elif mode == "conversation":
            result = ai.evaluate_conversation(p.get("messages") or [], **kwargs)
        else:
            _fail(sub_id, f"Unknown mode {mode}", retryable=False)
            return
    except (ai.AIBusyError, ai.AITransientError) as e:
        print(f"[pipeline] grading gave up for {sub_id}: {e}")
        _fail(sub_id, "The AI grader has been very busy. Your answer is saved - tap Retry to get your score.",
              retryable=True)
        return
    except Exception:
        traceback.print_exc()
        _fail(sub_id, "Something went wrong while grading. Your answer is saved - tap Retry.",
              retryable=True)
        return

    _record_done("grade")
    update(sub_id, status="completed", result=result, message="Done")


# --- view for the API -------------------------------------------------------------

def _rate_per_minute(stage):
    now = time.time()
    count = r.zcount(f"stats:done:{stage}", now - 600, now)
    return count / 10.0


def _position(sub):
    if sub.get("status") != "queued" or not sub.get("queue") or not sub.get("job_id"):
        return None
    try:
        pos = queues[sub["queue"]].get_job_position(sub["job_id"])
        return pos + 1 if pos is not None else None
    except Exception:
        return None


def detect_lost_job(sub):
    """If the worker died (e.g. server restart) mark the submission retryable."""
    if sub.get("status") not in ACTIVE or not sub.get("job_id"):
        return sub
    if time.time() - float(sub.get("updated_at") or 0) < 90:
        return sub
    try:
        from rq.job import Job
        job = Job.fetch(sub["job_id"], connection=r)
        state = job.get_status(refresh=True)
        if state in ("failed", "stopped", "canceled"):
            raise LookupError(state)
        if state == "finished" and sub.get("status") != "completed":
            # job finished but did not update (should not happen) -> retry
            raise LookupError(state)
    except Exception:
        sub.update(status="failed", retryable=True,
                   error="The server restarted while processing. Your work is saved - retrying...",
                   message="Interrupted by a server restart.")
        save(sub)
    return sub


def public_view(sub):
    position = _position(sub)
    eta = None
    if sub.get("status") in ACTIVE:
        stage = sub.get("stage") or "grade"
        rate = _rate_per_minute(stage)
        ahead = position or 1
        if rate > 0:
            eta = int(ahead / rate * 60) + 15
        if stage == "transcribe" and sub.get("mode") in GRADED_MODES:
            grade_rate = _rate_per_minute("grade")
            if grade_rate > 0:
                eta = (eta or 30) + int(len(queues[Q_GRADE]) / grade_rate * 60) + 15
    return {
        "id": sub["id"],
        "mode": sub["mode"],
        "status": sub["status"],
        "stage": sub.get("stage"),
        "message": sub.get("message"),
        "position": position,
        "eta_seconds": eta,
        "transcript": sub.get("transcript"),
        "result": sub.get("result") if sub["status"] == "completed" else None,
        "error": sub.get("error"),
        "retryable": bool(sub.get("retryable")),
        "needs_rerecord": bool(sub.get("needs_rerecord")),
        "has_audio": bool(sub.get("audio_path") and os.path.exists(sub["audio_path"])),
    }
