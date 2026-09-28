"""
Quick health check for the Groq models this app rotates between.

    cd backend
    python check_groq.py

Makes ONE small call per model (uses a tiny bit of free quota) and reports
which models work with your key. If a model is renamed or removed by Groq,
update TRANSCRIBE_MODELS / GRADE_MODELS / CHAT_MODELS (env vars) accordingly.
"""
import os
import time

from utils import ai

SAMPLE_Q = "Describe your favourite hobby."
SAMPLE_A = "My favourite hobby is playing football because it keeps me healthy and I play with my friends every weekend."


def check_grade(model):
    start = time.time()
    out = ai._grade_with_schema(
        f'Question: "{SAMPLE_Q}"\nAnswer: "{SAMPLE_A}"\nScore 0-100 each and give feedback.\n'
        'Return JSON: {"fluency": int, "lexical_resource": int, "grammatical_range": int, '
        '"pronunciation": int, "feedback": string}',
        ai.QAEvaluation, models=[model], deadline=time.time() + 60, on_wait=None,
    )
    return f"OK in {time.time() - start:.1f}s -> fluency={out['fluency']}"


def check_transcribe(model):
    path = os.path.join(os.path.dirname(__file__), "beep.ogg")
    start = time.time()
    saved = ai.TRANSCRIBE_MODELS
    ai.TRANSCRIBE_MODELS = [model]
    try:
        text = ai.transcribe_file(path, "beep.ogg", 3, deadline=time.time() + 60)
    finally:
        ai.TRANSCRIBE_MODELS = saved
    return f"OK in {time.time() - start:.1f}s -> {text[:40]!r}"


if __name__ == "__main__":
    for model in ai.TRANSCRIBE_MODELS:
        try:
            print(f"[transcribe] {model}: {check_transcribe(model)}")
        except Exception as e:
            print(f"[transcribe] {model}: FAILED - {e}")
    for model in dict.fromkeys(ai.GRADE_MODELS + ai.CHAT_MODELS):
        try:
            print(f"[grade]      {model}: {check_grade(model)}")
        except Exception as e:
            print(f"[grade]      {model}: FAILED - {e}")
    try:
        print(f"[chat]       reply: {ai.get_chat_reply([{'role': 'user', 'content': 'Hi, I like football.'}])[:80]!r}")
    except Exception as e:
        print(f"[chat]       FAILED - {e}")
