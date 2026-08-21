import sys
import os
sys.path.append('backend')
import time
import logging
logging.basicConfig(level=logging.DEBUG)

from utils.ai import call_groq_json, ReadAloudEvaluation

prompt = """
Analyze the student's read aloud attempt.

Original text: "This is a simple test of the read aloud feature to see how long it takes to process a short paragraph of text. It should not take five minutes to do this."
Student's transcript: "This is a simple test of read aloud feature to see how long take to process a short paragraph of text. It should not take five minute to do this."

Compare the student's transcript with the original text.
Identify:
1. Words skipped by the student.
2. Words mispronounced, misspelled or substituted.
3. Calculate accuracy score (0-100) and Word Error Rate (WER).
4. Provide actionable feedback to help them improve. IMPORTANT: Speak directly to the student using 'you' and 'your' (e.g., 'You did a great job...', 'Your pronunciation...'). DO NOT speak in the third person.
"""

start = time.time()
try:
    res = call_groq_json(prompt, ReadAloudEvaluation)
    print("SUCCESS in", time.time()-start, "s:")
    print(res)
except Exception as e:
    print("ERROR after", time.time()-start, "s:", str(e))
