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
import random
import os
import re
import time
from typing import Annotated, Callable, List, Optional

import redis
from dotenv import load_dotenv
from pydantic import BaseModel, BeforeValidator, ValidationError

load_dotenv()

from utils.ratelimit import RateLimiter, cap_output  # noqa: E402

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


class AIDailyLimitError(AIBusyError):
    """Every model has used up today's free quota. Retry after the reset."""

    def __init__(self, msg, retry_after=0):
        super().__init__(msg)
        self.retry_after = retry_after


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


class _TooLarge(Exception):
    """This request can never fit this model's per-request limits; use another model."""


class _Transient(Exception):
    """Network error, 5xx, timeout, or invalid JSON from the model."""


# --- Groq client ----------------------------------------------------------------

_client = None

# Patient jobs (student submissions) wait at most this long in total as a safety net.
PATIENT_MAX_WAIT = int(os.getenv("PATIENT_MAX_WAIT_SECONDS", str(6 * 3600)))
DAILY_WINDOWS = {"rpd", "tpd", "asd"}


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
    if isinstance(exc, groq.RateLimitError) and "request too large" in text.lower():
        return _TooLarge(text)  # not a 'wait and retry' 429: it will never fit
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
    deadline: Optional[float],
    est_tokens: int = 0,
    audio_seconds: int = 0,
    on_wait: Optional[Callable[[float], None]] = None,
    max_transient: int = 6,
    max_output: int = 0,
):
    """
    Try `call(model)` on the first model that has free capacity.
    `call` must return (result, tokens_used).

    deadline: a time.time() timestamp to give up at (AIBusyError), or None to be
    *patient*: keep waiting through per-minute and per-hour limits (keeping the
    student's place in line) and only stop when every model has used up its
    DAILY quota (AIDailyLimitError) or after PATIENT_MAX_WAIT as a safety net.
    """
    patient = deadline is None
    if patient:
        deadline = time.time() + PATIENT_MAX_WAIT
        max_transient = max(max_transient, 10)
    transient_errors = 0
    last_error = None
    skip = set()  # models that can never serve this particular request
    while True:
        waits = []
        daily_blocked = {}  # model -> seconds until its daily quota resets
        usable = [m for m in models if m not in skip]
        if not usable:
            raise AITransientError(f"No {kind} model can serve this request. Last error: {last_error}")
        for model in usable:
            cool = limiter.cooldown_remaining(model)
            if cool > 0:
                waits.append(cool)
                if limiter.cooldown_reason(model).startswith("daily"):
                    daily_blocked[model] = cool
                continue
            ok, wait, window = limiter.try_acquire_ex(
                model, tokens=est_tokens, audio_seconds=audio_seconds,
                output_tokens=cap_output(model, max_output) if max_output else 0)
            if not ok:
                waits.append(wait)
                if window in DAILY_WINDOWS:
                    daily_blocked[model] = wait
                continue
            try:
                result, used = call(model)
                limiter.adjust_tokens(model, est_tokens, used or est_tokens)
                return result
            except Exception as raw:  # noqa: BLE001
                err = raw if isinstance(raw, (_RateLimited, _ModelUnusable, _Transient, _TooLarge, BadAudioError)) else _classify(raw, kind)
                last_error = err
                if isinstance(err, BadAudioError):
                    raise err
                if isinstance(err, _TooLarge):
                    limiter.adjust_tokens(model, est_tokens, 0)
                    skip.add(model)
                    print(f"[{kind}] {model} cannot take this request size, using other models: {str(err)[:160]}")
                    continue
                if isinstance(err, _RateLimited):
                    # Groq refused: the reserved tokens were not used.
                    limiter.adjust_tokens(model, est_tokens, 0)
                    limiter.cooldown(model, err.retry_after, "daily quota" if err.daily else "429")
                    waits.append(err.retry_after)
                    if err.daily:
                        daily_blocked[model] = err.retry_after
                elif isinstance(err, _ModelUnusable):
                    limiter.cooldown(model, 600, f"unusable: {str(err)[:120]}")
                else:
                    transient_errors += 1
                    print(f"[{kind}] transient error on {model} ({transient_errors}/{max_transient}): {str(err)[:200]}")
                    if transient_errors >= max_transient:
                        raise AITransientError(str(err)) from raw
                    waits.append(min(2 ** transient_errors, 20))
        usable = [m for m in models if m not in skip]
        if usable and all(m in daily_blocked for m in usable):
            reset_in = min(daily_blocked.values())
            raise AIDailyLimitError(f"All {kind} models used up today's quota (resets in ~{int(reset_in)}s)",
                                    retry_after=reset_in)
        now = time.time()
        if now >= deadline:
            raise AIBusyError(f"All {kind} models busy until deadline. Last error: {last_error}")
        next_free = min(waits) if waits else 5.0
        sleep_for = max(1.0, min(next_free, 20.0, deadline - now))
        if on_wait:
            try:
                on_wait(next_free)  # how long until some model frees up (for the student's ETA)
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
    if model.startswith("qwen/"):
        return {"reasoning_effort": "none"}  # no hidden thinking: saves scarce output tokens
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
        max_tokens=cap_output(model, max_tokens),
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
        max_output=max_tokens,
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
    feedback_source: str = "ai"   # "ai" or "standard" (template, used when the AI queue is busy)


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


# Mattering drill: one speaker score on the debate speaker scale (75 = average).
SPEAKER_MIN, SPEAKER_MAX = 69, 81
SpeakerScore = Annotated[int, BeforeValidator(lambda v: _clamp(v, SPEAKER_MIN, SPEAKER_MAX))]
MATTERING_BANDS = [
    (70, "No real contribution"),
    (72, "Minimal contribution"),
    (74, "Below average"),
    (75, "Average"),
    (77, "Slightly above average"),
    (79, "Strong"),
    (80, "Superior"),
    (81, "Exceptional"),
]


def mattering_band(score) -> str:
    for top, label in MATTERING_BANDS:
        if score <= top:
            return label
    return MATTERING_BANDS[-1][1]


class MatteringEvaluation(BaseModel):
    speaker_score: SpeakerScore
    argument_feedback: Text
    rebuttal_feedback: Text = ""
    knowledge_gaps: Text
    overall_feedback: Text


class _FeedbackOnly(BaseModel):
    feedback: Text


# --- Transcription ----------------------------------------------------------------------

# Switch to the on-server backup transcriber when Groq would make the student wait
# longer than this (or is out of its daily allowance / keeps failing).
LOCAL_ASR_SWITCH_AFTER = int(os.getenv("LOCAL_ASR_SWITCH_AFTER_SECONDS", "90"))


def transcribe_file(file_path: str, filename: str, duration_seconds: Optional[float] = None,
                    *, deadline: Optional[float] = None, on_wait=None, info: Optional[dict] = None,
                    on_backup=None) -> str:
    """
    Transcribe with Groq Whisper; fall back to the server's own Whisper copy when
    Groq is out of quota, keeps failing, or is too busy. `info["transcriber"]`
    records which one was used.
    """
    from utils import local_asr
    info = info if info is not None else {}
    if not local_asr.available():
        return _transcribe_groq(file_path, filename, duration_seconds, deadline=deadline,
                                on_wait=on_wait, info=info)

    groq_deadline = time.time() + LOCAL_ASR_SWITCH_AFTER
    if deadline is not None:
        groq_deadline = min(groq_deadline, deadline)
    try:
        return _transcribe_groq(file_path, filename, duration_seconds, deadline=groq_deadline,
                                on_wait=on_wait, info=info)
    except BadAudioError:
        raise
    except (AIBusyError, AITransientError) as groq_error:
        daily = isinstance(groq_error, AIDailyLimitError)
        print(f"[transcribe] using backup transcriber ({'daily limit' if daily else 'Groq busy/failing'}): "
              f"{str(groq_error)[:120]}")
        if on_backup:
            try:
                on_backup()
            except Exception:
                pass
        try:
            text = local_asr.transcribe(file_path, redis_conn, on_wait=on_backup)
            info["transcriber"] = f"server:{local_asr.MODEL_NAME}"
            return text
        except Exception as local_error:
            print(f"[transcribe] backup transcriber failed: {local_error}")
            if daily or deadline is not None:
                raise groq_error
            # Last resort: keep waiting patiently for Groq.
            return _transcribe_groq(file_path, filename, duration_seconds, deadline=None,
                                    on_wait=on_wait, info=info)


def _transcribe_groq(file_path: str, filename: str, duration_seconds: Optional[float] = None,
                     *, deadline: Optional[float] = None, on_wait=None, info: Optional[dict] = None) -> str:
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
        if info is not None:
            info["transcriber"] = f"groq:{model}"
        return (resp.text or "").strip(), 0

    return run_with_fallback(
        "transcribe", TRANSCRIBE_MODELS, call,
        deadline=deadline,
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
        params = dict(model=model, messages=formatted, temperature=0.7, max_tokens=cap_output(model, 500))
        resp = _create_chat(model, params, json_mode=False)
        reply = _strip_reasoning(resp.choices[0].message.content or "")
        if not reply:
            raise _Transient("Empty chat reply")
        used = getattr(resp.usage, "total_tokens", None) if resp.usage else None
        return reply, used

    return run_with_fallback(
        "chat", CHAT_MODELS, call,
        deadline=time.time() + max_wait_seconds,
        est_tokens=_estimate_tokens(prompt_text, 250), max_transient=3, max_output=500,
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
    skipped, substituted, extra = [], [], []
    subs = dels = ins = correct = 0
    opcodes = matcher.get_opcodes()
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            correct += i2 - i1
        elif tag == "delete":
            dels += i2 - i1
            skipped += src[i1:i2]
        elif tag == "insert":
            ins += j2 - j1
            extra += hyp[j1:j2]
        elif tag == "replace":
            n_src, n_hyp = i2 - i1, j2 - j1
            subs += min(n_src, n_hyp)
            substituted += src[i1:i1 + min(n_src, n_hyp)]
            if n_src > n_hyp:
                dels += n_src - n_hyp
                skipped += src[i1 + n_hyp:i2]
            else:
                ins += n_hyp - n_src
                extra += hyp[j1 + n_src:j2]
    # Words missing at the very end usually mean the student stopped early.
    stopped_early = 0
    if opcodes and opcodes[-1][0] == "delete" and opcodes[-1][2] == len(src):
        stopped_early = opcodes[-1][2] - opcodes[-1][1]
    n = max(1, len(src))
    wer = round((subs + dels + ins) / n, 3)
    accuracy = _clamp(100 * correct / n, 0, 100)
    return {
        "accuracy_score": accuracy,
        "word_error_rate": wer,
        "skipped_words": skipped[:30],
        "mispronounced_words": substituted[:30],
        "_counts": {"words": len(src), "correct": correct, "substituted": subs,
                    "skipped": dels, "extra": ins, "stopped_early": stopped_early,
                    "extra_words": extra[:10]},
    }


def _unique(words):
    seen, out = set(), []
    for w in words:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def _fmt_words(words, limit=6):
    words = _unique(words)
    shown = ", ".join(f'"{w}"' for w in words[:limit])
    return shown + (f" and {len(words) - limit} more" if len(words) > limit else "")


def _template_read_aloud_feedback(m: dict, counts: dict) -> str:
    """Standard feedback built from the exact comparison. Used when the AI is busy."""
    acc = m["accuracy_score"]
    total = max(1, counts["words"])
    skipped, unclear = m["skipped_words"], m["mispronounced_words"]
    stopped = counts.get("stopped_early", 0)
    n_extra = counts.get("extra", 0)

    if acc >= 95:
        opening = random.choice([
            f"Excellent reading! You read {acc}% of the words correctly.",
            f"Outstanding - {acc}% of the words were read correctly.",
            f"Great job! You read almost everything correctly ({acc}%).",
        ])
    elif acc >= 85:
        opening = random.choice([
            f"Very good reading - you got {acc}% of the words right.",
            f"Well done! {acc}% of the words were read correctly, with only a few slips.",
        ])
    elif acc >= 70:
        opening = random.choice([
            f"Good effort - you read {acc}% of the words correctly.",
            f"You are getting there: {acc}% of the words were correct.",
        ])
    elif acc >= 50:
        opening = f"You read {acc}% of the words correctly. With some practice this will improve quickly."
    else:
        opening = f"You read {acc}% of the words correctly, so this passage needs more practice."
    parts = [opening]

    # Specific findings, most important first
    main_issue = None
    if stopped >= max(3, total * 0.2):
        parts.append(f"You stopped before the end - the last {stopped} words were not heard. "
                     "Read the whole passage before you release the button.")
        main_issue = "stopped"
    if skipped and main_issue != "stopped":
        parts.append(f"Words you skipped: {_fmt_words(skipped)}.")
        main_issue = main_issue or ("skipped" if len(skipped) >= 3 else None)
    if unclear:
        parts.append(f"Words that did not come out clearly: {_fmt_words(unclear)}. "
                     "Listen with 'Hear Sample' and practise each word on its own.")
        main_issue = main_issue or ("unclear" if len(unclear) >= 3 else None)
    if n_extra >= 3:
        parts.append("You also added some words that are not in the text (repeats or fillers like 'um'). "
                     "If you make a mistake, just keep reading.")
        main_issue = main_issue or "extra"

    # One focused tip
    if acc >= 95 and not skipped and not unclear:
        parts.append("Next challenge: read with natural rhythm and expression, or try a harder passage.")
    elif main_issue == "skipped":
        parts.append("Tip: read a little slower and follow each word with your finger so nothing is missed.")
    elif main_issue is None:
        parts.append("Tip: read slowly and clearly, then try the passage again to beat your score.")

    # Short Indonesian hint for students who are struggling
    if acc < 70:
        hint = {
            "stopped": "Pastikan kamu membaca seluruh teks sampai selesai sebelum melepas tombol rekam.",
            "skipped": "Baca lebih pelan dan ikuti setiap kata dengan jari agar tidak ada kata yang terlewat.",
            "unclear": "Tekan 'Hear Sample' untuk mendengarkan contoh, lalu ulangi kata-kata yang sulit satu per satu.",
            "extra": "Usahakan tidak mengulang kata atau menambahkan 'um/eh'; jika salah, lanjutkan saja membaca.",
        }.get(main_issue, "Latih teks ini beberapa kali lagi dengan tempo pelan dan jelas.")
        parts.append(f"(Tips: {hint})")
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
        f"Skipped words: {metrics['skipped_words'][:15]}. Unclear/substituted words: {metrics['mispronounced_words'][:15]}. "
        f"Extra words said: {counts['extra_words']}. Words missing at the end: {counts['stopped_early']}.\n"
        "Write short, encouraging, actionable feedback (3-4 sentences) on accuracy and pronunciation.\n"
        'Return JSON: {"feedback": string}'
    )
    try:
        out = _grade_with_schema(
            prompt, _FeedbackOnly, models=FEEDBACK_MODELS, max_tokens=700,
            deadline=deadline or time.time() + 600, on_wait=on_wait,
        )
        metrics["feedback"] = out["feedback"]
        metrics["feedback_source"] = "ai"
    except (AIBusyError, AITransientError) as e:
        # Never fail or delay a read-aloud: the scores are exact, only the prose is standard.
        print(f"[read_aloud] AI feedback unavailable, using standard feedback: {str(e)[:120]}")
        metrics["feedback"] = _template_read_aloud_feedback(metrics, counts)
        metrics["feedback_source"] = "standard"
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
    return _grade_with_schema(prompt, QAEvaluation, deadline=deadline, on_wait=on_wait)


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
    return _grade_with_schema(prompt, ConversationEvaluation, deadline=deadline, on_wait=on_wait)


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
    return _grade_with_schema(prompt, DebateEvaluation, deadline=deadline,
                              on_wait=on_wait, max_tokens=2000)


# --- Mattering drill (issue breakdown -> one argument -> rebuttal) ---------------------------

OPPOSITION_SYSTEM = (
    "You are a sparring partner in a school debate training drill. You speak for the side OPPOSITE to the "
    "student. Give ONE clear counter-argument that directly attacks the student's argument: say which part "
    "you are answering, why it is wrong or not enough, and what follows. Use simple English, 3-4 sentences, "
    "plain text only, no headings or lists. Do not praise or coach the student."
)


def get_mattering_opposition(motion: str, role: str, argument: str, max_wait_seconds: float = 25) -> str:
    """The opposing argument the student has to rebut in the second round."""
    user = (
        f"Motion: \"{str(motion)[:500]}\"\n"
        f"The student speaks for the {role} side. You speak for the other side.\n"
        f"The student's argument (speech transcript): \"{str(argument)[:4000]}\""
    )
    formatted = [{"role": "system", "content": OPPOSITION_SYSTEM}, {"role": "user", "content": user}]

    def call(model):
        params = dict(model=model, messages=formatted, temperature=0.6, max_tokens=cap_output(model, 400))
        resp = _create_chat(model, params, json_mode=False)
        reply = _strip_reasoning(resp.choices[0].message.content or "")
        if not reply:
            raise _Transient("Empty opposing argument")
        used = getattr(resp.usage, "total_tokens", None) if resp.usage else None
        return reply, used

    return run_with_fallback(
        "chat", CHAT_MODELS, call,
        deadline=time.time() + max_wait_seconds,
        est_tokens=_estimate_tokens(OPPOSITION_SYSTEM + user, 200), max_transient=3, max_output=400,
    )


def evaluate_mattering(motion: str, role: str, notes: str, argument: str, opposition: str = "",
                       rebuttal: str = "", *, deadline=None, on_wait=None) -> dict:
    notes = (notes or "").strip()
    opposition = (opposition or "").strip()
    rebuttal = (rebuttal or "").strip()
    if opposition and rebuttal:
        round_two = (f"Opposing argument the student was asked to answer: \"{opposition}\"\n"
                     f"Student's rebuttal (speech transcript): \"{rebuttal}\"\n")
    elif opposition:
        round_two = (f"Opposing argument the student was asked to answer: \"{opposition}\"\n"
                     "The student chose NOT to give a rebuttal, so there is no engagement to credit.\n")
    else:
        round_two = "There was no rebuttal round; judge the argument alone.\n"
    prompt = (
        "Act as an experienced school debate adjudicator marking a training drill. The student analysed an "
        "issue, then delivered ONE argument, then answered an opposing argument.\n"
        f"Motion: \"{motion}\"\nStudent's side: \"{role}\"\n"
        f"Student's written issue breakdown (context only, do NOT score it): \"{notes or 'none'}\"\n"
        f"Student's argument (speech transcript): \"{argument}\"\n"
        + round_two +
        "\nGive ONE speaker score using this scale exactly (whole numbers 69-81):\n"
        "69-70: just stands and says hello; no contribution, no attempt to respond or engage; no points, or "
        "points very irrelevant to the debate.\n"
        "71-72: slightly better; a minimal contribution; points not relevant, many unexplained logical gaps; "
        "unstructured and hard to understand; attempts to respond are weak and hard to follow.\n"
        "73-74: below average; fairly relevant contribution but still visible logic gaps; the speech can be "
        "understood and the role is acceptably fulfilled; engagement and response are weak and less effective.\n"
        "75: average; fulfils the role quite well; only minor logical gaps; structure clear and easy to follow; "
        "explanations quite clear and complete; engagement sufficient.\n"
        "76-77: slightly above average; fulfils the role well; uses relevant analysis, rebuttals and examples; "
        "persuasive and well delivered.\n"
        "78-79: brings relevant arguments and contributes well; easy-to-understand delivery; arguments and "
        "rebuttals reinforced with relevant context or examples; uses strategies such as framing, "
        "contextualisation or pushing a burden of proof onto the opposing team.\n"
        "80: superior; often unorthodox responses or arguments that are very significant in the debate; hard "
        "to find faults.\n"
        "81: an amazing performance you will never forget.\n"
        "75 is a competent, ordinary speech. Do not cluster every speech at 75: match the descriptors honestly, "
        "go below 73 for thin or irrelevant speeches and above 77 only when the descriptors are clearly met. "
        "It is a transcript, so ignore accent and small transcription errors.\n"
        "argument_feedback: the claim, reasoning, evidence and link back to the motion - what is missing. "
        "rebuttal_feedback: how well the opposing argument was answered (empty string if there was no rebuttal). "
        "knowledge_gaps: stakeholders, facts, examples or principles about this issue the student did not use "
        "and should read up on. overall_feedback: why this score, and the one thing to fix next time.\n"
        'Return JSON: {"speaker_score": int, "argument_feedback": string, "rebuttal_feedback": string, '
        '"knowledge_gaps": string, "overall_feedback": string}'
    )
    result = _grade_with_schema(prompt, MatteringEvaluation, deadline=deadline,
                                on_wait=on_wait, max_tokens=2000)
    if not rebuttal:
        result["rebuttal_feedback"] = ""
    result["band"] = mattering_band(result["speaker_score"])
    return result


# --- Backwards-compatible entry points (old /transcribe and /grade endpoints) -------------

def transcribe_audio_from_file(file_path: str, filename: str) -> str:
    try:
        return transcribe_file(file_path, filename)
    finally:
        try:
            os.unlink(file_path)
        except OSError:
            pass
