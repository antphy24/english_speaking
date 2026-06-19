import os
import shutil
import httpx
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Import utilities
from utils.ai import (
    transcribe_audio_bytes,
    get_llama_chat_reply,
    evaluate_read_aloud,
    evaluate_qa,
    evaluate_conversation
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

app = FastAPI(title="English speaking assessment platform API")

# Enable CORS for frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    print("FastAPI Application Starting up...")

# --- API Schemas ---

class GradeRequest(BaseModel):
    mode: str  # "read_aloud" | "qa" | "conversation"
    transcript: Optional[str] = None
    source_text: Optional[str] = None      # Required for read_aloud
    question: Optional[str] = None         # Required for qa
    messages: Optional[List[dict]] = None  # Required for conversation

class ChatReplyRequest(BaseModel):
    messages: List[dict]

class StudentEnrollInfo(BaseModel):
    fullName: str
    schoolId: str

class BulkEnrollRequest(BaseModel):
    classId: str
    classCode: str
    students: List[StudentEnrollInfo]

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
        raise HTTPException(status_code=500, detail=f"Authentication check failed: {str(e)}")



# --- Endpoints ---

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Welcome to the English speaking assessment platform API"
    }

@app.post("/teacher/bulk-enroll")
async def bulk_enroll(request: BulkEnrollRequest, teacher: dict = Depends(verify_teacher)):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase environment configuration missing.")
        
    success_count = 0
    failures = []
    
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json"
    }
    
    async with httpx.AsyncClient() as client:
        for student in request.students:
            sanitized_school_id = "".join(c for c in student.schoolId if c.isalnum())
            email = f"student_{sanitized_school_id}@{request.classCode}.hrefspeak.com".lower()
            password = student.schoolId  # Password defaults to school ID
            
            payload = {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {
                    "role": "student",
                    "class_id": request.classId,
                    "full_name": student.fullName,
                    "school_id": student.schoolId
                }
            }
            
            try:
                response = await client.post(
                    f"{SUPABASE_URL}/auth/v1/admin/users",
                    headers=headers,
                    json=payload
                )
                
                if response.status_code in [200, 201]:
                    success_count += 1
                else:
                    err_data = response.json()
                    err_msg = err_data.get("msg") or err_data.get("error_description") or response.text
                    failures.append(f"{student.fullName} ({student.schoolId}): {err_msg}")
            except Exception as e:
                failures.append(f"{student.fullName} ({student.schoolId}): {str(e)}")
                
    return {
        "successCount": success_count,
        "failures": failures
    }

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """
    Transcribes an uploaded audio file (typically webm or mp4) using Groq Whisper.
    """
    try:
        content = await file.read()
        filename = file.filename or "recording.webm"
        
        # Call Groq Whisper utility
        transcription_text = transcribe_audio_bytes(content, filename)
        
        return {"text": transcription_text}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        print(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

@app.post("/grade")
async def grade(request: GradeRequest):
    """
    Evaluates the student's transcript or dialogue using Gemini 2.5 Flash.
    Returns schema-specific JSON based on the selected mode.
    """
    try:
        if request.mode == "read_aloud":
            if not request.source_text or not request.transcript:
                raise HTTPException(
                    status_code=400, 
                    detail="read_aloud mode requires 'source_text' and 'transcript'"
                )
            result = evaluate_read_aloud(request.source_text, request.transcript)
            # Pydantic dump
            return result.model_dump()
            
        elif request.mode == "qa":
            if not request.question or not request.transcript:
                raise HTTPException(
                    status_code=400, 
                    detail="qa mode requires 'question' and 'transcript'"
                )
            result = evaluate_qa(request.question, request.transcript)
            return result.model_dump()
            
        elif request.mode == "conversation":
            if not request.messages or len(request.messages) == 0:
                raise HTTPException(
                    status_code=400, 
                    detail="conversation mode requires a list of 'messages'"
                )
            result = evaluate_conversation(request.messages)
            return result.model_dump()
            
        else:
            raise HTTPException(status_code=400, detail=f"Invalid mode: {request.mode}")
            
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        print(f"Grading error: {e}")
        raise HTTPException(status_code=500, detail=f"Grading failed: {str(e)}")

@app.post("/chat_reply")
async def chat_reply(request: ChatReplyRequest):
    """
    Generates a brief response to continue the conversation, using Groq Llama-3.3-70B.
    """
    try:
        reply = get_llama_chat_reply(request.messages)
        return {"reply": reply}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        print(f"Chat reply error: {e}")
        raise HTTPException(status_code=500, detail=f"Chat generation failed: {str(e)}")



if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 7860 if os.environ.get("SPACE_ID") else 8000))
    # Disable reload in production (when PORT is specified or running in Hugging Face Spaces)
    reload = False if (os.environ.get("PORT") or os.environ.get("SPACE_ID")) else True
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
