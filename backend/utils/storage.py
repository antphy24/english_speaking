"""
Keeps each student's LATEST recording per practice mode in Supabase Storage, so
students (and their teacher) can listen to it again next to the transcript,
score and feedback.

Storage stays small and free: one object per student per "slot".

    <student_id>/<slot>/p-<submission_id>       uploaded right after transcription
    <student_id>/<slot>/saved-<submission_id>   the one that belongs to the saved score

A new upload replaces any older pending file; saving a score replaces the saved
file. Everything here is best-effort: a storage problem never fails or delays a
student's grade (short timeouts, callers catch exceptions).
"""
import os

import httpx

BUCKET = os.getenv("RECORDINGS_BUCKET", "recordings")
ENABLED = os.getenv("KEEP_RECORDINGS", "true").lower() == "true"
TIMEOUT = float(os.getenv("RECORDINGS_TIMEOUT_SECONDS", "20"))

# Which recordings belong to a saved score of each mode.
# (AI Conversation is many short turns, so it keeps the transcript only.)
MODE_SLOTS = {
    "read_aloud": ["read_aloud"],
    "qa": ["qa"],
    "debate": ["debate"],
    "mattering": ["mattering", "mattering_rebuttal"],
}
# Slots filled by "transcribe" turns (the mattering drill records two speeches).
TURN_SLOTS = {"mattering", "mattering_rebuttal"}

CONTENT_TYPES = {
    ".webm": "audio/webm", ".mp4": "audio/mp4", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".mpeg": "audio/mpeg", ".mpga": "audio/mpeg",
    ".flac": "audio/flac",
}


def available():
    return ENABLED and bool(os.getenv("SUPABASE_URL")) and bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


def _base():
    return f"{os.getenv('SUPABASE_URL')}/storage/v1"


def _headers(extra=None):
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    return {"apikey": key, "Authorization": f"Bearer {key}", **(extra or {})}


def _client():
    force_ipv4 = os.getenv("FORCE_IPV4", "true").lower() == "true"
    transport = httpx.HTTPTransport(local_address="0.0.0.0", retries=1) if force_ipv4 else None
    return httpx.Client(timeout=TIMEOUT, transport=transport)


def _folder(user_id, slot):
    return f"{user_id}/{slot}"


def _list(client, folder):
    resp = client.post(f"{_base()}/object/list/{BUCKET}", headers=_headers(),
                       json={"prefix": folder, "limit": 100, "offset": 0})
    if resp.status_code != 200:
        return []
    return [o["name"] for o in resp.json() if o.get("name") and o.get("id")]


def _delete(client, paths):
    if paths:
        client.request("DELETE", f"{_base()}/object/{BUCKET}", headers=_headers(), json={"prefixes": paths})


def _ensure_bucket(client):
    resp = client.post(f"{_base()}/bucket", headers=_headers(),
                       json={"id": BUCKET, "name": BUCKET, "public": False})
    return resp.status_code in (200, 201, 409) or "already exists" in resp.text.lower()


def store_pending(user_id, slot, sub_id, file_path, filename=""):
    """Upload a just-transcribed recording. Returns True when it is stored."""
    if not available() or not slot:
        return False
    ext = os.path.splitext(filename or file_path)[1].lower()
    content_type = CONTENT_TYPES.get(ext, "audio/webm")
    with open(file_path, "rb") as f:
        data = f.read()
    folder = _folder(user_id, slot)
    name = f"p-{sub_id}"
    url = f"{_base()}/object/{BUCKET}/{folder}/{name}"
    headers = _headers({"Content-Type": content_type, "x-upsert": "true", "cache-control": "3600"})
    with _client() as client:
        resp = client.post(url, headers=headers, content=data)
        if resp.status_code in (400, 404) and "bucket" in resp.text.lower() and _ensure_bucket(client):
            resp = client.post(url, headers=headers, content=data)  # first recording ever: bucket was missing
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Recording upload failed ({resp.status_code}): {resp.text[:200]}")
        # Only one unsaved recording is kept per slot.
        stale = [f"{folder}/{n}" for n in _list(client, folder) if n.startswith("p-") and n != name]
        _delete(client, stale)
    return True


def promote(user_id, slot, sub_id=None):
    """
    A score for this slot is being saved: drop the previously saved recording and,
    if `sub_id` has a pending recording, make it the saved one. Returns its path
    (or None when this score has no recording).
    """
    if not available():
        return None
    folder = _folder(user_id, slot)
    with _client() as client:
        names = _list(client, folder)
        _delete(client, [f"{folder}/{n}" for n in names if n.startswith("saved-")])
        if not sub_id or f"p-{sub_id}" not in names:
            return None
        dest = f"{folder}/saved-{sub_id}"
        resp = client.post(f"{_base()}/object/move", headers=_headers(),
                           json={"bucketId": BUCKET, "sourceKey": f"{folder}/p-{sub_id}", "destinationKey": dest})
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Recording move failed ({resp.status_code}): {resp.text[:200]}")
        return dest


def signed_url(path, expires_in=3600):
    """A temporary link the browser can play. None if the recording is gone."""
    if not available() or not path:
        return None
    with _client() as client:
        resp = client.post(f"{_base()}/object/sign/{BUCKET}/{path}", headers=_headers(),
                           json={"expiresIn": int(expires_in)})
    if resp.status_code != 200:
        return None
    signed = resp.json().get("signedURL") or resp.json().get("signedUrl")
    return f"{_base()}{signed}" if signed else None


async def signed_url_async(client, path, expires_in=3600):
    """Same as signed_url, on the API server's shared (kept-alive) async client - much faster."""
    if not available() or not path:
        return None
    resp = await client.post(f"{_base()}/object/sign/{BUCKET}/{path}", headers=_headers(),
                             json={"expiresIn": int(expires_in)})
    if resp.status_code != 200:
        return None
    signed = resp.json().get("signedURL") or resp.json().get("signedUrl")
    return f"{_base()}{signed}" if signed else None
