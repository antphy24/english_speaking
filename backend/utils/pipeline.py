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

from utils import ai, storage

r = ai.redis_conn

SUB_TTL = 48 * 3600
# Jobs no longer give up after a fixed time: they keep their place in line through
# per-minute/per-hour AI limits and only stop when today's quota is used up
# (safety net: ai.PATIENT_MAX_WAIT, default 6 hours).
JOB_TIMEOUT = ai.PATIENT_MAX_WAIT + 1800
DAILY_LIMIT_MESSAGE = ("Today's free AI limit has been reached. Your {what} is saved - "
                       "tap Retry later (the limit resets within 24 hours).")
# Read Aloud: seconds to wait for AI-written feedback before using the standard
# paragraph, and the queue length at which we don't wait at all.
READ_ALOUD_AI_WAIT = int(os.getenv("READ_ALOUD_AI_WAIT_SECONDS", "60"))
READ_ALOUD_BUSY_QUEUE = int(os.getenv("READ_ALOUD_BUSY_QUEUE", "5"))
AUDIO_DIR = os.getenv("AUDIO_DIR", os.path.join(tempfile.gettempdir(), "hrefspeak_audio"))
os.makedirs(AUDIO_DIR, exist_ok=True)

Q_TRANSCRIBE_PRIORITY = "transcribe_priority"   # conversation turns (student is waiting live)
Q_TRANSCRIBE = "transcribe"
Q_GRADE = "grade"
queues = {name: Queue(name, connection=r) for name in (Q_TRANSCRIBE_PRIORITY, Q_TRANSCRIBE, Q_GRADE)}

GRADED_MODES = {"read_aloud", "qa", "debate", "conversation", "mattering"}
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
                   duration=None, transcript=None, auto_save=True, session_seconds=None,
                   audio_slot=None):
    sub = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "mode": mode,
        "params": params,
        "audio_path": audio_path,
        "audio_slot": audio_slot,         # where to keep this recording for later review (utils.storage)
        "audio_stored": False,
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
        "auto_save": bool(auto_save),     # save the score to Supabase as soon as it is graded
        "session_seconds": session_seconds,
        "saved": False,
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

def enqueue_stage(sub, at_front=False):
    """Put the submission's current stage on the right queue.

    at_front=True is used for retries so a student who already waited keeps their turn.
    """
    sub["attempts"] = int(sub.get("attempts") or 0) + 1
    if sub["stage"] == "transcribe":
        qname = Q_TRANSCRIBE_PRIORITY if sub["mode"] == "transcribe" else Q_TRANSCRIBE
        func = "utils.pipeline.job_transcribe"
    else:
        qname = Q_GRADE
        func = "utils.pipeline.job_grade"
    job_id = f"{sub['id']}-{sub['stage']}-{sub['attempts']}"
    sub.update(status="queued", queue=qname, job_id=job_id, error=None, retryable=False,
               daily_limit=False, wait_seconds=None, message="Waiting in line...")
    save(sub)
    queues[qname].enqueue(
        func, sub["id"], job_id=job_id,
        job_timeout=JOB_TIMEOUT,
        result_ttl=600, failure_ttl=24 * 3600,
        at_front=at_front,
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


def _fail(sub_id, message, *, retryable, rerecord=False, daily_limit=False):
    update(sub_id, status="failed", error=message, retryable=retryable,
           needs_rerecord=rerecord, daily_limit=daily_limit, message=message)


def _waiting(sub_id, what):
    def on_wait(seconds):
        if seconds >= 120:
            minutes = max(2, round(seconds / 60))
            message = (f"The free AI {what} has reached its limit for this hour. You keep your place in "
                       f"line - about {minutes} minutes until it continues.")
        else:
            message = f"The AI {what} is busy right now. You're still in line - please keep waiting."
        update(sub_id, status="waiting", message=message, wait_seconds=int(seconds))
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
    info = {}

    def on_backup():
        update(sub_id, status="transcribing",
               message="Transcribing on the backup server - this can take a little longer.")

    try:
        text = ai.transcribe_file(
            path, sub.get("filename") or os.path.basename(path), sub.get("duration"),
            deadline=None,  # patient: wait through minute/hour limits
            on_wait=_waiting(sub_id, "transcriber"),
            info=info, on_backup=on_backup,
        )
    except ai.BadAudioError as e:
        print(f"[pipeline] bad audio for {sub_id}: {e}")
        remove_audio(sub)
        _fail(sub_id, "This recording could not be processed (the audio file may be empty or damaged). "
                      "Please record again.", retryable=False, rerecord=True)
        return
    except ai.AIDailyLimitError as e:
        print(f"[pipeline] daily transcription quota used up for {sub_id}: {e}")
        _fail(sub_id, DAILY_LIMIT_MESSAGE.format(what="recording"), retryable=True, daily_limit=True)
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
    stored = False
    if sub.get("audio_slot"):
        # Keep the recording so the student and teacher can listen to it again.
        # Best effort: a storage problem must never cost the student their grade.
        try:
            stored = storage.store_pending(sub["user_id"], sub["audio_slot"], sub_id, path, sub.get("filename"))
        except Exception as e:  # noqa: BLE001
            print(f"[pipeline] could not keep the recording for {sub_id}: {str(e)[:200]}")
    remove_audio(sub)
    sub = load(sub_id) or sub
    sub["audio_path"] = None
    sub["audio_stored"] = stored
    sub["transcript"] = text
    sub["transcriber"] = info.get("transcriber")

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
    kwargs = dict(deadline=None, on_wait=_waiting(sub_id, "grader"))  # patient
    try:
        mode = sub["mode"]
        if mode == "read_aloud":
            # Hybrid feedback: wait a little for the AI when the line is short; when many
            # students are waiting, use the standard paragraph immediately so nobody
            # waits long for prose (the scores themselves are exact either way).
            busy = len(queues[Q_GRADE]) >= READ_ALOUD_BUSY_QUEUE
            wait = 0 if busy else READ_ALOUD_AI_WAIT
            result = ai.evaluate_read_aloud(p.get("source_text", ""), transcript,
                                            deadline=time.time() + wait, on_wait=kwargs["on_wait"])
        elif mode == "qa":
            result = ai.evaluate_qa(p.get("question", ""), transcript, **kwargs)
        elif mode == "debate":
            result = ai.evaluate_debate(p.get("motion", ""), p.get("role", ""), transcript, **kwargs)
        elif mode == "conversation":
            result = ai.evaluate_conversation(p.get("messages") or [], **kwargs)
        elif mode == "mattering":
            # transcript = the argument speech; the rebuttal round travels in params
            result = ai.evaluate_mattering(p.get("motion", ""), p.get("role", ""), p.get("notes", ""),
                                           transcript, p.get("opposition", ""), p.get("rebuttal", ""), **kwargs)
        else:
            _fail(sub_id, f"Unknown mode {mode}", retryable=False)
            return
    except ai.AIDailyLimitError as e:
        print(f"[pipeline] daily grading quota used up for {sub_id}: {e}")
        _fail(sub_id, DAILY_LIMIT_MESSAGE.format(what="answer"), retryable=True, daily_limit=True)
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
    sub = update(sub_id, result=result) or sub
    if sub.get("auto_save"):
        # Saved by the server, so it does not depend on the student's browser
        # session still being valid (phones sleep, tokens expire, tabs close).
        save_assessment(sub_id)
    update(sub_id, status="completed", message="Done")


# --- saving the score to Supabase -------------------------------------------------

def compute_score(mode, result):
    try:
        if mode == "read_aloud":
            return round(float(result["accuracy_score"]))
        if mode == "mattering":
            return round(float(result["speaker_score"]))  # debate speaker scale, 69-81 (75 = average)
        if mode == "debate":
            return round(result["matter_score"] * 4 + result["manner_score"] * 4 + result["method_score"] * 2)
        keys = (["fluency", "lexical_resource", "grammatical_range", "pronunciation"] if mode == "qa" else
                ["fluency_and_coherence", "lexical_resource", "grammatical_range", "pronunciation",
                 "interactive_communication"])
        return round(sum(float(result[k]) for k in keys) / len(keys))
    except (KeyError, TypeError, ValueError):
        return 0


def transcript_text(sub):
    """What the student said. For conversations: the whole dialogue."""
    if sub["mode"] == "conversation":
        lines = []
        for m in (sub.get("params") or {}).get("messages") or []:
            who = "Student" if m.get("role") == "user" else "Tutor"
            lines.append(f"{who}: {m.get('content', '')}")
        return "\n".join(lines) or None
    if sub["mode"] == "mattering":
        p = sub.get("params") or {}
        parts = [f"Argument: {sub.get('transcript') or ''}"]
        if p.get("opposition"):
            parts.append(f"Opposing argument (AI): {p['opposition']}")
            parts.append(f"Rebuttal: {p.get('rebuttal') or '(skipped)'}")
        return "\n\n".join(parts)
    return sub.get("transcript") or None


def build_feedback(sub):
    """Same JSON shape the browser used to store, so leaderboards keep working."""
    result = dict(sub.get("result") or {})
    p = sub.get("params") or {}
    mode = sub["mode"]
    feedback = {**result, "material_title": p.get("material_title") or p.get("motion") or None}
    if sub.get("transcriber"):
        feedback["transcriber"] = sub["transcriber"]
    if mode == "debate":
        feedback.update(transcript=sub.get("transcript"), finalScore=compute_score(mode, result),
                        motion=p.get("motion"), role=p.get("role"))
    if mode == "mattering":
        feedback.update(transcript=sub.get("transcript"), motion=p.get("motion"), role=p.get("role"),
                        notes=p.get("notes"), opposition=p.get("opposition"),
                        rebuttal_transcript=p.get("rebuttal"))
    if not feedback["material_title"]:
        feedback.pop("material_title")
    return feedback


def keep_audio(sub):
    """
    Make this submission's recording(s) the student's saved "latest" for its mode
    and return {slot: storage path}. Done once per submission; never raises.
    """
    if sub.get("audio") is not None:
        return sub["audio"]
    kept = {}
    refs = (sub.get("params") or {}).get("audio_subs") or {}
    for slot in storage.MODE_SLOTS.get(sub["mode"], []):
        source = None
        if slot == sub["mode"] and sub.get("audio_stored"):
            source = sub["id"]
        elif refs.get(slot):
            # mattering: each speech was transcribed as its own submission
            turn = load(str(refs[slot]))
            if turn and turn.get("user_id") == sub["user_id"] and turn.get("audio_stored") \
                    and turn.get("audio_slot") == slot:
                source = turn["id"]
        try:
            path = storage.promote(sub["user_id"], slot, source)
            if path:
                kept[slot] = path
        except Exception as e:  # noqa: BLE001
            print(f"[pipeline] could not keep the {slot} recording for {sub['id']}: {str(e)[:200]}")
    update(sub["id"], audio=kept)
    return kept


def _supabase_insert(row):
    import httpx
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured")
    force_ipv4 = os.getenv("FORCE_IPV4", "true").lower() == "true"
    transport = httpx.HTTPTransport(local_address="0.0.0.0", retries=2) if force_ipv4 else None
    with httpx.Client(timeout=20, transport=transport) as client:
        resp = client.post(
            f"{url}/rest/v1/assessments",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Content-Type": "application/json", "Prefer": "return=minimal"},
            json=row,
        )
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(f"Supabase insert failed ({resp.status_code}): {resp.text[:300]}")


def save_assessment(sub_id):
    """Insert the graded result into public.assessments exactly once. Returns True if saved."""
    sub = load(sub_id)
    if not sub or not sub.get("result"):
        return False
    if sub.get("saved"):
        return True
    lock = f"saving:{sub_id}"
    if not r.set(lock, "1", nx=True, ex=60):
        # someone else is saving right now; wait briefly for them
        for _ in range(20):
            time.sleep(1)
            sub = load(sub_id) or sub
            if sub.get("saved"):
                return True
        return False
    try:
        row = {
            "student_id": sub["user_id"],
            "mode": sub["mode"],
            "score": compute_score(sub["mode"], sub["result"]),
            "feedback": build_feedback(sub),
        }
        audio = keep_audio(sub)
        if audio:
            row["feedback"]["audio"] = audio  # storage paths of the recording(s) for this attempt
        if sub.get("session_seconds"):
            row["duration_seconds"] = int(sub["session_seconds"])
        transcript = transcript_text(sub)
        if transcript:
            row["transcript"] = transcript  # what the student said, for teachers to review
        last = None
        for attempt in range(4):
            try:
                _supabase_insert(row)
                update(sub_id, saved=True)
                return True
            except Exception as e:  # noqa: BLE001
                last = e
                if "transcript" in str(e) and "transcript" in row:
                    # The optional transcript column migration has not been run yet.
                    row.pop("transcript")
                    continue
                time.sleep(2 * (attempt + 1))
        print(f"[pipeline] could not save assessment for {sub_id}: {last}")
        return False
    finally:
        r.delete(lock)


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
        if sub.get("status") == "waiting" and sub.get("wait_seconds"):
            eta = max(eta or 0, int(sub["wait_seconds"]) + 15)
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
        "daily_limit": bool(sub.get("daily_limit")),
        "has_audio": bool(sub.get("audio_path") and os.path.exists(sub["audio_path"])),
        "saved": bool(sub.get("saved")),
    }
