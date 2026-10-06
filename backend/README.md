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
- Read Aloud feedback is hybrid: AI-written when the queue is short, otherwise an instant standard
  paragraph built from the exact word comparison (scores are identical either way). Tune with
  `READ_ALOUD_AI_WAIT_SECONDS` (default 60) and `READ_ALOUD_BUSY_QUEUE` (default 5 waiting jobs).
  Each saved result has `feedback_source: "ai" | "standard"`.
- Submissions never time out while the AI is only busy (per-minute / per-hour limits): they keep their
  place in line. They stop only when every model has used today's free quota, with a clear
  "try again later" message (recording/transcript kept). Safety net: `PATIENT_MAX_WAIT_SECONDS` (6h).
- Teachers' "Export Excel" (`GET /teacher/export`) is built on the server with openpyxl and contains all
  matching records: a per-student Summary sheet, an All attempts sheet (numeric scores, sub-scores,
  transcript) and an About sheet. Run `supabase/migrations/20260928_assessment_transcript.sql` once so
  transcripts are stored (everything still works before you run it, just without transcripts).
- Backup transcription: when Groq's free Whisper allowance is used up, keeps failing, or would make a
  student wait more than `LOCAL_ASR_SWITCH_AFTER_SECONDS` (default 90), recordings are transcribed on this
  server with open-source Whisper (faster-whisper, `LOCAL_WHISPER_MODEL`, default `base.en`), one at a
  time. Disable with `LOCAL_ASR_ENABLED=false`. Check it with `python check_local_asr.py`.
- Run `python check_groq.py` to check that every model works with your key.
- Make sure `ALLOW_MOCK_TOKENS` is **not** `true` in production.
