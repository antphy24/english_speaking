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
from rq import Queue, Retry
from rq.job import Job

# Import utilities
from utils.ai import (
    transcribe_audio_bytes,
    transcribe_audio_from_file,
    get_llama_chat_reply,
    evaluate_read_aloud,
    evaluate_qa,
    evaluate_conversation,
    evaluate_debate
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

async def temp_file_reaper():
    """Periodically clean up orphaned temp audio files."""
    while True:
        await asyncio.sleep(300)  # Every 5 minutes
        temp_dir = tempfile.gettempdir()
        now = time.time()
        for f in glob.glob(os.path.join(temp_dir, "tmp*.webm")) + \
                 glob.glob(os.path.join(temp_dir, "tmp*.mp4")) + \
                 glob.glob(os.path.join(temp_dir, "tmp*.ogg")):
            try:
                if now - os.path.getmtime(f) > 600:  # 10 min old
                    os.unlink(f)
            except OSError:
                pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("FastAPI Application Starting up...")
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        limits=httpx.Limits(max_keepalive_connections=20, max_connections=50)
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
    except Exception as e:
        print(f"Auth verification error: {e}")
        raise HTTPException(status_code=500, detail=f"Authentication check failed: {type(e).__name__} - {str(e)}")

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
    is_exhausted = redis_conn.get("ai_quota_exhausted")
    
    grade_queue_length = len(grade_queue)
    transcribe_queue_length = len(transcribe_queue)
    
    if is_exhausted:
        return {"status": "exhausted", "message": "AI quota reached. Please wait a minute."}
    elif grade_queue_length >= 5:
        return {"status": "busy", "message": f"AI is busy processing requests ({grade_queue_length} in queue)."}
    else:
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
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            temp_path = tmp.name
        
        # Enqueue the job with file path instead of raw bytes
        job = await asyncio.to_thread(
            transcribe_queue.enqueue,
            "utils.ai.transcribe_audio_from_file", 
            temp_path, 
            filename, 
            result_ttl=3600
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
        # Circuit breaker: if we know Gemini is rate-limited, don't even enqueue the job
        if redis_conn.get("ai_quota_exhausted"):
            raise HTTPException(status_code=429, detail="AI quota is temporarily exhausted. Please wait a moment.")

        retry_policy = Retry(max=3, interval=60)
        if grade_data.mode == "read_aloud":
            if not grade_data.source_text or not grade_data.transcript:
                raise HTTPException(status_code=400, detail="read_aloud requires 'source_text' and 'transcript'")
            job = await asyncio.to_thread(grade_queue.enqueue, "utils.ai.evaluate_read_aloud", grade_data.source_text, grade_data.transcript, result_ttl=3600, retry=retry_policy)
            
        elif grade_data.mode == "qa":
            if not grade_data.question or not grade_data.transcript:
                raise HTTPException(status_code=400, detail="qa requires 'question' and 'transcript'")
            job = await asyncio.to_thread(grade_queue.enqueue, "utils.ai.evaluate_qa", grade_data.question, grade_data.transcript, result_ttl=3600, retry=retry_policy)
            
        elif grade_data.mode == "conversation":
            if not grade_data.messages or len(grade_data.messages) == 0:
                raise HTTPException(status_code=400, detail="conversation requires 'messages'")
            job = await asyncio.to_thread(grade_queue.enqueue, "utils.ai.evaluate_conversation", grade_data.messages, result_ttl=3600, retry=retry_policy)
            
        elif grade_data.mode == "debate":
            if not grade_data.motion or not grade_data.role or not grade_data.transcript:
                raise HTTPException(status_code=400, detail="debate requires 'motion', 'role', and 'transcript'")
            job = await asyncio.to_thread(grade_queue.enqueue, "utils.ai.evaluate_debate", grade_data.motion, grade_data.role, grade_data.transcript, result_ttl=3600, retry=retry_policy)
            
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
    Generates a brief response to continue the conversation, using Groq Qwen3.6-27B.
    """
    try:
        reply = await asyncio.to_thread(get_llama_chat_reply, chat_data.messages)
        return {"reply": reply}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Chat reply error: {e}")
        raise HTTPException(status_code=500, detail="Chat generation failed. Please try again later.")

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
