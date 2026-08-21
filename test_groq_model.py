import os
from groq import Groq
try:
    client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    response = client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": "hi"}]
    )
    print("SUCCESS", response.choices[0].message.content)
except Exception as e:
    print("ERROR", str(e))
