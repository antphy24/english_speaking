import os
import sys
sys.path.append('backend')
from utils.ai import call_groq_json, ReadAloudEvaluation
import time

prompt = "Analyze read aloud. Source: 'Hello world', Transcript: 'Hello'"
start = time.time()
try:
    res = call_groq_json(prompt, ReadAloudEvaluation)
    print("SUCCESS in", time.time()-start, "s:", res)
except Exception as e:
    print("ERROR after", time.time()-start, "s:", str(e))
