import sys
import os
sys.path.append('backend')
from utils.ai import call_groq_json, ReadAloudEvaluation

source_text = "Yesterday, Sekolah Islam Athirah Bone celebrated Indonesian Independence Day. It is a big day for everyone in the school."
transcript = "Yesterday, Sekolah Islam Atirah Boun celebrated Indonesian Independence D"

prompt = (
    f"Analyze the student's read aloud attempt.\n\n"
    f"Original text: \"{source_text}\"\n"
    f"Student's transcript: \"{transcript}\"\n\n"
    f"Compare the student's transcript with the original text.\n"
    f"Identify:\n"
    f"1. Words skipped by the student.\n"
    f"2. Words mispronounced, misspelled or substituted.\n"
    f"3. Calculate accuracy score (0-100) and Word Error Rate (WER).\n"
    f"4. Provide actionable feedback to help them improve. IMPORTANT: Speak directly to the student using 'you' and 'your'. DO NOT speak in the third person.\n\n"
    f"You must respond with a valid JSON object."
)

try:
    res = call_groq_json(prompt, ReadAloudEvaluation)
    print("SUCCESS", res)
except Exception as e:
    print("ERROR", str(e))
