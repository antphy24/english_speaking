import os
import asyncio
from dotenv import load_dotenv
from httpx import AsyncClient

load_dotenv()

async def main():
    async with AsyncClient() as client:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }
        
        # We can query information_schema or pg_catalog using PostgREST if they are exposed, 
        # but they usually aren't.
        # Instead, let's intentionally violate the foreign key to see the EXACT error.
        
        payload = {
            "student_id": "00000000-0000-0000-0000-000000000000",
            "mode": "read_aloud",
            "score": 85,
            "feedback": {},
            "duration_seconds": 10
        }
        
        res = await client.post(f"{url}/rest/v1/assessments", headers=headers, json=payload)
        print("Intentional FK violation response:")
        print(res.text)

asyncio.run(main())
