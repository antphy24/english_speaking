"""
HTTP endpoints of the Research Test mode. See utils/research.py for the overall flow.

Who can do what (checked on every request - the tables have no browser access):
* teacher  (role "teacher"): their own studies, tests, assignments, scorers, results, export
* student  (role "student"): open tests assigned to their class, their own attempt; never scores
* scorer   (role "scorer"):  anonymous recordings of the studies they are linked to; their own scores
"""
import asyncio
import hashlib
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from rq import Queue
from starlette.background import BackgroundTask

from utils import research as rs
from utils.research import ResearchError

UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")
ITEM_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,30}$")
MAX_AUDIO = 10 * 1024 * 1024
MAX_IMAGE = 5 * 1024 * 1024
AUDIO_EXT = {"audio/webm": ".webm", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/ogg": ".ogg",
             "audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/aac": ".aac"}
IMAGE_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
SCORER_DOMAIN = "scorers.hrefspeak.com"


def scorer_email(username):
    return f"scorer_{username}@{SCORER_DOMAIN}"


def _uuid(value, what="id"):
    if not value or not UUID_RE.match(str(value)):
        raise HTTPException(status_code=400, detail=f"Invalid {what}.")
    return str(value)


async def run(fn, *args, **kwargs):
    """Run a blocking research helper in a thread; turn its errors into HTTP errors."""
    try:
        return await asyncio.to_thread(fn, *args, **kwargs)
    except ResearchError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[research] {getattr(fn, '__name__', fn)} failed: {e}")
        raise HTTPException(status_code=502, detail="The database did not respond. Please try again.")


# ---------------------------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------------------------

class StudyCreate(BaseModel):
    title: str
    unit: str = "SMA"


class StudyUpdate(BaseModel):
    title: str


class TestUpdate(BaseModel):
    title: Optional[str] = None
    content: dict


class AssignmentBody(BaseModel):
    class_id: str
    is_open: bool = False
    student_ids: Optional[List[str]] = None   # None = whole class
    remove: bool = False


class StartBody(BaseModel):
    consent: bool


class ScorerCreate(BaseModel):
    full_name: str
    username: str
    password: str


class ScorerPassword(BaseModel):
    password: str


class HumanScore(BaseModel):
    pronunciation: int
    fluency: int
    vocabulary: int
    grammar: int
    comprehension: int
    notes: Optional[str] = None


# ---------------------------------------------------------------------------------------------
# Data helpers (blocking; called through run())
# ---------------------------------------------------------------------------------------------

def _study_for_teacher(study_id, teacher_id):
    study = rs.db_one("research_studies", {"id": f"eq.{study_id}", "select": "*"})
    if not study or str(study["teacher_id"]) != str(teacher_id):
        raise ResearchError("Study not found.", 404)
    return study


def _test_for_teacher(test_id, teacher_id):
    test = rs.db_one("research_tests", {"id": f"eq.{test_id}",
                                        "select": "*,study:research_studies!inner(id,teacher_id,title)"})
    if not test or str(test["study"]["teacher_id"]) != str(teacher_id):
        raise ResearchError("Test not found.", 404)
    return test


def _attempt_for_teacher(attempt_id, teacher_id):
    a = rs.db_one("research_attempts", {"id": f"eq.{attempt_id}",
                                        "select": "*,study:research_studies!inner(teacher_id)"})
    if not a or str(a["study"]["teacher_id"]) != str(teacher_id):
        raise ResearchError("Attempt not found.", 404)
    return a


def _with_image_urls(content, keep_notes=True):
    content = dict(content or {})
    paths = [p.get("image_path") for p in content.get("parts", []) if p.get("image_path")]
    urls = rs.signed_urls(paths, 6 * 3600) if paths else {}
    parts = []
    for p in content.get("parts", []):
        p = dict(p)
        p["image_url"] = urls.get(p.get("image_path")) if p.get("image_path") else None
        if not keep_notes:
            p.pop("image_note", None)
        parts.append(p)
    content["parts"] = parts
    return content


def list_studies(teacher_id):
    studies = rs.db_select("research_studies", {"teacher_id": f"eq.{teacher_id}", "select": "*",
                                                "order": "created_at.desc"})
    if not studies:
        return []
    tests = rs.db_select("research_tests", {"study_id": rs.in_list(s["id"] for s in studies),
                                            "select": "id,study_id,kind,title"})
    attempts = rs.db_select("research_attempts", {"study_id": rs.in_list(s["id"] for s in studies),
                                                  "select": "test_id,status"})
    counts = {}
    for a in attempts:
        c = counts.setdefault(a["test_id"], {"submitted": 0, "scored": 0})
        if a["status"] in ("submitted", "scoring", "scored", "error"):
            c["submitted"] += 1
        if a["status"] == "scored":
            c["scored"] += 1
    for s in studies:
        s["tests"] = sorted([{**t, **counts.get(t["id"], {"submitted": 0, "scored": 0})}
                             for t in tests if t["study_id"] == s["id"]], key=lambda t: t["kind"], reverse=True)
    return studies


def create_study(teacher_id, title, unit):
    title = title.strip()[:200]
    if not title:
        raise ResearchError("Please enter a title.")
    study = rs.db_insert("research_studies", {"teacher_id": teacher_id, "title": title, "unit": unit[:20]})
    for kind, label in (("pre", "Pretest"), ("post", "Posttest")):
        rs.db_insert("research_tests", {"study_id": study["id"], "kind": kind, "title": f"{label} Speaking",
                                        "content": rs.default_content(kind, title)})
    return study


def study_detail(study_id, teacher_id):
    study = _study_for_teacher(study_id, teacher_id)
    tests = rs.db_select("research_tests", {"study_id": f"eq.{study_id}", "select": "*"})
    tests.sort(key=lambda t: t["kind"], reverse=True)  # pre first
    for t in tests:
        t["content"] = _with_image_urls(t["content"])
    assignments = rs.db_select("research_assignments", {"test_id": rs.in_list(t["id"] for t in tests), "select": "*"})
    scorers = rs.db_select("research_scorers", {"study_id": f"eq.{study_id}", "select": "*", "order": "created_at.asc"})
    classes = rs.db_select("classes", {"teacher_id": f"eq.{teacher_id}", "select": "id,class_name",
                                       "order": "class_name.asc"})
    students = rs.db_select("students", {"class_id": rs.in_list(c["id"] for c in classes),
                                         "select": "id,full_name,class_id", "order": "full_name.asc"}) if classes else []
    return {"study": study, "tests": tests, "assignments": assignments, "scorers": scorers,
            "classes": classes, "students": students, "scoring_runs": rs.SCORING_RUNS, "ai_model": rs.GEMINI_MODEL}


def save_test(test_id, teacher_id, title, content):
    test = _test_for_teacher(test_id, teacher_id)
    clean = rs.clean_content(content)
    # Pictures can only be set through the upload endpoint: keep stored paths.
    old_images = {p["id"]: p.get("image_path") for p in (test["content"] or {}).get("parts", [])}
    for p in clean["parts"]:
        if p.get("image_path") and p["image_path"] != old_images.get(p["id"]):
            p["image_path"] = old_images.get(p["id"])
    fields = {"content": clean}
    if title is not None and title.strip():
        fields["title"] = title.strip()[:200]
    rs.db_update("research_tests", {"id": f"eq.{test_id}"}, fields)
    return {"ok": True}


def set_image(test_id, teacher_id, part_id, data, content_type, remove=False):
    test = _test_for_teacher(test_id, teacher_id)
    content = test["content"] or {}
    part = next((p for p in content.get("parts", []) if p.get("id") == part_id), None)
    if not part:
        raise ResearchError("Part not found.", 404)
    old = part.get("image_path")
    if remove:
        part["image_path"] = None
    else:
        path = f"{test['study_id']}/{test_id}/images/{part_id}-{uuid.uuid4().hex[:8]}{IMAGE_EXT[content_type]}"
        rs.storage_upload(path, data, content_type)
        part["image_path"] = path
    rs.db_update("research_tests", {"id": f"eq.{test_id}"}, {"content": content})
    if old:
        try:
            rs.storage_delete([old])
        except Exception:
            pass
    return {"ok": True}


def save_assignment(test_id, teacher_id, body: AssignmentBody):
    _test_for_teacher(test_id, teacher_id)
    cls = rs.db_one("classes", {"id": f"eq.{body.class_id}", "select": "id,teacher_id"})
    if not cls or str(cls["teacher_id"]) != str(teacher_id):
        raise ResearchError("Class not found.", 404)
    if body.remove:
        rs.db_delete("research_assignments", {"test_id": f"eq.{test_id}", "class_id": f"eq.{body.class_id}"})
        return {"ok": True}
    ids = None
    if body.student_ids is not None:
        ids = [_uuid(s, "student") for s in body.student_ids]
    row = rs.db_insert("research_assignments", {"test_id": test_id, "class_id": body.class_id,
                                                "is_open": bool(body.is_open), "student_ids": ids},
                       upsert_on="test_id,class_id")
    return row


def test_progress(test_id, teacher_id):
    test = _test_for_teacher(test_id, teacher_id)
    assignments = rs.db_select("research_assignments", {"test_id": f"eq.{test_id}", "select": "*"})
    class_ids = [a["class_id"] for a in assignments]
    students = rs.db_select("students", {"class_id": rs.in_list(class_ids), "select": "id,full_name,class_id",
                                         "order": "full_name.asc"}) if class_ids else []
    attempts = rs.db_select("research_attempts", {
        "test_id": f"eq.{test_id}",
        "select": "id,student_id,class_id,anon_code,status,consent_given,started_at,submitted_at,ai_scores,ai_error,"
                  "ai_next_try_at,ai_scored_at"})
    responses = rs.db_select("research_responses", {
        "attempt_id": rs.in_list(a["id"] for a in attempts),
        "select": "attempt_id,transcribe_status"}) if attempts else []
    tr = {}
    for x in responses:
        d = tr.setdefault(x["attempt_id"], {"answers": 0, "transcribed": 0})
        d["answers"] += 1
        d["transcribed"] += 1 if x["transcribe_status"] != "pending" else 0
    humans = rs.db_select("research_human_scores", {"attempt_id": rs.in_list(a["id"] for a in attempts),
                                                    "select": "attempt_id"}) if attempts else []
    hcount = {}
    for h in humans:
        hcount[h["attempt_id"]] = hcount.get(h["attempt_id"], 0) + 1
    by_student = {a["student_id"]: {**a, **tr.get(a["id"], {"answers": 0, "transcribed": 0}),
                                    "human_scores": hcount.get(a["id"], 0)} for a in attempts}
    return {"test_id": test_id, "items": len(rs.all_items(test["content"])),
            "assignments": assignments, "students": students, "attempts": by_student}


def attempt_detail(attempt, *, for_scorer=None):
    """Recordings, transcripts and (when allowed) scores of one attempt."""
    test = rs.db_one("research_tests", {"id": f"eq.{attempt['test_id']}", "select": "kind,title,content"})
    responses = rs.db_select("research_responses", {"attempt_id": f"eq.{attempt['id']}", "select": "*"})
    urls = rs.signed_urls([x["audio_path"] for x in responses])
    content = _with_image_urls(test["content"], keep_notes=False)
    by_item = {x["item_id"]: x for x in responses}
    items = []
    for it in rs.all_items(content):
        x = by_item.get(it["id"])
        part = next((p for p in content["parts"] if p["id"] == it["part_id"]), {})
        items.append({
            "id": it["id"], "part_title": it["part_title"], "prompt": it["prompt"],
            "speak_seconds": it.get("speak_seconds"), "image_url": part.get("image_url"),
            "audio_url": urls.get(x["audio_path"]) if x else None,
            "duration_seconds": x.get("duration_seconds") if x else None,
            "repeats_used": x.get("repeats_used") if x else None,
            "transcript": x.get("transcript") if x else None,
            "transcribe_status": x.get("transcribe_status") if x else "missing",
            "measures": (x.get("transcript_meta") or {}) if x else {},
        })
    out = {"id": attempt["id"], "anon_code": attempt["anon_code"], "status": attempt["status"],
           "items": items, "metrics": attempt.get("metrics"), "rubric": rubric_for_ui()}
    ai_block = {"ai_scores": attempt.get("ai_scores"), "ai_feedback": attempt.get("ai_feedback"),
                "ai_model": attempt.get("ai_model"), "ai_runs": len(attempt.get("ai_runs") or []),
                "ai_error": attempt.get("ai_error"), "ai_scored_at": attempt.get("ai_scored_at")}
    if for_scorer:
        mine = rs.db_one("research_human_scores", {"attempt_id": f"eq.{attempt['id']}",
                                                   "scorer_id": f"eq.{for_scorer}", "select": "*"})
        out["my_score"] = mine
        if mine:
            out.update(ai_block)  # revealed only after the scorer saved their own score
    else:
        out.update(ai_block)
        out["test_kind"] = test["kind"]
        out["consent_at"] = attempt.get("consent_at")
        out["submitted_at"] = attempt.get("submitted_at")
        humans = rs.db_select("research_human_scores", {"attempt_id": f"eq.{attempt['id']}", "select": "*"})
        names = {s["user_id"]: s["full_name"] for s in rs.db_select(
            "research_scorers", {"study_id": f"eq.{attempt['study_id']}", "select": "user_id,full_name"})}
        out["human_scores"] = [{**h, "scorer_name": names.get(h["scorer_id"], "Scorer")} for h in humans]
    return out


def rubric_for_ui():
    rows = {}
    for block in rs.RUBRIC.split("\n\n")[1:]:
        lines = [l for l in block.strip().split("\n") if l.strip()]
        if not lines:
            continue
        name = lines[0].split(" (")[0].strip().lower().split(" /")[0]
        key = {"comprehension": "comprehension"}.get(name, name)
        rows[key] = {int(l[0]): l[2:].split(" [")[0] for l in lines[1:] if l[:1].isdigit()}
    return {"labels": rs.ASPECT_LABELS, "levels": rows}


def reset_attempt(attempt_id, teacher_id):
    a = _attempt_for_teacher(attempt_id, teacher_id)
    responses = rs.db_select("research_responses", {"attempt_id": f"eq.{attempt_id}", "select": "audio_path"})
    rs.db_delete("research_attempts", {"id": f"eq.{attempt_id}"})
    rs.storage_delete([x["audio_path"] for x in responses])
    return {"ok": True, "student_id": a["student_id"]}


def rescore_attempt(attempt_id, teacher_id):
    a = _attempt_for_teacher(attempt_id, teacher_id)
    if a["status"] in ("in_progress", "declined"):
        raise ResearchError("This test was not submitted yet.")
    rs.db_update("research_attempts", {"id": f"eq.{attempt_id}"},
                 {"status": "submitted", "ai_runs": [], "ai_scores": None, "ai_feedback": None,
                  "ai_error": None, "ai_next_try_at": None})
    rs.r.delete(f"research:fail:{attempt_id}")
    return {"ok": True}


def delete_study(study_id, teacher_id):
    _study_for_teacher(study_id, teacher_id)
    attempts = rs.db_select("research_attempts", {"study_id": f"eq.{study_id}", "select": "id"})
    paths = []
    if attempts:
        paths = [x["audio_path"] for x in rs.db_select(
            "research_responses", {"attempt_id": rs.in_list(a["id"] for a in attempts), "select": "audio_path"})]
    tests = rs.db_select("research_tests", {"study_id": f"eq.{study_id}", "select": "content"})
    paths += [p.get("image_path") for t in tests for p in (t["content"] or {}).get("parts", []) if p.get("image_path")]
    scorers = rs.db_select("research_scorers", {"study_id": f"eq.{study_id}", "select": "id"})
    for s in scorers:
        remove_scorer(s["id"], study_id)
    rs.db_delete("research_studies", {"id": f"eq.{study_id}"})
    rs.storage_delete(paths)
    return {"ok": True}


# --- scorer accounts (Supabase Auth admin API) -------------------------------------------------

def _auth_admin(method, path, json=None):
    with rs._client() as client:
        resp = client.request(method, f"{os.getenv('SUPABASE_URL')}/auth/v1/admin{path}",
                              headers=rs._headers({"Content-Type": "application/json"}), json=json)
    return resp


def add_scorer(study_id, teacher_id, body: ScorerCreate):
    _study_for_teacher(study_id, teacher_id)
    username = body.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise ResearchError("Username: 3-30 characters, only a-z, 0-9, dot or underscore.")
    if len(body.password) < 6:
        raise ResearchError("Password must be at least 6 characters.")
    name = body.full_name.strip()[:120]
    if not name:
        raise ResearchError("Please enter the scorer's name.")
    resp = _auth_admin("POST", "/users", {
        "email": scorer_email(username), "password": body.password, "email_confirm": True,
        "user_metadata": {"role": "scorer", "full_name": name, "username": username}})
    if resp.status_code not in (200, 201):
        text = resp.text.lower()
        if "already" in text or resp.status_code == 422:
            raise ResearchError("That username is already taken. Choose another one.", 409)
        raise ResearchError(f"Could not create the account ({resp.status_code}).", 502)
    user_id = resp.json().get("id")
    # If a database trigger made a student profile for every new login, remove it for scorers.
    try:
        rs.db_delete("students", {"id": f"eq.{user_id}"})
    except Exception:
        pass
    return rs.db_insert("research_scorers", {"study_id": study_id, "user_id": user_id,
                                             "full_name": name, "username": username})


def remove_scorer(scorer_row_id, study_id):
    row = rs.db_one("research_scorers", {"id": f"eq.{scorer_row_id}", "study_id": f"eq.{study_id}", "select": "*"})
    if not row:
        raise ResearchError("Scorer not found.", 404)
    rs.db_delete("research_scorers", {"id": f"eq.{scorer_row_id}"})
    # Their scores are kept for the export; the login is deleted when no other study uses it.
    if not rs.db_select("research_scorers", {"user_id": f"eq.{row['user_id']}", "select": "id"}):
        _auth_admin("DELETE", f"/users/{row['user_id']}")
    return {"ok": True}


def set_scorer_password(scorer_row_id, study_id, password):
    if len(password) < 6:
        raise ResearchError("Password must be at least 6 characters.")
    row = rs.db_one("research_scorers", {"id": f"eq.{scorer_row_id}", "study_id": f"eq.{study_id}", "select": "*"})
    if not row:
        raise ResearchError("Scorer not found.", 404)
    resp = _auth_admin("PUT", f"/users/{row['user_id']}", {"password": password})
    if resp.status_code != 200:
        raise ResearchError("Could not change the password.", 502)
    return {"ok": True}


# --- students ------------------------------------------------------------------------------------

def _student_profile(student_id):
    s = rs.db_one("students", {"id": f"eq.{student_id}", "select": "id,full_name,class_id"})
    if not s:
        raise ResearchError("Student profile not found.", 403)
    return s


def _open_assignment(test_id, student):
    a = rs.db_one("research_assignments", {"test_id": f"eq.{test_id}", "class_id": f"eq.{student['class_id']}",
                                           "select": "*"})
    if not a or not a["is_open"]:
        return None
    if a.get("student_ids") is not None and student["id"] not in [str(x) for x in a["student_ids"]]:
        return None
    return a


def my_tests(student_id):
    student = _student_profile(student_id)
    if not student.get("class_id"):
        return []
    assignments = rs.db_select("research_assignments", {"class_id": f"eq.{student['class_id']}",
                                                        "is_open": "eq.true", "select": "test_id,student_ids"})
    allowed = [a["test_id"] for a in assignments
               if a.get("student_ids") is None or student_id in [str(x) for x in a["student_ids"]]]
    if not allowed:
        return []
    tests = rs.db_select("research_tests", {"id": rs.in_list(allowed), "select": "id,kind,title,content"})
    attempts = {a["test_id"]: a for a in rs.db_select(
        "research_attempts", {"student_id": f"eq.{student_id}", "test_id": rs.in_list(allowed),
                              "select": "id,test_id,status"})}
    out = []
    for t in tests:
        a = attempts.get(t["id"])
        status = "not_started"
        if a:
            status = {"declined": "declined", "in_progress": "in_progress"}.get(a["status"], "done")
        items = rs.all_items(t["content"])
        out.append({"test_id": t["id"], "title": t["title"], "status": status, "attempt_id": a["id"] if a else None,
                    "questions": len(items), "consent_text": (t["content"] or {}).get("consent_text", ""),
                    "minutes": round(sum(i["speak_seconds"] + i.get("prep_seconds", 0) + 15 for i in items) / 60)})
    return out


def start_attempt(test_id, student_id, consent):
    student = _student_profile(student_id)
    if not _open_assignment(test_id, student):
        raise ResearchError("This test is not open for you right now.", 403)
    test = rs.db_one("research_tests", {"id": f"eq.{test_id}", "select": "id,study_id,content"})
    existing = rs.db_one("research_attempts", {"test_id": f"eq.{test_id}", "student_id": f"eq.{student_id}",
                                               "select": "*"})
    now = rs.now_iso()
    consent_text = (test["content"] or {}).get("consent_text", "")
    if existing:
        if existing["status"] not in ("declined", "in_progress"):
            raise ResearchError("You have already finished this test.", 409)
        fields = {"consent_given": consent, "consent_at": now, "consent_text": consent_text,
                  "status": "in_progress" if consent else "declined"}
        if consent and not existing.get("started_at"):
            fields["started_at"] = now
        if existing["status"] == "in_progress" and not consent:
            fields = {}  # already started with consent; ignore
        if fields:
            rs.db_update("research_attempts", {"id": f"eq.{existing['id']}"}, fields)
        return {"attempt_id": existing["id"], "status": fields.get("status", existing["status"])}
    for _ in range(6):
        try:
            row = rs.db_insert("research_attempts", {
                "test_id": test_id, "study_id": test["study_id"], "student_id": student_id,
                "class_id": student["class_id"], "anon_code": rs.new_anon_code(),
                "status": "in_progress" if consent else "declined",
                "consent_given": consent, "consent_at": now, "consent_text": consent_text,
                "started_at": now if consent else None})
            return {"attempt_id": row["id"], "status": row["status"]}
        except RuntimeError as e:
            if "anon_code" in str(e) or "23505" in str(e):
                if "test_id" in str(e) and "student_id" in str(e):
                    raise ResearchError("You already started this test. Please reload the page.", 409)
                continue
            raise
    raise ResearchError("Could not start the test. Please try again.", 502)


def _attempt_for_student(attempt_id, student_id):
    a = rs.db_one("research_attempts", {"id": f"eq.{attempt_id}", "select": "*"})
    if not a or str(a["student_id"]) != str(student_id):
        raise ResearchError("Test attempt not found.", 404)
    return a


def student_attempt(attempt_id, student_id):
    a = _attempt_for_student(attempt_id, student_id)
    test = rs.db_one("research_tests", {"id": f"eq.{a['test_id']}", "select": "title,content"})
    done = [x["item_id"] for x in rs.db_select("research_responses",
                                                {"attempt_id": f"eq.{attempt_id}", "select": "item_id"})]
    content = _with_image_urls(test["content"], keep_notes=False)
    content.pop("consent_text", None)
    return {"attempt_id": a["id"], "status": a["status"], "title": test["title"], "content": content,
            "answered": done}


def save_response(attempt_id, student_id, item_id, client_id, repeats, duration, data, content_type):
    a = _attempt_for_student(attempt_id, student_id)
    if a["status"] != "in_progress":
        raise ResearchError("This test is already finished.", 409)
    test = rs.db_one("research_tests", {"id": f"eq.{a['test_id']}", "select": "content"})
    items = {i["id"]: i for i in rs.all_items(test["content"])}
    if item_id not in items:
        raise ResearchError("Unknown question.", 400)
    existing = rs.db_one("research_responses", {"attempt_id": f"eq.{attempt_id}", "item_id": f"eq.{item_id}",
                                                "select": "id,client_id"})
    if existing:
        if existing.get("client_id") == client_id:
            return {"ok": True, "duplicate": True}
        raise ResearchError("This question was already answered.", 409)
    max_rep = int((test["content"] or {}).get("max_repeats", 1))
    ext = AUDIO_EXT.get(content_type, ".webm")
    path = f"{a['study_id']}/{a['test_id']}/{student_id}/{item_id}-{uuid.uuid4().hex[:8]}{ext}"
    rs.storage_upload(path, data, content_type)
    limit = items[item_id].get("speak_seconds", 300) + 5
    try:
        rs.db_insert("research_responses", {
            "attempt_id": attempt_id, "item_id": item_id, "client_id": client_id, "audio_path": path,
            "mime_type": content_type, "size_bytes": len(data),
            "duration_seconds": round(min(max(0.0, duration or 0), limit), 1) or None,
            "repeats_used": max(0, min(max_rep, repeats or 0))})
    except RuntimeError as e:
        rs.storage_delete([path])
        if "23505" in str(e):
            raise ResearchError("This question was already answered.", 409)
        raise
    return {"ok": True}


def submit_attempt(attempt_id, student_id):
    a = _attempt_for_student(attempt_id, student_id)
    if a["status"] != "in_progress":
        return {"ok": True, "already": True}
    test = rs.db_one("research_tests", {"id": f"eq.{a['test_id']}", "select": "content"})
    wanted = {i["id"] for i in rs.all_items(test["content"])}
    have = {x["item_id"] for x in rs.db_select("research_responses",
                                                {"attempt_id": f"eq.{attempt_id}", "select": "item_id"})}
    missing = wanted - have
    if missing:
        raise ResearchError(f"{len(missing)} answer(s) are not uploaded yet.", 409)
    rs.db_update("research_attempts", {"id": f"eq.{attempt_id}"},
                 {"status": "submitted", "submitted_at": rs.now_iso()})
    return {"ok": True}


# --- scorers ---------------------------------------------------------------------------------------

def scorer_studies(user_id):
    links = rs.db_select("research_scorers", {"user_id": f"eq.{user_id}",
                                              "select": "study:research_studies(id,title,unit)"})
    return [l["study"] for l in links if l.get("study")]


def _scorer_link(study_id, user_id):
    if not rs.db_one("research_scorers", {"study_id": f"eq.{study_id}", "user_id": f"eq.{user_id}", "select": "id"}):
        raise ResearchError("You are not a scorer for this study.", 403)


def scorer_attempts(study_id, user_id):
    _scorer_link(study_id, user_id)
    attempts = rs.db_select("research_attempts", {"study_id": f"eq.{study_id}",
                                                  "status": "in.(submitted,scoring,scored,error)",
                                                  "select": "id,anon_code"})
    mine = {h["attempt_id"] for h in rs.db_select("research_human_scores", {
        "scorer_id": f"eq.{user_id}", "attempt_id": rs.in_list(a["id"] for a in attempts),
        "select": "attempt_id"})} if attempts else set()
    # A fixed random order per scorer: no grouping by class, test or submission time.
    attempts.sort(key=lambda a: hashlib.sha256(f"{user_id}:{a['id']}".encode()).hexdigest())
    return [{"id": a["id"], "anon_code": a["anon_code"], "scored_by_me": a["id"] in mine} for a in attempts]


def scorer_attempt(attempt_id, user_id):
    a = rs.db_one("research_attempts", {"id": f"eq.{attempt_id}", "select": "*"})
    if not a or a["status"] in ("in_progress", "declined"):
        raise ResearchError("Recording not found.", 404)
    _scorer_link(a["study_id"], user_id)
    return attempt_detail(a, for_scorer=user_id)


def save_human_score(attempt_id, user_id, body: HumanScore):
    a = rs.db_one("research_attempts", {"id": f"eq.{attempt_id}", "select": "id,study_id,status"})
    if not a or a["status"] in ("in_progress", "declined"):
        raise ResearchError("Recording not found.", 404)
    _scorer_link(a["study_id"], user_id)
    vals = body.model_dump()
    for k in rs.ASPECTS:
        if not 1 <= int(vals[k]) <= 5:
            raise ResearchError("Every score must be between 1 and 5.")
    rs.db_insert("research_human_scores", {
        "attempt_id": attempt_id, "scorer_id": user_id, **{k: int(vals[k]) for k in rs.ASPECTS},
        "notes": (vals.get("notes") or "")[:2000]}, upsert_on="attempt_id,scorer_id")
    return scorer_attempt(attempt_id, user_id)


# --- export ----------------------------------------------------------------------------------------

def _export_data(study_id, teacher_id):
    study = _study_for_teacher(study_id, teacher_id)
    tests = rs.db_select("research_tests", {"study_id": f"eq.{study_id}", "select": "id,kind,title"})
    attempts = rs.db_select("research_attempts", {"study_id": f"eq.{study_id}", "select": "*"})
    attempts = [a for a in attempts if a["status"] != "declined" or a.get("consent_at")]
    sids = {a["student_id"] for a in attempts}
    students = rs.db_select("students", {"id": rs.in_list(sids), "select": "id,full_name,class_id"}) if sids else []
    classes = rs.db_select("classes", {"teacher_id": f"eq.{teacher_id}", "select": "id,class_name"})
    aids = [a["id"] for a in attempts]
    human = rs.db_select("research_human_scores", {"attempt_id": rs.in_list(aids), "select": "*"}) if aids else []
    scorers = rs.db_select("research_scorers", {"study_id": f"eq.{study_id}", "select": "*"})
    responses = rs.db_select("research_responses", {"attempt_id": rs.in_list(aids), "select": "*"}) if aids else []
    return study, tests, attempts, students, classes, human, scorers, responses


def export_xlsx(study_id, teacher_id):
    study, tests, attempts, students, classes, human, scorers, responses = _export_data(study_id, teacher_id)
    return study, rs.build_export(study, tests, attempts, students, classes, human, scorers, responses)


def export_zip(study_id, teacher_id, test_id=None):
    study, tests, attempts, students, classes, human, scorers, responses = _export_data(study_id, teacher_id)
    if test_id:
        attempts = [a for a in attempts if a["test_id"] == test_id]
        keep = {a["id"] for a in attempts}
        responses = [x for x in responses if x["attempt_id"] in keep]
    fd, path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    count = rs.build_zip(path, tests, attempts, students, classes, responses)
    return study, path, count


def _filename(title, suffix):
    base = re.sub(r"[^A-Za-z0-9_-]+", "_", title or "research")[:40].strip("_") or "research"
    return f"{base}_{suffix}"


# ---------------------------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------------------------

def build_router(verify_authenticated, verify_teacher, redis_conn):
    router = APIRouter(prefix="/research")
    q_transcribe = Queue("research_transcribe", connection=redis_conn)
    q_score = Queue("research_score", connection=redis_conn)

    def role(user):
        return (user.get("user_metadata") or {}).get("role")

    async def verify_student(user: dict = Depends(verify_authenticated)):
        if role(user) != "student":
            raise HTTPException(status_code=403, detail="Only students can take the test.")
        return user

    async def verify_scorer(user: dict = Depends(verify_authenticated)):
        if role(user) != "scorer":
            raise HTTPException(status_code=403, detail="This account is not a scorer account.")
        return user

    # ---- teacher ------------------------------------------------------------------------------

    @router.get("/studies")
    async def get_studies(teacher: dict = Depends(verify_teacher)):
        return await run(list_studies, teacher["id"])

    @router.post("/studies")
    async def post_study(body: StudyCreate, teacher: dict = Depends(verify_teacher)):
        unit = body.unit if body.unit in ("SMA", "SMP") else "SMA"
        return await run(create_study, teacher["id"], body.title, unit)

    @router.get("/studies/{study_id}")
    async def get_study(study_id: str, teacher: dict = Depends(verify_teacher)):
        return await run(study_detail, _uuid(study_id), teacher["id"])

    @router.patch("/studies/{study_id}")
    async def patch_study(study_id: str, body: StudyUpdate, teacher: dict = Depends(verify_teacher)):
        def update():
            _study_for_teacher(study_id, teacher["id"])
            return rs.db_update("research_studies", {"id": f"eq.{study_id}"}, {"title": body.title.strip()[:200]})
        _uuid(study_id)
        return await run(update)

    @router.delete("/studies/{study_id}")
    async def del_study(study_id: str, teacher: dict = Depends(verify_teacher)):
        return await run(delete_study, _uuid(study_id), teacher["id"])

    @router.put("/tests/{test_id}")
    async def put_test(test_id: str, body: TestUpdate, teacher: dict = Depends(verify_teacher)):
        return await run(save_test, _uuid(test_id), teacher["id"], body.title, body.content)

    @router.post("/tests/{test_id}/image")
    async def post_image(test_id: str, part_id: str = Form(...), remove: bool = Form(False),
                         file: Optional[UploadFile] = File(None), teacher: dict = Depends(verify_teacher)):
        if not ITEM_RE.match(part_id):
            raise HTTPException(status_code=400, detail="Invalid part.")
        data, ctype = b"", None
        if not remove:
            if not file:
                raise HTTPException(status_code=400, detail="Choose a picture.")
            ctype = (file.content_type or "").split(";")[0]
            if ctype not in IMAGE_EXT:
                raise HTTPException(status_code=400, detail="Use a JPG, PNG or WebP picture.")
            data = await file.read()
            if len(data) > MAX_IMAGE:
                raise HTTPException(status_code=413, detail="The picture is larger than 5 MB.")
        return await run(set_image, _uuid(test_id), teacher["id"], part_id, data, ctype, remove)

    @router.put("/tests/{test_id}/assignment")
    async def put_assignment(test_id: str, body: AssignmentBody, teacher: dict = Depends(verify_teacher)):
        _uuid(body.class_id, "class")
        return await run(save_assignment, _uuid(test_id), teacher["id"], body)

    @router.get("/tests/{test_id}/progress")
    async def get_progress(test_id: str, teacher: dict = Depends(verify_teacher)):
        return await run(test_progress, _uuid(test_id), teacher["id"])

    @router.get("/attempts/{attempt_id}")
    async def get_attempt(attempt_id: str, teacher: dict = Depends(verify_teacher)):
        def load():
            return attempt_detail(_attempt_for_teacher(attempt_id, teacher["id"]))
        _uuid(attempt_id)
        return await run(load)

    @router.post("/attempts/{attempt_id}/reset")
    async def post_reset(attempt_id: str, teacher: dict = Depends(verify_teacher)):
        return await run(reset_attempt, _uuid(attempt_id), teacher["id"])

    @router.post("/attempts/{attempt_id}/rescore")
    async def post_rescore(attempt_id: str, teacher: dict = Depends(verify_teacher)):
        result = await run(rescore_attempt, _uuid(attempt_id), teacher["id"])
        await run(rs.sweep, q_transcribe, q_score)
        return result

    @router.get("/capacity")
    async def get_capacity(test_id: Optional[str] = None, teacher: dict = Depends(verify_teacher)):
        content = None
        if test_id:
            content = (await run(_test_for_teacher, _uuid(test_id), teacher["id"]))["content"]
        cap = await run(rs.capacity, content)
        cached = redis_conn.get(f"research:gemini_check:{rs.GEMINI_MODEL}")
        if cached:
            import json as _json
            cap["scoring"]["check"] = _json.loads(cached)
        else:
            check = await asyncio.to_thread(rs.check_gemini_model)
            import json as _json
            redis_conn.setex(f"research:gemini_check:{rs.GEMINI_MODEL}", 600 if check["ok"] else 60, _json.dumps(check))
            cap["scoring"]["check"] = check
        return cap

    @router.post("/studies/{study_id}/scorers")
    async def post_scorer(study_id: str, body: ScorerCreate, teacher: dict = Depends(verify_teacher)):
        return await run(add_scorer, _uuid(study_id), teacher["id"], body)

    @router.delete("/studies/{study_id}/scorers/{scorer_id}")
    async def del_scorer(study_id: str, scorer_id: str, teacher: dict = Depends(verify_teacher)):
        def go():
            _study_for_teacher(study_id, teacher["id"])
            return remove_scorer(scorer_id, study_id)
        _uuid(study_id), _uuid(scorer_id)
        return await run(go)

    @router.post("/studies/{study_id}/scorers/{scorer_id}/password")
    async def post_scorer_password(study_id: str, scorer_id: str, body: ScorerPassword,
                                   teacher: dict = Depends(verify_teacher)):
        def go():
            _study_for_teacher(study_id, teacher["id"])
            return set_scorer_password(scorer_id, study_id, body.password)
        _uuid(study_id), _uuid(scorer_id)
        return await run(go)

    @router.get("/studies/{study_id}/export")
    async def get_export(study_id: str, teacher: dict = Depends(verify_teacher)):
        study, content = await run(export_xlsx, _uuid(study_id), teacher["id"])
        return Response(content=content,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{_filename(study["title"], "hasil.xlsx")}"'})

    @router.get("/studies/{study_id}/recordings.zip")
    async def get_zip(study_id: str, test_id: Optional[str] = None, teacher: dict = Depends(verify_teacher)):
        study, path, count = await run(export_zip, _uuid(study_id), teacher["id"],
                                       _uuid(test_id, "test") if test_id else None)
        return FileResponse(path, media_type="application/zip",
                            filename=_filename(study["title"], "rekaman.zip"),
                            headers={"X-Recording-Count": str(count),
                                     "Access-Control-Expose-Headers": "X-Recording-Count"},
                            background=BackgroundTask(lambda: os.path.exists(path) and os.remove(path)))

    # ---- student ------------------------------------------------------------------------------

    @router.get("/my-tests")
    async def get_my_tests(user: dict = Depends(verify_student)):
        return await run(my_tests, user["id"])

    @router.post("/tests/{test_id}/start")
    async def post_start(test_id: str, body: StartBody, user: dict = Depends(verify_student)):
        return await run(start_attempt, _uuid(test_id), user["id"], bool(body.consent))

    @router.get("/my-attempts/{attempt_id}")
    async def get_my_attempt(attempt_id: str, user: dict = Depends(verify_student)):
        return await run(student_attempt, _uuid(attempt_id), user["id"])

    @router.post("/my-attempts/{attempt_id}/answer")
    async def post_answer(attempt_id: str, item_id: str = Form(...), client_id: str = Form(...),
                          repeats: int = Form(0), duration: float = Form(0), file: UploadFile = File(...),
                          user: dict = Depends(verify_student)):
        if not ITEM_RE.match(item_id) or not re.fullmatch(r"[A-Za-z0-9-]{8,64}", client_id):
            raise HTTPException(status_code=400, detail="Invalid answer.")
        ctype = (file.content_type or "audio/webm").split(";")[0]
        if not ctype.startswith("audio/") and ctype != "video/webm":
            raise HTTPException(status_code=400, detail="The recording is not audio.")
        if ctype == "video/webm":
            ctype = "audio/webm"
        data = await file.read()
        if len(data) > MAX_AUDIO:
            raise HTTPException(status_code=413, detail="The recording is too large.")
        if len(data) < 200:
            raise HTTPException(status_code=400, detail="The recording is empty. Please check your microphone.")
        return await run(save_response, _uuid(attempt_id), user["id"], item_id, client_id, repeats, duration,
                         data, ctype)

    @router.post("/my-attempts/{attempt_id}/submit")
    async def post_submit(attempt_id: str, user: dict = Depends(verify_student)):
        result = await run(submit_attempt, _uuid(attempt_id), user["id"])
        try:
            await asyncio.to_thread(rs.sweep, q_transcribe, q_score)  # start transcribing right away
        except Exception as e:  # the periodic sweeper will do it
            print(f"[research] immediate sweep failed: {e}")
        return result

    # ---- scorer -------------------------------------------------------------------------------

    @router.get("/scorer/studies")
    async def get_scorer_studies(user: dict = Depends(verify_scorer)):
        return await run(scorer_studies, user["id"])

    @router.get("/scorer/studies/{study_id}/attempts")
    async def get_scorer_attempts(study_id: str, user: dict = Depends(verify_scorer)):
        return await run(scorer_attempts, _uuid(study_id), user["id"])

    @router.get("/scorer/attempts/{attempt_id}")
    async def get_scorer_attempt(attempt_id: str, user: dict = Depends(verify_scorer)):
        return await run(scorer_attempt, _uuid(attempt_id), user["id"])

    @router.put("/scorer/attempts/{attempt_id}")
    async def put_scorer_score(attempt_id: str, body: HumanScore, user: dict = Depends(verify_scorer)):
        return await run(save_human_score, _uuid(attempt_id), user["id"], body)

    return router, q_transcribe, q_score


async def sweeper_loop(q_transcribe, q_score, interval=120):
    """Restarts pending research work (after quota resets, restarts, lost jobs)."""
    await asyncio.sleep(15)
    while True:
        try:
            if os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
                started = await asyncio.to_thread(rs.sweep, q_transcribe, q_score)
                if started["transcribe"] or started["score"]:
                    print(f"[research] sweeper started {started}")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            print(f"[research] sweeper error: {e}")
        await asyncio.sleep(interval)
