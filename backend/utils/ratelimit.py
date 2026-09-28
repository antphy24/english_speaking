"""
Shared (Redis-backed) rate limiter for Groq models.

Every worker process asks this limiter for a slot *before* calling Groq, so the
workers queue up politely instead of all hitting Groq at once, getting HTTP 429,
and failing the student's job.

Limits default to Groq's FREE plan (see https://console.groq.com/docs/rate-limits).
Each model has its own separate quota, which is why we rotate between several
models: three free chat models give roughly 3x the free grading capacity.

To change limits (e.g. after upgrading your Groq plan) set GROQ_LIMITS_JSON, e.g.
  GROQ_LIMITS_JSON='{"openai/gpt-oss-120b": {"rpm": 1000, "tpm": 250000}}'
"""
import json
import os
import time

# --- Free-plan limits per model -------------------------------------------------
# rpm/rpd = requests per minute/day, tpm/tpd = tokens per minute/day,
# ash/asd = audio seconds per hour/day (Whisper only).
_CHAT_FREE = {"rpm": 30, "rpd": 1000, "tpm": 8000, "tpd": 200000}
_WHISPER_FREE = {"rpm": 20, "rpd": 2000, "ash": 7200, "asd": 28800}

DEFAULT_LIMITS = {
    "openai/gpt-oss-120b": dict(_CHAT_FREE),
    "openai/gpt-oss-20b": dict(_CHAT_FREE),
    "qwen/qwen3.8-27b": dict(_CHAT_FREE),
    "whisper-large-v3": dict(_WHISPER_FREE),
    "whisper-large-v3-turbo": dict(_WHISPER_FREE),
}

# Stay a little under the published limits: Groq uses rolling windows while we
# count per calendar minute/hour/day, so a safety margin avoids most 429s.
SAFETY = float(os.getenv("GROQ_LIMIT_SAFETY", "0.85"))


def _load_limits():
    limits = {k: dict(v) for k, v in DEFAULT_LIMITS.items()}
    raw = os.getenv("GROQ_LIMITS_JSON")
    if raw:
        try:
            for model, override in json.loads(raw).items():
                limits.setdefault(model, {}).update(override)
        except Exception as e:  # never crash on a bad env var
            print(f"[ratelimit] Ignoring invalid GROQ_LIMITS_JSON: {e}")
    return limits


LIMITS = _load_limits()

# Window name -> (seconds per window, TTL for the counter key)
_WINDOWS = {
    "rpm": (60, 130), "tpm": (60, 130),
    "ash": (3600, 3700),
    "rpd": (86400, 90000), "tpd": (86400, 90000), "asd": (86400, 90000),
}

# Atomically: check every counter would stay within its limit; if so, add all
# amounts. Returns 0 on success, otherwise the 1-based index of the first
# counter that would overflow.
_ACQUIRE_LUA = """
for i = 1, #KEYS do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  local amount = tonumber(ARGV[(i - 1) * 3 + 1])
  local limit = tonumber(ARGV[(i - 1) * 3 + 2])
  if amount > 0 and current + amount > limit then
    return i
  end
end
for i = 1, #KEYS do
  local amount = tonumber(ARGV[(i - 1) * 3 + 1])
  if amount > 0 then
    redis.call('INCRBY', KEYS[i], amount)
    redis.call('EXPIRE', KEYS[i], tonumber(ARGV[(i - 1) * 3 + 3]))
  end
end
return 0
"""


class RateLimiter:
    def __init__(self, redis_conn):
        self.r = redis_conn
        self._acquire = redis_conn.register_script(_ACQUIRE_LUA)

    # ---- helpers ------------------------------------------------------------
    @staticmethod
    def _bucket(window, now):
        size = _WINDOWS[window][0]
        return int(now // size)

    def _key(self, model, window, now):
        return f"rl:{model}:{window}:{self._bucket(window, now)}"

    @staticmethod
    def _seconds_until_next(window, now):
        size = _WINDOWS[window][0]
        return max(1.0, size - (now % size))

    # ---- public API ---------------------------------------------------------
    def try_acquire(self, model, tokens=0, audio_seconds=0):
        """Reserve capacity for one call. Returns (ok, seconds_to_wait)."""
        limits = LIMITS.get(model, {})
        now = time.time()
        wanted = {
            "rpm": 1, "rpd": 1,
            "tpm": int(tokens), "tpd": int(tokens),
            "ash": int(audio_seconds), "asd": int(audio_seconds),
        }
        keys, args, windows = [], [], []
        for window, amount in wanted.items():
            if window not in limits or amount <= 0:
                continue
            limit = max(1, int(limits[window] * SAFETY))
            # A single request bigger than the whole window must still be allowed
            # through eventually, otherwise it would wait forever.
            amount = min(amount, limit)
            keys.append(self._key(model, window, now))
            args += [amount, limit, _WINDOWS[window][1]]
            windows.append(window)
        if not keys:
            return True, 0
        blocked = int(self._acquire(keys=keys, args=args))
        if blocked == 0:
            return True, 0
        return False, self._seconds_until_next(windows[blocked - 1], now)

    def adjust_tokens(self, model, reserved, actual):
        """After a call, replace the token estimate with the real usage."""
        if "tpm" not in LIMITS.get(model, {}):
            return
        delta = int(actual) - int(reserved)
        if delta == 0:
            return
        now = time.time()
        pipe = self.r.pipeline()
        for window in ("tpm", "tpd"):
            key = self._key(model, window, now)
            pipe.incrby(key, delta)
            pipe.expire(key, _WINDOWS[window][1])
        pipe.execute()

    def cooldown(self, model, seconds, reason=""):
        seconds = int(max(1, min(seconds, 6 * 3600)))
        self.r.setex(f"rl:cooldown:{model}", seconds, reason or "rate_limited")
        print(f"[ratelimit] {model} cooling down for {seconds}s ({reason})")

    def cooldown_remaining(self, model):
        ttl = self.r.ttl(f"rl:cooldown:{model}")
        return ttl if ttl and ttl > 0 else 0

    def all_cooling(self, models):
        return all(self.cooldown_remaining(m) > 0 for m in models)
