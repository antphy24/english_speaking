"""
Teacher score export -> Excel (.xlsx).

Built on the server so it always contains ALL matching records (no 1000-row or
browser limits), with numeric score columns that Excel can sort/average, and a
per-student summary sheet for grading.
"""
import io
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

PAGE = 1000
MODE_LABELS = {
    "read_aloud": "Read Aloud",
    "qa": "Q&A",
    "conversation": "Conversation",
    "debate": "Debate",
}
_ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


# --- Supabase access (service role; the caller has already verified the teacher) ---

def _client():
    force_ipv4 = os.getenv("FORCE_IPV4", "true").lower() == "true"
    transport = httpx.HTTPTransport(local_address="0.0.0.0", retries=2) if force_ipv4 else None
    return httpx.Client(timeout=60, transport=transport)


def _headers():
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _get_all(client, path, params):
    """GET every page of a PostgREST query."""
    url = f"{os.getenv('SUPABASE_URL')}/rest/v1/{path}"
    rows, offset = [], 0
    while True:
        resp = client.get(url, headers=_headers(), params={**params, "limit": PAGE, "offset": offset})
        if resp.status_code != 200:
            raise RuntimeError(f"Supabase query on {path} failed ({resp.status_code}): {resp.text[:300]}")
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        offset += PAGE


def fetch_export_data(teacher_id, class_id=None, mode=None, days=None):
    with _client() as client:
        classes = _get_all(client, "classes", {
            "select": "id,class_name", "teacher_id": f"eq.{teacher_id}", "order": "class_name.asc"})
        if class_id and class_id != "all":
            classes = [c for c in classes if c["id"] == class_id]
            if not classes:
                raise PermissionError("You do not own this class.")
        if not classes:
            return classes, [], []
        class_ids = ",".join(c["id"] for c in classes)

        students = _get_all(client, "students", {
            "select": "id,full_name,school_id,class_id", "class_id": f"in.({class_ids})",
            "order": "full_name.asc"})

        base = {
            "students.class_id": f"in.({class_ids})",
            "order": "created_at.desc",
        }
        if mode and mode != "all":
            base["mode"] = f"eq.{mode}"
        if days:
            since = datetime.now(timezone.utc) - timedelta(days=int(days))
            base["created_at"] = f"gte.{since.isoformat()}"
        cols = "id,student_id,mode,score,feedback,created_at,duration_seconds"
        embed = "students!inner(class_id)"
        try:
            assessments = _get_all(client, "assessments", {**base, "select": f"{cols},transcript,{embed}"})
        except RuntimeError as e:
            if "transcript" not in str(e):
                raise
            # The optional 'transcript' column migration has not been run yet.
            assessments = _get_all(client, "assessments", {**base, "select": f"{cols},{embed}"})
    return classes, students, assessments


# --- helpers ------------------------------------------------------------------

def material_of(feedback):
    fb = feedback if isinstance(feedback, dict) else {}
    return fb.get("material_title") or fb.get("motion") or "Default Material"


def _num(value, digits=None):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return round(v, digits) if digits is not None else v


def _text(value):
    if value is None:
        return None
    if isinstance(value, list):
        value = ", ".join(str(v) for v in value)
    value = _ILLEGAL.sub("", str(value))
    return value[:32000]  # Excel cell limit is 32767 characters


def _local(iso, tz_offset_minutes):
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    # JS getTimezoneOffset(): minutes to ADD to local time to get UTC (UTC+8 -> -480)
    return (dt - timedelta(minutes=tz_offset_minutes or 0)).replace(tzinfo=None)


def _style_sheet(ws, widths, header_row=1):
    header_fill = PatternFill("solid", fgColor="1F2937")
    for cell in ws[header_row]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = ws.cell(row=header_row + 1, column=3)
    if ws.max_row > header_row:
        ws.auto_filter.ref = f"A{header_row}:{get_column_letter(ws.max_column)}{ws.max_row}"


def _append(ws, values):
    ws.append(values)
    for cell in ws[ws.max_row]:
        # Never let student/AI text be interpreted as an Excel formula.
        if isinstance(cell.value, str) and cell.value[:1] in ("=", "+", "-", "@"):
            cell.data_type = "s"


# --- workbook -------------------------------------------------------------------

def build_workbook(classes, students, assessments, *, mode=None, material=None, search=None,
                   days=None, tz_offset_minutes=0, teacher_name=""):
    class_name = {c["id"]: c["class_name"] for c in classes}
    student_by_id = {s["id"]: s for s in students}

    q = (search or "").strip().lower()

    def student_matches(s):
        return not q or q in (s.get("full_name") or "").lower() or q in (s.get("school_id") or "").lower()

    rows = []
    for a in assessments:
        s = student_by_id.get(a["student_id"])
        if not s or not student_matches(s):
            continue
        if material and material != "all" and material_of(a.get("feedback")) != material:
            continue
        rows.append((a, s))

    wb = Workbook()

    # Sheet 1: one row per student (for grading)
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Student", "School ID", "Class", "Mode", "Attempts", "Best score", "Average score",
               "Latest score", "First score", "Change (latest - first)", "Latest attempt"])
    per_student = defaultdict(list)
    for a, s in rows:
        per_student[(s["id"], a["mode"])].append(a)
    summary_students = sorted((s for s in students if student_matches(s)),
                              key=lambda s: (class_name.get(s["class_id"], ""), (s.get("full_name") or "").lower()))
    modes = [mode] if mode and mode != "all" else list(MODE_LABELS)
    for s in summary_students:
        student_rows = 0
        for m in modes:
            attempts = sorted(per_student.get((s["id"], m), []), key=lambda a: a["created_at"])
            scores = [_num(a.get("score")) for a in attempts if _num(a.get("score")) is not None]
            if not scores:
                continue
            student_rows += 1
            _append(ws, [
                _text(s.get("full_name")), _text(s.get("school_id")), class_name.get(s["class_id"]),
                MODE_LABELS.get(m, m), len(attempts), max(scores), round(sum(scores) / len(scores), 1),
                scores[-1], scores[0], scores[-1] - scores[0],
                _local(attempts[-1]["created_at"], tz_offset_minutes),
            ])
        if student_rows == 0:  # show who has not done it yet
            _append(ws, [_text(s.get("full_name")), _text(s.get("school_id")), class_name.get(s["class_id"]),
                         MODE_LABELS.get(mode, "-") if mode and mode != "all" else "-",
                         0, None, None, None, None, None, "Not attempted"])
    for row in ws.iter_rows(min_row=2, min_col=11, max_col=11):
        row[0].number_format = "yyyy-mm-dd hh:mm"
    for row in ws.iter_rows(min_row=2, min_col=7, max_col=7):
        row[0].number_format = "0.0"
    _style_sheet(ws, [28, 14, 16, 13, 10, 11, 13, 12, 11, 12, 18])

    # Sheet 2: every attempt with all details
    ws2 = wb.create_sheet("All attempts")
    ws2.append([
        "Date", "Student", "School ID", "Class", "Mode", "Material", "Score (0-100)",
        "Accuracy %", "Word error rate %", "Skipped words", "Unclear words",
        "Fluency", "Lexical resource", "Grammar", "Pronunciation", "Interactive communication",
        "Matter (1-10)", "Manner (1-10)", "Method (1-10)",
        "Feedback", "Feedback source", "Session time (min)", "What the student said (transcript)",
    ])
    for a, s in rows:
        fb = a.get("feedback") if isinstance(a.get("feedback"), dict) else {}
        wer = _num(fb.get("word_error_rate"))
        duration = _num(a.get("duration_seconds"))
        feedback_text = fb.get("feedback") or fb.get("overall_feedback")
        if a["mode"] == "debate":
            parts = [fb.get("overall_feedback"),
                     fb.get("matter_feedback") and f"Matter: {fb['matter_feedback']}",
                     fb.get("manner_feedback") and f"Manner: {fb['manner_feedback']}",
                     fb.get("method_feedback") and f"Method: {fb['method_feedback']}"]
            feedback_text = "\n".join(p for p in parts if p)
        _append(ws2, [
            _local(a["created_at"], tz_offset_minutes),
            _text(s.get("full_name")), _text(s.get("school_id")), class_name.get(s["class_id"]),
            MODE_LABELS.get(a["mode"], a["mode"]), _text(material_of(fb)), _num(a.get("score")),
            _num(fb.get("accuracy_score")), round(wer * 100, 1) if wer is not None else None,
            _text(fb.get("skipped_words")), _text(fb.get("mispronounced_words")),
            _num(fb.get("fluency", fb.get("fluency_and_coherence"))), _num(fb.get("lexical_resource")),
            _num(fb.get("grammatical_range")), _num(fb.get("pronunciation")),
            _num(fb.get("interactive_communication")),
            _num(fb.get("matter_score")), _num(fb.get("manner_score")), _num(fb.get("method_score")),
            _text(feedback_text), {"ai": "AI", "standard": "Standard"}.get(fb.get("feedback_source"), "AI"),
            round(duration / 60, 1) if duration else None,
            _text(a.get("transcript") or fb.get("transcript")),
        ])
    for row in ws2.iter_rows(min_row=2, min_col=1, max_col=1):
        row[0].number_format = "yyyy-mm-dd hh:mm"
    _style_sheet(ws2, [17, 26, 13, 14, 13, 28, 12, 11, 12, 28, 28, 9, 10, 9, 13, 13, 10, 10, 10, 70, 11, 12, 70])

    # Sheet 3: what this file contains
    ws3 = wb.create_sheet("About")
    period = {None: "All time", "7": "Last 7 days", "30": "Last 30 days"}.get(str(days) if days else None,
                                                                          f"Last {days} days")
    info = [
        ("Exported", datetime.utcnow() - timedelta(minutes=tz_offset_minutes or 0)),
        ("Teacher", teacher_name or ""),
        ("Classes", ", ".join(c["class_name"] for c in classes) or "-"),
        ("Mode", MODE_LABELS.get(mode, "All modes") if mode and mode != "all" else "All modes"),
        ("Material", material if material and material != "all" else "All materials"),
        ("Period", period),
        ("Search", search or "-"),
        ("Attempts exported", len(rows)),
        ("Students in summary", len(summary_students)),
        ("", ""),
        ("Scores", "All scores are out of 100. Read Aloud = % of words read correctly. Q&A and Conversation = "
                   "average of the sub-scores. Debate = Matter 40% + Manner 40% + Method 20%."),
        ("Feedback source", "AI = written by the AI; Standard = automatic paragraph used when many students "
                            "were waiting (Read Aloud only). Scores are identical either way."),
    ]
    for key, value in info:
        _append(ws3, [key, value])
    ws3["B1"].number_format = "yyyy-mm-dd hh:mm"
    ws3.column_dimensions["A"].width = 20
    ws3.column_dimensions["B"].width = 110
    for cell in ws3["A"]:
        cell.font = Font(bold=True)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), len(rows)
