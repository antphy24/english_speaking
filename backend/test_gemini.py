import os
from pydantic import BaseModel
from google import genai
from google.genai import types

class OutputModel(BaseModel):
    score: int
    feedback: str

# Use the existing GEMINI_API_KEY from environment, so we don't have to provide one here
# Wait, let's load it from .env
from dotenv import load_dotenv
load_dotenv()

client = genai.Client()
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Evaluate this: 'Hello'. Provide a score (0-10) and feedback.",
    config=types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=OutputModel,
        temperature=0.1
    )
)
print("text:", repr(response.text))
print("parsed:", response.parsed)

