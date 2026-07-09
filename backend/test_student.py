import os
import asyncio
from dotenv import load_dotenv
from httpx import AsyncClient

load_dotenv()

async def main():
    async with AsyncClient() as client:
        url = os.getenv("SUPABASE_URL")
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        
        # 1. Get a student
        res = await client.get(
            f"{url}/rest/v1/students?limit=1",
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        )
        student = res.json()[0]
        student_id = student["id"]
        
        # 2. Get the student's email from auth.users via RPC or just update password via admin API
        # We don't know the email easily from the student table (unless email is there).
        # Wait, school_id is in student. We can just reset their password via the backend!
        # Actually, let's just query auth.users using service role key to get the email.
        # But auth schema isn't accessible via PostgREST.
        pass

asyncio.run(main())
