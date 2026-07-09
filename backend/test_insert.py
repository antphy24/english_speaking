import os
import asyncio
from dotenv import load_dotenv
from httpx import AsyncClient
import uuid
from datetime import datetime

load_dotenv()

async def main():
    async with AsyncClient() as client:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        
        # We need a valid student_id. Let's fetch one from students table
        res = await client.get(f"{url}/rest/v1/students?limit=1", headers=headers)
        students = res.json()
        if not students:
            print("No students found!")
            return
            
        student_id = students[0]["id"]
        print(f"Using student_id: {student_id}")

        # Attempt to insert into assessments
        payload = {
            "student_id": student_id,
            "mode": "read_aloud",
            "score": 85,
            "feedback": {"accuracy_score": 85, "word_error_rate": 0.1, "feedback": "Good"},
            "duration_seconds": 120
        }
        
        post_res = await client.post(
            f"{url}/rest/v1/assessments",
            headers=headers,
            json=payload
        )
        
        print(f"Status Code: {post_res.status_code}")
        print("Response:", post_res.text)

asyncio.run(main())
