import os
import secrets
import string
import httpx
import asyncio
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from contextlib import asynccontextmanager

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Import utilities
from utils.ai import (
    transcribe_audio_bytes,
    get_llama_chat_reply,
    evaluate_read_aloud,
    evaluate_qa,
    evaluate_conversation,
    evaluate_debate
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("FastAPI Application Starting up...")
    yield

app = FastAPI(title="English speaking assessment platform API", lifespan=lifespan)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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

async def verify_teacher(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing.")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format. Must be Bearer token.")
    
    token = authorization.split(" ")[1]
    
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase backend configuration is missing.")
        
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {token}"
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers)
            
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Session expired or invalid token.")
            
        user_info = response.json()
        user_metadata = user_info.get("user_metadata", {})
        
        # Verify role is teacher
        if user_metadata.get("role") != "teacher":
            raise HTTPException(status_code=403, detail="Access denied. Account is not a teacher.")
            
        return user_info
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Auth verification error: {e}")
        raise HTTPException(status_code=500, detail="Authentication check failed.")

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
            
    async with httpx.AsyncClient() as client:
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
    async with httpx.AsyncClient() as client:
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

    async with httpx.AsyncClient() as client:
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

        # 3. Delete each student's auth account concurrently
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

        # 4. Delete the class record (cascade handles students, assessments, activity_logs)
        del_resp = await client.delete(
            f"{SUPABASE_URL}/rest/v1/classes?id=eq.{body.classId}",
            headers=headers
        )

        if del_resp.status_code not in [200, 204]:
            err_data = del_resp.json() if del_resp.headers.get("content-type", "").startswith("application/json") else {}
            err_msg = err_data.get("msg") or err_data.get("error_description") or del_resp.text
            raise HTTPException(status_code=500, detail=f"Failed to delete class: {err_msg}")

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

    async with httpx.AsyncClient() as client:
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
async def transcribe(request: Request, file: UploadFile = File(...)):
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
        
        # Call Groq Whisper utility non-blocking
        transcription_text = await asyncio.to_thread(transcribe_audio_bytes, content, filename)
        
        return {"text": transcription_text}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail="Transcription failed. Please try again later.")

@app.post("/grade")
@limiter.limit("10/minute")
async def grade(request: Request, grade_data: GradeRequest):
    """
    Evaluates the student's transcript or dialogue using Gemini 2.5 Flash.
    Returns schema-specific JSON based on the selected mode.
    """
    try:
        if grade_data.mode == "read_aloud":
            if not grade_data.source_text or not grade_data.transcript:
                raise HTTPException(
                    status_code=400, 
                    detail="read_aloud mode requires 'source_text' and 'transcript'"
                )
            result = await asyncio.to_thread(evaluate_read_aloud, grade_data.source_text, grade_data.transcript)
            # Pydantic dump
            return result.model_dump()
            
        elif grade_data.mode == "qa":
            if not grade_data.question or not grade_data.transcript:
                raise HTTPException(
                    status_code=400, 
                    detail="qa mode requires 'question' and 'transcript'"
                )
            result = await asyncio.to_thread(evaluate_qa, grade_data.question, grade_data.transcript)
            return result.model_dump()
            
        elif grade_data.mode == "conversation":
            if not grade_data.messages or len(grade_data.messages) == 0:
                raise HTTPException(
                    status_code=400, 
                    detail="conversation mode requires a list of 'messages'"
                )
            result = await asyncio.to_thread(evaluate_conversation, grade_data.messages)
            return result.model_dump()
            
        elif grade_data.mode == "debate":
            if not grade_data.motion or not grade_data.role or not grade_data.transcript:
                raise HTTPException(
                    status_code=400,
                    detail="debate mode requires 'motion', 'role', and 'transcript'"
                )
            result = await asyncio.to_thread(evaluate_debate, grade_data.motion, grade_data.role, grade_data.transcript)
            return result.model_dump()
            
        else:
            raise HTTPException(status_code=400, detail=f"Invalid mode: {grade_data.mode}")
            
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Grading error: {e}")
        raise HTTPException(status_code=500, detail="Grading failed. Please try again later.")

@app.post("/chat_reply")
@limiter.limit("15/minute")
async def chat_reply(request: Request, chat_data: ChatReplyRequest):
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

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860 if os.environ.get("SPACE_ID") else 8000))
    # Disable reload in production (when PORT is specified or running in Hugging Face Spaces)
    reload = False if (os.environ.get("PORT") or os.environ.get("SPACE_ID")) else True
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
