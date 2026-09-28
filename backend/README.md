---
title: Hrefspeak Backend
emoji: 🚀
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Hrefspeak Backend
This is the backend for the Hrefspeak English learning platform. It runs FastAPI and multiple RQ background workers managed by Supervisord.

## How submissions flow (v2)

1. The student's browser uploads the recording once to `POST /submit` (or `POST /submit-text`
   for conversation grading) and gets a submission id.
2. Workers transcribe (Whisper) and then grade. When Groq's free rate limits are reached, jobs
   **wait in line** and rotate between several free models instead of failing
   (`utils/ratelimit.py`, `utils/ai.py`).
3. The browser polls `GET /submission/{id}` with no overall time limit and shows the queue
   position and estimated wait. The recording is kept on the device and on the server until
   the result arrives, so "Retry" (`POST /submission/{id}/retry`) never needs a new recording,
   even after a page refresh.

### Deployment notes
- Redis now runs **inside the container** (see `supervisord.conf`). To use it, delete the
  `REDIS_URL` secret in the Space settings (or set it to `redis://localhost:6379`).
  This avoids Upstash's free command limits. The queue resets if the Space restarts; students'
  browsers then re-upload their saved recording automatically.
- Model lists can be changed without code changes: `TRANSCRIBE_MODELS`, `GRADE_MODELS`,
  `FEEDBACK_MODELS`, `CHAT_MODELS` (comma-separated). Limits: `GROQ_LIMITS_JSON`.
- Run `python check_groq.py` to check that every model works with your key.
- Make sure `ALLOW_MOCK_TOKENS` is **not** `true` in production.
