import asyncio
from fastapi.testclient import TestClient
from main import app
import os
os.environ["ALLOW_MOCK_TOKENS"] = "true"

def test_transcribe():
    with TestClient(app) as client:
        # Create a dummy file of 3000 bytes
        with open("dummy.webm", "wb") as f:
            f.write(b"0" * 3000)
            
        with open("dummy.webm", "rb") as f:
            response = client.post(
                "/transcribe",
                headers={"Authorization": "Bearer header.eyJzdWIiOiIxMjMifQ==.mock_signature"},
                files={"file": ("test.webm", f, "audio/webm")}
            )
        print("Status:", response.status_code)
        print("Response:", response.text)

test_transcribe()
