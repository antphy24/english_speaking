import os
from groq import Groq
try:
    client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    response = client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": "hi"}]
    )
    print("SUCCESS", response.model)
except Exception as e:
    print("ERROR", str(e))
