"""
AI calls (Groq) with free-tier friendly behaviour:

* Every call goes through the shared RateLimiter, so workers wait for a free
  slot instead of failing with HTTP 429.
* Each task has a *chain* of models. Each Groq model has its own free quota,
  so when one is busy or out of quota we move to the next one.
* Prompts are compact and gpt-oss models run with reasoning_effort=low, which
  cuts token usage per grade roughly in half (more grades per minute for free).
* Read Aloud accuracy / WER / skipped words are computed locally in Python
  (exact and free). The AI only writes the feedback paragraph, and if the AI is
  unavailable we still return a result with template feedback.
"""
import difflib
import json
import os
import re
import time
from typing import Annotated, Callable, List, Optional

import redis
from dotenv import load_dotenv
from pydantic import BaseModel, BeforeValidator, ValidationError

load_dotenv()

from utils.ratelimit import RateLimiter  # noqa: E402

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_kwargs = {"socket_keepalive": True, "health_check_interval": 30}
if redis_url.startswith("rediss://"):
    redis_kwargs["ssl_cert_reqs"] = None
redis_conn = redis.from_url(redis_url, **redis_kwargs)
limiter = RateLimiter(redis_conn)


def _models(env_name, default):
    return [m.strip() for m in os.getenv(env_name, default).split(",") if m.strip()]


# Order = preference. Override with env vars if Groq renames/adds models.
TRANSCRIBE_MODELS = _models("TRANSCRIBE_MODELS", "whisper-large-v3,whisper-large-v3-turbo")
GRADE_MODELS = _models("GRADE_MODELS", "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b")
FEEDBACK_MODELS = _models("FEEDBACK_MODELS", "openai/gpt-oss-20b,qwen/qwen3.8-27b,openai/gpt-oss-120b")
CHAT_MODELS = _models("CHAT_MODELS", "openai/gpt-oss-20b,qwen/qwen3.8-27b,openai/gpt-oss-120b")


# --- Errors ---------------------------------------------------------------------

class AIBusyError(Exception):
    """All models stayed busy / rate-limited until the deadline. Safe to retry later."""


class AITransientError(Exception):
    """Repeated network/server/output errors. Safe to retry later."""


class BadAudioError(Exception):
    """The audio itself cannot be processed; the student has to record again."""


class _RateLimited(Exception):
    def __init__(self, retry_after, daily=False, msg=""):
        super().__init__(msg)
        self.retry_after = retry_after
        self.daily = daily


class _ModelUnusable(Exception):
    """Model rejected the request (not found, bad parameter, no access)."""


class _Transient(Exception):
    """Network error, 5xx, timeout, or invalid JSON from the model."""


# --- Groq client ----------------------------------------------------------------

_client = None


def get_client():
    global _client
    if _client is None:
        from groq import Groq
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key or api_key == "YOUR_GROQ_API_KEY":
            raise ValueError("GROQ_API_KEY is not set or is invalid in .env")
        # max_retries=0: retries/backoff are handled by run_with_fallback below.
        _client = Groq(api_key=api_key, timeout=90.0, max_retries=0)
    return _client


def _parse_retry_after(exc):
    """Seconds to wait from a Groq 429 (header first, then the message text)."""
    try:
        header = exc.response.headers.get("retry-after")
        if header:
            return float(header)
    except Exception:
        pass
    text = str(exc)
    m = re.search(r"(?:try again in|retry in)\s*((?:\d+h)?(?:\d+m)?(?:\d+(?:\.\d+)?s)?)", text, re.I)
    if m and m.group(1):
        total = 0.0
        for value, unit in re.findall(r"(\d+(?:\.\d+)?)([hms])", m.group(1)):
            total += float(value) * {"h": 3600, "m": 60, "s": 1}[unit]
        if total > 0:
            return total
    return 30.0


def _classify(exc, kind):
    """Turn a Groq SDK exception into one of our internal categories."""
    import groq
    text = str(exc)
    if isinstance(exc, groq.RateLimitError):
        daily = "per day" in text.lower() or "(rpd)" in text.lower() or "(tpd)" in text.lower() or "(asd)" in text.lower()
        return _RateLimited(_parse_retry_after(exc) + 1, daily=daily, msg=text)
    if isinstance(exc, (groq.APITimeoutError, groq.APIConnectionError, groq.InternalServerError)):
        return _Transient(text)
    if isinstance(exc, groq.APIStatusError):
        status = exc.status_code
        if status >= 500 or status in (408, 409, 498):
            return _Transient(text)
        if status == 400 and "json_validate_failed" in text:
            return _Transient(text)  # model produced bad JSON; just try again
        if kind == "transcribe" and status in (400, 413, 415, 422):
            return BadAudioError(text)
        return _ModelUnusable(text)  # 401/403/404 or unsupported parameter
    return _Transient(text)


def run_with_fallback(
    kind: str,
    models: List[str],
    call: Callable[[str], tuple],
    *,
    deadline: float,
    est_tokens: int = 0,
    audio_seconds: int = 0,
    on_wait: Optional[Callable[[float], None]] = None,
    max_transient: int = 6,
):
    """
    Try `call(model)` on the first model that has free capacity.
    `call` must return (result, tokens_used). Waits (sleeps) while every model
    is busy, until `deadline` (a time.time() timestamp).
    """
    transient_errors = 0
    last_error = None
    while True:
        waits = []
        for model in models:
            cool = limiter.cooldown_remaining(model)
            if cool > 0:
                waits.append(cool)
                continue
            ok, wait = limiter.try_acquire(model, tokens=est_tokens, audio_seconds=audio_seconds)
            if not ok:
                waits.append(wait)
                continue
            try:
                result, used = call(model)
                limiter.adjust_tokens(model, est_tokens, used or est_tokens)
                return result
            except Exception as raw:  # noqa: BLE001
                err = raw if isinstance(raw, (_RateLimited, _ModelUnusable, _Transient, BadAudioError)) else _classify(raw, kind)
                last_error = err
                if isinstance(err, BadAudioError):
                    raise err
                if isinstance(err, _RateLimited):
                    # Groq refused: the reserved tokens were not used.
                    limiter.adjust_tokens(model, est_tokens, 0)
                    limiter.cooldown(model, err.retry_after, "daily quota" if err.daily else "429")
                    waits.append(err.retry_after)
                elif isinstance(err, _ModelUnusable):
                    limiter.cooldown(model, 600, f"unusable: {str(err)[:120]}")
                else:
                    transient_errors += 1
                    print(f"[{kind}] transient error on {model} ({transient_errors}/{max_transient}): {str(err)[:200]}")
                    if transient_errors >= max_transient:
                        raise AITransientError(str(err)) from raw
                    waits.append(min(2 ** transient_errors, 20))
        now = time.time()
        if now >= deadline:
            raise AIBusyError(f"All {kind} models busy until deadline. Last error: {last_error}")
        sleep_for = max(1.0, min(min(waits) if waits else 5.0, 20.0, deadline - now))
        if on_wait:
            try:
                on_wait(sleep_for)
            except Exception:
                pass
        time.sleep(sleep_for)


# --- Helpers ---------------------------------------------------------------------

def _estimate_tokens(text: str, expected_output: int) -> int:
    return int(len(text) / 3.2) + expected_output


def _extra_params(model: str) -> dict:
    """Model-specific knobs. gpt-oss models think less with reasoning_effort=low."""
    if model.startswith("openai/gpt-oss"):
        return {"reasoning_effort": "low"}
    return {}


def _strip_reasoning(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()


def _extract_json(text: str) -> dict:
    text = _strip_reasoning(text)
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise _Transient(f"No JSON object in model output: {text[:120]!r}")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise _Transient(f"Invalid JSON from model: {e}")


def _create_chat(model: str, params: dict, *, json_mode: bool):
    """
    Call Groq chat completions. If a model rejects our optional parameters
    (JSON mode / reasoning_effort) with HTTP 400, remember that for a day and
    call it in plain mode instead of giving up on the model.
    """
    import groq
    compat_key = f"rl:compat:{model}"
    plain = bool(redis_conn.get(compat_key))
    call_params = dict(params)
    if not plain:
        if json_mode:
            call_params["response_format"] = {"type": "json_object"}
        extra = _extra_params(model)
        if extra:
            call_params["extra_body"] = extra
    try:
        return get_client().chat.completions.create(**call_params)
    except groq.APIStatusError as e:
        text = str(e)
        if (e.status_code == 400 and not plain and "json_validate_failed" not in text
                and ("response_format" in text or "reasoning" in text or "not supported" in text.lower()
                     or "unsupported" in text.lower() or "invalid" in text.lower())):
            print(f"[ai] {model} rejected optional params, switching to plain mode: {text[:160]}")
            redis_conn.setex(compat_key, 86400, "1")
            raise _Transient(text)
        raise


def _chat_json(model: str, system: str, user: str, max_tokens: int):
    params = dict(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.2,
        max_tokens=max_tokens,
    )
    resp = _create_chat(model, params, json_mode=True)
    content = resp.choices[0].message.content
    if not content or not content.strip():
        raise _Transient(f"Empty response (finish_reason={resp.choices[0].finish_reason})")
    used = getattr(resp.usage, "total_tokens", None) if resp.usage else None
    return _extract_json(content), used


JSON_SYSTEM = (
    "You are an English speaking examiner. Reply with ONE valid JSON object only - "
    "no markdown, no text outside the JSON. Address the student directly as 'you'. "
    "Keep each feedback field to 2-4 sentences."
)


def _grade_with_schema(prompt: str, schema, *, deadline, on_wait, models=None, max_tokens=1600):
    """Ask a model for JSON, validate it against the pydantic schema."""
    models = models or GRADE_MODELS

    def call(model):
        data, used = _chat_json(model, JSON_SYSTEM, prompt, max_tokens)
        try:
            return schema(**data).model_dump(), used
        except ValidationError as e:
            raise _Transient(f"Output did not match schema: {e.errors()[:2]}")

    return run_with_fallback(
        "grade", models, call,
        deadline=deadline, on_wait=on_wait,
        est_tokens=_estimate_tokens(JSON_SYSTEM + prompt, 700),
    )


def _clamp(value, low, high):
    try:
        return int(max(low, min(high, round(float(value)))))
    except (TypeError, ValueError):
        return low


# --- Schemas (validated + clamped) ---------------------------------------------------

Score100 = Annotated[int, BeforeValidator(lambda v: _clamp(v, 0, 100))]
Score10 = Annotated[int, BeforeValidator(lambda v: _clamp(v, 1, 10))]
Text = Annotated[str, BeforeValidator(lambda v: v if isinstance(v, str) else json.dumps(v))]


class ReadAloudEvaluation(BaseModel):
    accuracy_score: Score100
    word_error_rate: float
    skipped_words: List[str]
    mispronounced_words: List[str]
    feedback: Text


class QAEvaluation(BaseModel):
    fluency: Score100
    lexical_resource: Score100
    grammatical_range: Score100
    pronunciation: Score100
    feedback: Text


class ConversationEvaluation(BaseModel):
    fluency_and_coherence: Score100
    lexical_resource: Score100
    grammatical_range: Score100
    pronunciation: Score100
    interactive_communication: Score100
    feedback: Text


class DebateEvaluation(BaseModel):
    matter_score: Score10
    manner_score: Score10
    method_score: Score10
    matter_feedback: Text
    manner_feedback: Text
    method_feedback: Text
    overall_feedback: Text


class _FeedbackOnly(BaseModel):
    feedback: Text


# --- Transcription ----------------------------------------------------------------------

def transcribe_file(file_path: str, filename: str, duration_seconds: Optional[float] = None,
                    *, deadline: Optional[float] = None, on_wait=None) -> str:
    with open(file_path, "rb") as f:
        audio_bytes = f.read()
    if duration_seconds and duration_seconds > 0:
        audio_seconds = duration_seconds
    else:
        audio_seconds = len(audio_bytes) / 12000  # rough opus/aac bitrate estimate
    audio_seconds = max(10, int(audio_seconds) + 1)  # Groq bills a 10s minimum

    def call(model):
        resp = get_client().audio.transcriptions.create(
            file=(filename, audio_bytes),
            model=model,
            language="en",
            response_format="json",
        )
        return (resp.text or "").strip(), 0

    return run_with_fallback(
        "transcribe", TRANSCRIBE_MODELS, call,
        deadline=deadline or time.time() + 1800,
        audio_seconds=audio_seconds, on_wait=on_wait,
    )


# --- Chat tutor ---------------------------------------------------------------------------

CHAT_SYSTEM = (
    "You are an encouraging, friendly native English conversation partner helping a student "
    "practise speaking. Reply naturally in 1-3 short sentences and always end with an easy, "
    "engaging follow-up question about the topic. Plain text only."
)


def get_chat_reply(messages: List[dict], max_wait_seconds: float = 25) -> str:
    formatted = [{"role": "system", "content": CHAT_SYSTEM}]
    for msg in messages[-16:]:  # recent turns are enough and keep tokens low
        role = "assistant" if msg.get("role") == "assistant" else "user"
        formatted.append({"role": role, "content": str(msg.get("content", ""))[:2000]})
    prompt_text = "".join(m["content"] for m in formatted)

    def call(model):
        params = dict(model=model, messages=formatted, temperature=0.7, max_tokens=500)
        resp = _create_chat(model, params, json_mode=False)
        reply = _strip_reasoning(resp.choices[0].message.content or "")
        if not reply:
            raise _Transient("Empty chat reply")
        used = getattr(resp.usage, "total_tokens", None) if resp.usage else None
        return reply, used

    return run_with_fallback(
        "chat", CHAT_MODELS, call,
        deadline=time.time() + max_wait_seconds,
        est_tokens=_estimate_tokens(prompt_text, 250), max_transient=3,
    )


# --- Read Aloud (computed locally) ---------------------------------------------------------

def _words(text: str) -> List[str]:
    text = (text or "").lower().replace("’", "'")
    text = re.sub(r"[^a-z0-9'\s-]", " ", text)
    text = text.replace("'", "").replace("-", " ")
    return text.split()


def compare_read_aloud(source_text: str, transcript: str) -> dict:
    src, hyp = _words(source_text), _words(transcript)
    matcher = difflib.SequenceMatcher(a=src, b=hyp, autojunk=False)
    skipped, substituted = [], []
    subs = dels = ins = correct = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            correct += i2 - i1
        elif tag == "delete":
            dels += i2 - i1
            skipped += src[i1:i2]
        elif tag == "insert":
            ins += j2 - j1
        elif tag == "replace":
            n_src, n_hyp = i2 - i1, j2 - j1
            subs += min(n_src, n_hyp)
            substituted += src[i1:i1 + min(n_src, n_hyp)]
            if n_src > n_hyp:
                dels += n_src - n_hyp
                skipped += src[i1 + n_hyp:i2]
            else:
                ins += n_hyp - n_src
    n = max(1, len(src))
    wer = round((subs + dels + ins) / n, 3)
    accuracy = _clamp(100 * correct / n, 0, 100)
    return {
        "accuracy_score": accuracy,
        "word_error_rate": wer,
        "skipped_words": skipped[:30],
        "mispronounced_words": substituted[:30],
        "_counts": {"words": len(src), "correct": correct, "substituted": subs,
                    "skipped": dels, "extra": ins},
    }


def _template_read_aloud_feedback(m: dict) -> str:
    acc = m["accuracy_score"]
    if acc >= 90:
        opening = f"Excellent reading! You read {acc}% of the words correctly."
    elif acc >= 70:
        opening = f"Good effort - you read {acc}% of the words correctly."
    else:
        opening = f"You read {acc}% of the words correctly, so keep practising this passage."
    parts = [opening]
    if m["skipped_words"]:
        parts.append("You skipped: " + ", ".join(m["skipped_words"][:8]) + ".")
    if m["mispronounced_words"]:
        parts.append("Practise these words, which did not come out clearly: "
                     + ", ".join(m["mispronounced_words"][:8]) + ".")
    parts.append("Read slowly and clearly, and use 'Hear Sample' to compare your pronunciation.")
    return " ".join(parts)


def evaluate_read_aloud(source_text: str, student_transcript: str, *, deadline=None, on_wait=None) -> dict:
    metrics = compare_read_aloud(source_text, student_transcript)
    counts = metrics.pop("_counts")
    prompt = (
        "A student read a passage aloud. Speech recognition compared their reading to the text.\n"
        f"Text: \"{source_text}\"\n"
        f"What the student said: \"{student_transcript}\"\n"
        f"Accuracy: {metrics['accuracy_score']}%. Words: {counts['words']}, skipped: {counts['skipped']}, "
        f"substituted: {counts['substituted']}, extra: {counts['extra']}.\n"
        f"Skipped words: {metrics['skipped_words'][:15]}. Unclear/substituted words: {metrics['mispronounced_words'][:15]}.\n"
        "Write short, encouraging, actionable feedback (3-4 sentences) on accuracy and pronunciation.\n"
        'Return JSON: {"feedback": string}'
    )
    try:
        out = _grade_with_schema(
            prompt, _FeedbackOnly, models=FEEDBACK_MODELS, max_tokens=700,
            deadline=deadline or time.time() + 600, on_wait=on_wait,
        )
        metrics["feedback"] = out["feedback"]
    except (AIBusyError, AITransientError) as e:
        # Never fail a read-aloud: the scores are exact, only the prose is templated.
        print(f"[read_aloud] AI feedback unavailable, using template: {e}")
        metrics["feedback"] = _template_read_aloud_feedback(metrics)
    return ReadAloudEvaluation(**metrics).model_dump()


# --- Q&A / Conversation / Debate ----------------------------------------------------------

def evaluate_qa(question: str, student_transcript: str, *, deadline=None, on_wait=None) -> dict:
    prompt = (
        "Act as an IELTS Speaking examiner.\n"
        f"Question: \"{question}\"\n"
        f"Candidate's answer (speech transcript): \"{student_transcript}\"\n"
        "Score each criterion from 0 to 100 and give feedback with strengths, weaknesses and how to score higher.\n"
        'Return JSON: {"fluency": int, "lexical_resource": int, "grammatical_range": int, '
        '"pronunciation": int, "feedback": string}'
    )
    return _grade_with_schema(prompt, QAEvaluation, deadline=deadline or time.time() + 1800, on_wait=on_wait)


def evaluate_conversation(messages: List[dict], *, deadline=None, on_wait=None) -> dict:
    lines = []
    for msg in messages:
        who = "Student" if msg.get("role") == "user" else "Tutor"
        lines.append(f"{who}: {msg.get('content', '')}")
    prompt = (
        "Act as an IELTS Speaking examiner. Grade only the Student in this conversation with an AI tutor:\n\n"
        + "\n".join(lines) + "\n\n"
        "Score 0-100 each: fluency_and_coherence, lexical_resource, grammatical_range, pronunciation "
        "(it is a transcript, so judge from fluency cues and assume a fair baseline if there are no clear errors), "
        "interactive_communication (responding to the tutor and keeping the conversation going). "
        "Give feedback on conversational ability and grammar.\n"
        'Return JSON: {"fluency_and_coherence": int, "lexical_resource": int, "grammatical_range": int, '
        '"pronunciation": int, "interactive_communication": int, "feedback": string}'
    )
    return _grade_with_schema(prompt, ConversationEvaluation, deadline=deadline or time.time() + 1800, on_wait=on_wait)


def evaluate_debate(motion: str, role: str, student_transcript: str, *, deadline=None, on_wait=None) -> dict:
    prompt = (
        "Act as a strict, professional debate adjudicator. Do NOT be generous; penalise missing structure, "
        "shallow analysis and filler words.\n"
        f"Motion: \"{motion}\"\nRole: \"{role}\"\n"
        f"Speech transcript: \"{student_transcript}\"\n\n"
        "Rubric (each 1-10):\n"
        "Matter (substance): 8-10 clear AEL/AREEI structure, answers the core of the motion, relevant evidence, deep impact; "
        "5-7 clear but shallow or jumpy, generic evidence; 1-4 bare claims, irrelevant.\n"
        "Manner (delivery): 8-10 very clear, varied vocabulary, almost no grammar errors or fillers; "
        "5-7 fluent but flat, some basic errors and fillers; 1-4 many pauses/fillers, hard to follow.\n"
        "Method (structure): 8-10 systematic intro-points-conclusion, efficient time use; "
        "5-7 structure present but rough transitions; 1-4 unstructured, no signposting.\n"
        "Give critical, specific feedback for each.\n"
        'Return JSON: {"matter_score": int, "manner_score": int, "method_score": int, '
        '"matter_feedback": string, "manner_feedback": string, "method_feedback": string, "overall_feedback": string}'
    )
    return _grade_with_schema(prompt, DebateEvaluation, deadline=deadline or time.time() + 1800,
                              on_wait=on_wait, max_tokens=2000)


# --- Backwards-compatible entry points (old /transcribe and /grade endpoints) -------------

def transcribe_audio_from_file(file_path: str, filename: str) -> str:
    try:
        return transcribe_file(file_path, filename)
    finally:
        try:
            os.unlink(file_path)
        except OSError:
            pass
