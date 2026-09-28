import os
import secrets
import string
import httpx
import asyncio
import tempfile
import time
import glob
import re
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from contextlib import asynccontextmanager

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import base64
import json
import redis
from rq import Queue
from rq.job import Job

# Import utilities
from utils.ai import get_chat_reply, AIBusyError, AITransientError
from utils import pipeline

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

AUDIO_MAX_AGE = 12 * 3600  # keep uploaded audio until processed (max 12h)

async def temp_file_reaper():
    """Periodically clean up orphaned audio files.

    Files are normally deleted as soon as they are transcribed. This only removes
    leftovers. (It used to delete files after 10 minutes, which destroyed the
    recordings of students still waiting in a long queue.)
    """
    while True:
        await asyncio.sleep(600)
        now = time.time()
        for f in glob.glob(os.path.join(pipeline.AUDIO_DIR, "*")):
            try:
                if now - os.path.getmtime(f) > AUDIO_MAX_AGE:
                    os.unlink(f)
            except OSError:
                pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("FastAPI Application Starting up...")
    # local_address="0.0.0.0" forces IPv4. Some networks advertise IPv6 but can't
    # actually route it; browsers fall back to IPv4 silently, Python does not,
    # which shows up as ConnectTimeout when talking to Supabase.
    force_ipv4 = os.getenv("FORCE_IPV4", "true").lower() == "true"
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
        transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0", retries=2) if force_ipv4 else None,
    )
    reaper_task = asyncio.create_task(temp_file_reaper())
    yield
    reaper_task.cancel()
    await app.state.http_client.aclose()

app = FastAPI(title="English speaking assessment platform API", lifespan=lifespan)

def get_user_id(request: Request) -> str:
    auth = request.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        token = auth.split(" ")[1]
        try:
            payload_b64 = token.split(".")[1]
            payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64).decode("utf-8"))
            if "sub" in payload:
                return f"user:{payload['sub']}"
        except Exception:
            pass
    return get_remote_address(request)

limiter = Limiter(key_func=get_user_id)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_kwargs = {}
if redis_url.startswith('rediss://'):
    redis_kwargs['ssl_cert_reqs'] = None
redis_conn = redis.from_url(redis_url, **redis_kwargs)
transcribe_queue = Queue('transcribe', connection=redis_conn)
grade_queue = Queue('grade', connection=redis_conn)

# Enable CORS for frontend requests
allowed_origins_str = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
allowed_origins = [origin.strip() for origin in allowed_origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Middleware to handle Chrome Private Network Access (PNA) preflight requests.
# HF Spaces returns fd00:: IPv6 addresses (private range), which triggers Chrome's
# CORS-RFC1918 check. This raw ASGI middleware injects the required response header
# at the protocol level, which is more reliable than BaseHTTPMiddleware.
class PrivateNetworkAccessMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_pna(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"access-control-allow-private-network", b"true"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_pna)

app.add_middleware(PrivateNetworkAccessMiddleware)

# --- API Schemas ---

class GradeRequest(BaseModel):
    mode: str  # "read_aloud" | "qa" | "conversation" | "debate"
    transcript: Optional[str] = None
    source_text: Optional[str] = None      # Required for read_aloud
    question: Optional[str] = None         # Required for qa
    messages: Optional[List[dict]] = None  # Required for conversation
    motion: Optional[str] = None           # Required for debate
    role: Optional[str] = None             # Required for debate


class ChatReplyRequest(BaseModel):
    messages: List[dict]

class StudentEnrollInfo(BaseModel):
    fullName: str
    schoolId: str

class BulkEnrollRequest(BaseModel):
    classId: str
    classCode: str
    students: List[StudentEnrollInfo]

class UnenrollRequest(BaseModel):
    studentId: str
    classId: str

class DeleteClassRequest(BaseModel):
    classId: str

class ResetPasswordRequest(BaseModel):
    studentId: str
    classId: str
    schoolId: str

async def _verify_token(authorization: Optional[str], request: Request):
    """Shared token verification logic — validates JWT against Supabase Auth API."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing.")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format. Must be Bearer token.")
    
    token = authorization.split(" ")[1]
    
    cache_key = f"auth_token:{token}"
    cached_user = redis_conn.get(cache_key)
    if cached_user:
        return json.loads(cached_user)
    
    # Bypass for Locust load testing
    if token.endswith(".mock_signature") and os.getenv("ALLOW_MOCK_TOKENS", "false").lower() == "true":
        try:
            payload_b64 = token.split(".")[1]
            payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64).decode("utf-8"))
            return {"id": payload.get("sub", "mock-user"), "user_metadata": {}}
        except Exception:
            pass

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase backend configuration is missing.")
        
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {token}"
    }
    
    try:
        client = request.app.state.http_client
        response = await client.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers)
        
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Session expired or invalid token.")
            
        user_info = response.json()
        redis_conn.setex(cache_key, 600, json.dumps(user_info)) # Cache for 10 mins
        return user_info
    except HTTPException as he:
        raise he
    except httpx.TransportError as e:
        # Network problem reaching Supabase: temporary, the browser retries automatically.
        print(f"Auth verification network error: {type(e).__name__}: {e!r}")
        raise HTTPException(status_code=503, detail="Could not reach the login server. Retrying - your recording is saved.")
    except Exception as e:
        print(f"Auth verification error: {type(e).__name__}: {e!r}")
        raise HTTPException(status_code=500, detail="Login check failed. Please try again.")

async def verify_authenticated(request: Request, authorization: Optional[str] = Header(None)):
    """Lightweight auth check: verifies JWT is valid, returns user info. Used for student endpoints."""
    return await _verify_token(authorization, request)

async def verify_teacher(request: Request, authorization: Optional[str] = Header(None)):
    """Auth check that also verifies the user has the 'teacher' role."""
    user_info = await _verify_token(authorization, request)
    user_metadata = user_info.get("user_metadata", {})
    
    # Verify role is teacher
    if user_metadata.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Access denied. Account is not a teacher.")
        
    return user_info

# --- Endpoints ---

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Welcome to the English speaking assessment platform API"
    }

@app.get("/health")
def health_check():
    if not os.getenv("GROQ_API_KEY") or not os.getenv("GEMINI_API_KEY") or not SUPABASE_URL:
        raise HTTPException(status_code=503, detail="Missing essential API keys.")
    return {"status": "healthy"}

@app.get("/ai-status")
def ai_status():
    """
    Check the availability of the AI backend based on rate limits and queue length.
    """
    from utils import ai as ai_mod
    waiting = sum(len(q) for q in pipeline.queues.values())
    if ai_mod.limiter.all_cooling(ai_mod.GRADE_MODELS) or ai_mod.limiter.all_cooling(ai_mod.TRANSCRIBE_MODELS):
        return {"status": "busy", "message": f"AI is at its limit - submissions wait in line ({waiting} waiting)."}
    if waiting >= 5:
        return {"status": "busy", "message": f"AI is busy ({waiting} submissions in line). Yours will still be graded."}
    return {"status": "ready", "message": "AI is ready."}

async def _enroll_student(client, student, classId, classCode, headers):
    sanitized_school_id = "".join(c for c in student.schoolId if c.isalnum())
    email = f"student_{sanitized_school_id}@{classCode}.HreFSpeak.com".lower()
    
    # Password defaults to School ID, padded to 6 chars if needed
    password = student.schoolId
    if len(password) < 6:
        password = password.ljust(6, '0')
        
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {
            "role": "student",
            "class_id": classId,
            "full_name": student.fullName,
            "school_id": student.schoolId,
            "requires_password_change": True
        }
    }
    
    try:
        response = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=headers,
            json=payload
        )
        
        if response.status_code in [200, 201]:
            return {"success": True, "password": password, "student": student}
        else:
            err_data = response.json()
            err_msg = err_data.get("msg") or err_data.get("error_description") or response.text
            return {"success": False, "error": f"{student.fullName} ({student.schoolId}): {err_msg}"}
    except Exception as e:
        return {"success": False, "error": f"{student.fullName} ({student.schoolId}): {str(e)}"}

@app.post("/teacher/bulk-enroll")
@limiter.limit("5/minute")
async def bulk_enroll(request: Request, bulk_request: BulkEnrollRequest, teacher: dict = Depends(verify_teacher)):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase environment configuration missing.")
        
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json"
    }
    
    success_count = 0
    failures = []
    successes = []
    
    semaphore = asyncio.Semaphore(10)
    
    async def limited_enroll(client, student):
        async with semaphore:
            return await _enroll_student(client, student, bulk_request.classId, bulk_request.classCode, headers)
            
    client = request.app.state.http_client
    results = await asyncio.gather(*[limited_enroll(client, s) for s in bulk_request.students])
        
    for res in results:
        if res["success"]:
            success_count += 1
            successes.append({
                "name": res["student"].fullName,
                "schoolId": res["student"].schoolId,
                "password": res["password"]
            })
        else:
            failures.append(res["error"])
            
    return {
        "successCount": success_count,
        "failures": failures,
        "successes": successes
    }

@app.post("/teacher/unenroll-student")
@limiter.limit("10/minute")
async def unenroll_student(request: Request, body: UnenrollRequest, teacher: dict = Depends(verify_teacher)):
    """
    Removes a student from a class by deleting their Supabase auth account.
    The students table row is expected to cascade-delete via DB trigger/FK.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase environment configuration missing.")

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json"
    }

    # Verify the teacher owns this class
    teacher_id = teacher.get("id")
    client = request.app.state.http_client
    # Check the student belongs to a class owned by this teacher
    verify_resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/students?id=eq.{body.studentId}&class_id=eq.{body.classId}&select=id,class:classes!inner(teacher_id)",
        headers={**headers, "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}
    )

    if verify_resp.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to verify student ownership.")

    rows = verify_resp.json()
    if not rows or len(rows) == 0:
        raise HTTPException(status_code=404, detail="Student not found in this class.")

    student_class = rows[0].get("class", {})
    if student_class.get("teacher_id") != teacher_id:
        raise HTTPException(status_code=403, detail="You do not own this class.")

    # Delete the auth user (students table row cascades)
    del_resp = await client.delete(
        f"{SUPABASE_URL}/auth/v1/admin/users/{body.studentId}",
        headers=headers
    )

    if del_resp.status_code not in [200, 204]:
        err_data = del_resp.json() if del_resp.headers.get("content-type", "").startswith("application/json") else {}
        err_msg = err_data.get("msg") or err_data.get("error_description") or del_resp.text
        raise HTTPException(status_code=500, detail=f"Failed to delete student account: {err_msg}")

    return {"success": True, "message": "Student unenrolled successfully."}

@app.post("/teacher/delete-class")
@limiter.limit("5/minute")
async def delete_class(request: Request, body: DeleteClassRequest, teacher: dict = Depends(verify_teacher)):
    """
    Deletes a class and all associated student auth accounts.
    The classes table cascade handles students, assessments, and activity_logs rows.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase environment configuration missing.")

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json"
    }

    teacher_id = teacher.get("id")

    client = request.app.state.http_client
    # 1. Verify the teacher owns this class
    verify_resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/classes?id=eq.{body.classId}&teacher_id=eq.{teacher_id}&select=id",
        headers=headers
    )

    if verify_resp.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to verify class ownership.")

    rows = verify_resp.json()
    if not rows or len(rows) == 0:
        raise HTTPException(status_code=403, detail="You do not own this class.")

    # 2. Fetch all student IDs in the class
    students_resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/students?class_id=eq.{body.classId}&select=id",
        headers=headers
    )

    if students_resp.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to fetch students for class.")

    student_rows = students_resp.json()
    student_ids = [s["id"] for s in student_rows]

    # 3. Delete the class record (cascade handles students, assessments, activity_logs)
    del_resp = await client.delete(
        f"{SUPABASE_URL}/rest/v1/classes?id=eq.{body.classId}",
        headers=headers
    )

    if del_resp.status_code not in [200, 204]:
        err_data = del_resp.json() if del_resp.headers.get("content-type", "").startswith("application/json") else {}
        err_msg = err_data.get("msg") or err_data.get("error_description") or del_resp.text
        raise HTTPException(status_code=500, detail=f"Failed to delete class: {err_msg}")

    # 4. Delete each student's auth account concurrently (best effort cleanup)
    deleted_count = 0
    semaphore = asyncio.Semaphore(10)

    async def delete_auth_user(student_id: str):
        async with semaphore:
            resp = await client.delete(
                f"{SUPABASE_URL}/auth/v1/admin/users/{student_id}",
                headers=headers
            )
            return resp.status_code in [200, 204]

    results = await asyncio.gather(*[delete_auth_user(sid) for sid in student_ids])
    deleted_count = sum(1 for r in results if r)

    return {"success": True, "deletedStudents": deleted_count}

@app.post("/teacher/reset-student-password")
@limiter.limit("10/minute")
async def reset_student_password(request: Request, body: ResetPasswordRequest, teacher: dict = Depends(verify_teacher)):
    """
    Resets a student's password to their school ID (padded to 6 chars)
    and flags the account as requiring a password change.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase environment configuration missing.")

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json"
    }

    teacher_id = teacher.get("id")

    client = request.app.state.http_client
    # 1. Verify the teacher owns this class (same pattern as unenroll-student)
    verify_resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/students?id=eq.{body.studentId}&class_id=eq.{body.classId}&select=id,class:classes!inner(teacher_id)",
        headers=headers
    )

    if verify_resp.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to verify student ownership.")

    rows = verify_resp.json()
    if not rows or len(rows) == 0:
        raise HTTPException(status_code=404, detail="Student not found in this class.")

    student_class = rows[0].get("class", {})
    if student_class.get("teacher_id") != teacher_id:
        raise HTTPException(status_code=403, detail="You do not own this class.")

    # 2. Calculate password: schoolId padded to 6 chars if shorter
    new_password = body.schoolId.ljust(6, '0')

    # 3. Update the auth user's password and flag for password change
    update_resp = await client.put(
        f"{SUPABASE_URL}/auth/v1/admin/users/{body.studentId}",
        headers=headers,
        json={
            "password": new_password,
            "user_metadata": {
                "requires_password_change": True
            }
        }
    )

    if update_resp.status_code not in [200, 201]:
        err_data = update_resp.json() if update_resp.headers.get("content-type", "").startswith("application/json") else {}
        err_msg = err_data.get("msg") or err_data.get("error_description") or update_resp.text
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {err_msg}")

    # 4. Also update the public.students table so the UI reflects the 'New' status
    await client.patch(
        f"{SUPABASE_URL}/rest/v1/students?id=eq.{body.studentId}",
        headers=headers,
        json={
            "requires_password_change": True
        }
    )

    return {"success": True, "message": "Password reset successfully."}

@app.post("/transcribe")
@limiter.limit("10/minute")
async def transcribe(request: Request, file: UploadFile = File(...), user: dict = Depends(verify_authenticated)):
    """
    Transcribes an uploaded audio file (typically webm or mp4) using Groq Whisper.
    """
    try:
        MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File too large. Maximum 10MB.")
        if len(content) < 2000:
            raise ValueError("Audio recording is too short or empty. Please speak clearly for at least 2 seconds.")
        filename = file.filename or "recording.webm"
        
        # Write to temp file to avoid passing large bytes through Redis
        suffix = os.path.splitext(filename)[1] or ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=pipeline.AUDIO_DIR) as tmp:
            tmp.write(content)
            temp_path = tmp.name
        
        # Enqueue the job with file path instead of raw bytes
        job = await asyncio.to_thread(
            transcribe_queue.enqueue,
            "utils.ai.transcribe_audio_from_file", 
            temp_path, 
            filename, 
            result_ttl=3600, job_timeout=3600
        )
        return {"job_id": job.get_id()}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail="Transcription failed. Please try again later.")

@app.post("/grade")
@limiter.limit("10/minute")
async def grade(request: Request, grade_data: GradeRequest, user: dict = Depends(verify_authenticated)):
    """
    Evaluates the student's transcript or dialogue using Gemini 2.5 Flash.
    Returns schema-specific JSON based on the selected mode.
    """
    try:
        retry_policy = None  # jobs wait for AI capacity themselves now
        if grade_data.mode == "read_aloud":
            if not grade_data.source_text or not grade_data.transcript:
                raise HTTPException(status_code=400, detail="read_aloud requires 'source_text' and 'transcript'")
            job = await asyncio.to_thread(grade_queue.enqueue, "utils.ai.evaluate_read_aloud", grade_data.source_text, grade_data.transcript, result_ttl=3600, job_timeout=3600, retry=retry_policy)
            
        elif grade_data.mode == "qa":
            if not grade_data.question or not grade_data.transcript:
                raise HTTPException(status_code=400, detail="qa requires 'question' and 'transcript'")
            job = await asyncio.to_thread(grade_queue.enqueue, "utils.ai.evaluate_qa", grade_data.question, grade_data.transcript, result_ttl=3600, job_timeout=3600, retry=retry_policy)
            
        elif grade_data.mode == "conversation":
            if not grade_data.messages or len(grade_data.messages) == 0:
                raise HTTPException(status_code=400, detail="conversation requires 'messages'")
            job = await asyncio.to_thread(grade_queue.enqueue, "utils.ai.evaluate_conversation", grade_data.messages, result_ttl=3600, job_timeout=3600, retry=retry_policy)
            
        elif grade_data.mode == "debate":
            if not grade_data.motion or not grade_data.role or not grade_data.transcript:
                raise HTTPException(status_code=400, detail="debate requires 'motion', 'role', and 'transcript'")
            job = await asyncio.to_thread(grade_queue.enqueue, "utils.ai.evaluate_debate", grade_data.motion, grade_data.role, grade_data.transcript, result_ttl=3600, job_timeout=3600, retry=retry_policy)
            
        else:
            raise HTTPException(status_code=400, detail=f"Invalid mode: {grade_data.mode}")
            
        return {"job_id": job.get_id()}
            
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Grading error: {e}")
        raise HTTPException(status_code=500, detail="Grading failed. Please try again later.")

@app.post("/chat_reply")
@limiter.limit("15/minute")
async def chat_reply(request: Request, chat_data: ChatReplyRequest, user: dict = Depends(verify_authenticated)):
    """
    Generates a brief response to continue the conversation, using Groq Qwen 3.6-27B.
    """
    try:
        reply = await asyncio.to_thread(get_chat_reply, chat_data.messages)
        return {"reply": reply}
    except (AIBusyError, AITransientError):
        # The frontend retries automatically on this status.
        raise HTTPException(status_code=503, detail="AI_BUSY: The tutor is busy, retrying...")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Chat reply error: {e}")
        raise HTTPException(status_code=500, detail="Chat generation failed. Please try again later.")


# ---------------------------------------------------------------------------
# Submission API (v2): one call per submission, results kept for 48h,
# resumable after refresh, retry without re-recording.
# ---------------------------------------------------------------------------

MAX_AUDIO_BYTES = 24 * 1024 * 1024  # Groq's free Whisper accepts files up to 25MB (long debate speeches)
ALLOWED_AUDIO_EXT = {".webm", ".mp4", ".m4a", ".ogg", ".wav", ".mp3", ".mpeg", ".mpga", ".flac"}


def _user_id(user: dict) -> str:
    return str(user.get("id") or "anonymous")


def _idempotent_lookup(user_id: str, client_id: Optional[str]):
    if not client_id:
        return None
    existing = redis_conn.get(f"idem:{user_id}:{client_id}")
    if existing:
        sub = pipeline.load(existing.decode() if isinstance(existing, bytes) else existing)
        if sub:
            return sub
    return None


def _remember_idempotency(user_id: str, client_id: Optional[str], sub_id: str):
    if client_id:
        redis_conn.setex(f"idem:{user_id}:{client_id}", pipeline.SUB_TTL, sub_id)


def _validate_params(mode: str, params: dict):
    if mode == "read_aloud" and not params.get("source_text"):
        raise HTTPException(status_code=400, detail="read_aloud requires 'source_text'")
    if mode == "qa" and not params.get("question"):
        raise HTTPException(status_code=400, detail="qa requires 'question'")
    if mode == "debate" and not (params.get("motion") and params.get("role")):
        raise HTTPException(status_code=400, detail="debate requires 'motion' and 'role'")
    if mode == "conversation" and not params.get("messages"):
        raise HTTPException(status_code=400, detail="conversation requires 'messages'")


@app.post("/submit")
@limiter.limit("20/minute")
async def submit_audio(
    request: Request,
    file: UploadFile = File(...),
    mode: str = Form(...),
    client_id: Optional[str] = Form(None),
    duration: Optional[float] = Form(None),
    source_text: Optional[str] = Form(None),
    question: Optional[str] = Form(None),
    motion: Optional[str] = Form(None),
    role: Optional[str] = Form(None),
    material_title: Optional[str] = Form(None),
    session_seconds: Optional[float] = Form(None),
    auto_save: Optional[bool] = Form(True),
    user: dict = Depends(verify_authenticated),
):
    """Upload a recording once. It is transcribed and (unless mode='transcribe') graded."""
    if mode not in pipeline.AUDIO_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {mode}")
    user_id = _user_id(user)

    existing = await asyncio.to_thread(_idempotent_lookup, user_id, client_id)
    if existing:  # same upload retried after a network hiccup
        return pipeline.public_view(existing)

    params = {"source_text": source_text, "question": question, "motion": motion, "role": role,
              "material_title": material_title}
    params = {k: v for k, v in params.items() if v}
    _validate_params(mode, params)

    content = await file.read()
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Recording is too large (max 24MB). Please record a shorter answer.")
    if len(content) < 2000:
        raise HTTPException(status_code=400, detail="Recording is too short or empty. Please speak for at least 2 seconds.")

    filename = file.filename or "recording.webm"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        ext = ".webm"
    path = os.path.join(pipeline.AUDIO_DIR, f"{secrets.token_hex(12)}{ext}")
    with open(path, "wb") as f:
        f.write(content)

    def create():
        sub = pipeline.new_submission(user_id, mode, params, audio_path=path,
                                      filename=f"recording{ext}", duration=duration,
                                      auto_save=bool(auto_save) and mode != "transcribe",
                                      session_seconds=session_seconds)
        _remember_idempotency(user_id, client_id, sub["id"])
        return pipeline.public_view(pipeline.enqueue_stage(sub))

    return await asyncio.to_thread(create)


class TextSubmitRequest(BaseModel):
    mode: str
    client_id: Optional[str] = None
    transcript: Optional[str] = None
    source_text: Optional[str] = None
    question: Optional[str] = None
    messages: Optional[List[dict]] = None
    motion: Optional[str] = None
    role: Optional[str] = None
    material_title: Optional[str] = None
    session_seconds: Optional[float] = None
    auto_save: bool = True


@app.post("/submit-text")
@limiter.limit("20/minute")
async def submit_text(request: Request, body: TextSubmitRequest, user: dict = Depends(verify_authenticated)):
    """Grade something that is already text (conversation history, or a saved transcript)."""
    if body.mode not in pipeline.GRADED_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {body.mode}")
    if body.mode != "conversation" and not (body.transcript or "").strip():
        raise HTTPException(status_code=400, detail="transcript is required")
    user_id = _user_id(user)
    existing = await asyncio.to_thread(_idempotent_lookup, user_id, body.client_id)
    if existing:
        return pipeline.public_view(existing)
    params = {k: v for k, v in {
        "source_text": body.source_text, "question": body.question, "messages": body.messages,
        "motion": body.motion, "role": body.role, "material_title": body.material_title,
    }.items() if v}
    _validate_params(body.mode, params)

    def create():
        sub = pipeline.new_submission(user_id, body.mode, params, transcript=body.transcript,
                                      auto_save=body.auto_save, session_seconds=body.session_seconds)
        _remember_idempotency(user_id, body.client_id, sub["id"])
        return pipeline.public_view(pipeline.enqueue_stage(sub))

    return await asyncio.to_thread(create)


def _owned_submission(sub_id: str, user: dict):
    sub = pipeline.load(sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found (it may have expired or the server restarted).")
    if sub.get("user_id") != _user_id(user):
        raise HTTPException(status_code=404, detail="Submission not found.")
    return sub


@app.get("/submission/{sub_id}")
async def get_submission(sub_id: str, user: dict = Depends(verify_authenticated)):
    def read():
        sub = _owned_submission(sub_id, user)
        sub = pipeline.detect_lost_job(sub)
        return pipeline.public_view(sub)
    return await asyncio.to_thread(read)


# ---------------------------------------------------------------------------
# Teacher export (Excel) - built on the server so it always has ALL records
# ---------------------------------------------------------------------------

@app.get("/teacher/export")
@limiter.limit("10/minute")
async def export_scores(
    request: Request,
    class_id: Optional[str] = None,
    mode: Optional[str] = None,
    material: Optional[str] = None,
    days: Optional[int] = None,
    search: Optional[str] = None,
    tz: int = 0,
    teacher: dict = Depends(verify_teacher),
):
    from fastapi.responses import Response
    from utils import export as export_mod

    if mode and mode != "all" and mode not in export_mod.MODE_LABELS:
        raise HTTPException(status_code=400, detail="Invalid mode")
    if days is not None and not (1 <= days <= 3650):
        raise HTTPException(status_code=400, detail="Invalid period")
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase environment configuration missing.")

    try:
        classes, students, assessments = await asyncio.to_thread(
            export_mod.fetch_export_data, teacher.get("id"), class_id, mode, days)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        print(f"Export failed: {e}")
        raise HTTPException(status_code=502, detail="Could not read scores from the database. Please try again.")

    teacher_name = (teacher.get("user_metadata") or {}).get("full_name") or teacher.get("email") or ""
    content, count = await asyncio.to_thread(
        export_mod.build_workbook, classes, students, assessments,
        mode=mode, material=material, search=search, days=days,
        tz_offset_minutes=tz, teacher_name=teacher_name)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="hrefspeak_scores.xlsx"',
                 "X-Record-Count": str(count),
                 "Access-Control-Expose-Headers": "X-Record-Count"},
    )


@app.post("/submission/{sub_id}/save")
@limiter.limit("20/minute")
async def save_submission(request: Request, sub_id: str, user: dict = Depends(verify_authenticated)):
    """Save a graded submission's score (used by modes that save on request, e.g. debate)."""
    sub = await asyncio.to_thread(_owned_submission, sub_id, user)
    if sub.get("status") != "completed":
        raise HTTPException(status_code=409, detail="This submission has not been graded yet.")
    ok = await asyncio.to_thread(pipeline.save_assessment, sub_id)
    if not ok:
        raise HTTPException(status_code=502, detail="Could not save the score right now. Please try again.")
    return {"saved": True}


@app.post("/submission/{sub_id}/retry")
@limiter.limit("20/minute")
async def retry_submission(request: Request, sub_id: str, user: dict = Depends(verify_authenticated)):
    """Continue a failed submission from the step where it stopped."""
    def retry():
        sub = _owned_submission(sub_id, user)
        if sub["status"] in pipeline.ACTIVE or sub["status"] == "completed":
            return pipeline.public_view(sub)
        if sub.get("transcript") and sub["mode"] in pipeline.GRADED_MODES:
            sub["stage"] = "grade"
        elif sub.get("mode") == "conversation":
            sub["stage"] = "grade"
        elif sub.get("audio_path") and os.path.exists(sub["audio_path"]):
            sub["stage"] = "transcribe"
        else:
            raise HTTPException(status_code=410, detail="The recording is no longer on the server. Please upload it again.")
        sub["needs_rerecord"] = False
        # Retrying students go to the front: they already waited their turn.
        return pipeline.public_view(pipeline.enqueue_stage(sub, at_front=True))
    return await asyncio.to_thread(retry)

@app.get("/job/{job_id}")
async def get_job_status(job_id: str):
    """
    Check the status of a background job.
    """
    try:
        job = await asyncio.to_thread(Job.fetch, job_id, connection=redis_conn)
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.is_finished:
        result = job.result
        # If the result is a Pydantic model, convert to dict
        if hasattr(result, "model_dump"):
            result = result.model_dump()
        # For transcribe, it returns a string text, we want {"text": ...}
        elif isinstance(result, str) and job.func_name and "transcribe" in job.func_name:
            result = {"text": result}
            
        return {"status": "completed", "result": result}
    elif job.is_failed:
        # Log the full error server-side, return a generic message to the client
        print(f"[JOB FAILED] {job_id}: {job.exc_info}")
        
        # Detect if it was a rate limit exhaustion (Gemini 429)
        if job.exc_info and "429" in str(job.exc_info):
            _match = re.search(r'retry in (\d+(?:\.\d+)?)s', str(job.exc_info), re.IGNORECASE)
            _ttl = int(float(_match.group(1))) + 10 if _match else 60
            redis_conn.setex("ai_quota_exhausted", _ttl, "true")
            return {"status": "failed", "error": "AI provider rate limit reached. Please wait a minute and try again."}
            
        return {"status": "failed", "error": "Evaluation failed. Please try again."}
    else:
        position = job.get_position()
        return {
            "status": job.get_status(), # e.g. 'queued', 'started', 'deferred', 'scheduled'
            "position": position + 1 if position is not None else None
        }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860 if os.environ.get("SPACE_ID") else 8000))
    # Disable reload in production (when PORT is specified or running in Hugging Face Spaces)
    reload = False if (os.environ.get("PORT") or os.environ.get("SPACE_ID")) else True
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
