import os
import asyncio
from dotenv import load_dotenv
from httpx import AsyncClient

load_dotenv()

async def main():
    async with AsyncClient() as client:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        
        # Query postgres directly using RPC or REST to get table schema and policies
        # The OpenAPI spec contains the schema
        res = await client.get(
            f"{url}/rest/v1/?apikey={key}",
            headers={"Authorization": f"Bearer {key}"}
        )
        print("Schema definition for students:")
        data = res.json()
        print(data.get('definitions', {}).get('students', 'Not found'))

asyncio.run(main())
