"""Audit log: who changed what, and when.

Every request that changes something is recorded by `AuditMiddleware` (app/audit_middleware.py); sign-ins and failed
sign-ins are recorded by the login route. An admin can delete a range of dates; nothing else edits the log.
"""

import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from app import db
from app.errors import AppError
from app.services import gcs

logger = logging.getLogger(__name__)

SENSITIVE = re.compile(r"password|secret|api_?key|token|authorization|credential", re.I)
OMITTED_KEYS = {"content_json", "blocks", "schema_json", "rows", "columns", "structure_json", "sections"}
LABEL_KEYS = (
    "project_name",
    "section_name",
    "name",
    "title",
    "username",
    "login_id",
    "system_code",
    "system_name",
    "table_name",
    "column_name",
    "file_name",
    "filename",
    "active_provider",
    "format",
)
# Words at the end of a route that name an action rather than a thing.
ACTION_WORDS = {"order", "upload", "validate", "generate", "regenerate", "export", "sections-order", "login", "delete-batch", "purge"}
SINGULAR = {
    "projects": "project",
    "documents": "document",
    "sdd": "document",
    "sections": "section",
    "references": "reference",
    "baselines": "reference",
    "images": "image",
    "users": "user",
    "layouts": "layout",
    "templates": "template",
    "guidelines": "guideline",
    "rag": "rag",
    "systems": "system",
    "interfaces": "interface",
    "tables": "table",
    "columns": "column",
    "reports": "report",
    "batches": "batch",
    "bitbucket-repos": "bitbucket_repo",
    "catalogs": "catalogs",
    "settings": "settings",
    "providers": "provider",
    "auth": "user",
}
ID_KEYS = {
    "project": "project_id",
    "document": "document_id",
    "section": "template_id",
    "reference": "doc_id",
    "user": "user_id",
    "layout": "layout_id",
    "template": "template_id",
    "guideline": "guideline_id",
    "rag": "rag_id",
    "system": "system_code",
    "table": "table_id",
    "column": "column_id",
    "report": "report_id",
    "batch": "batch_id",
    "bitbucket_repo": "repo_id",
}
MAX_TEXT = 200
MAX_DETAIL = 4000


_ONE_DAY = timedelta(days=1)


def _now() -> datetime:
    """UTC, without a zone, the way the TIMESTAMP column keeps it."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def humanize(action: str) -> str:
    words = action.replace("_", " ").replace(".", " ").strip()
    return words[:1].upper() + words[1:]


def sanitize(value, depth: int = 0):
    """A copy of a request body that is safe to store: no secrets, no bulk content, short text."""
    if isinstance(value, dict):
        if depth >= 2:
            return f"{{{len(value)} fields}}"
        result = {}
        for key, item in value.items():
            if SENSITIVE.search(str(key)):
                result[key] = "***"
            elif key in OMITTED_KEYS:
                result[key] = "(content not stored)"
            else:
                result[key] = sanitize(item, depth + 1)
        return result
    if isinstance(value, list):
        return f"[{len(value)} items]"
    if isinstance(value, str):
        return value if len(value) <= MAX_TEXT else value[:MAX_TEXT] + "…"
    return value


def label_of(*sources: dict | None) -> str:
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in LABEL_KEYS:
            value = source.get(key)
            if isinstance(value, str) and value.strip() and not SENSITIVE.search(key):
                return value.strip()[:MAX_TEXT]
    return ""


def describe_route(path_format: str, path_params: dict, response: dict | None) -> tuple[str | None, str | None]:
    """The kind of thing a route works on and its id, e.g. ("section", "s-1a2b") for .../sections/{section_id}."""
    tokens = [segment for segment in path_format.strip("/").split("/") if segment and segment != "api"]
    while tokens and tokens[-1] in ACTION_WORDS:
        tokens.pop()
    if not tokens:
        return None, None
    last = tokens[-1]
    if last.startswith("{"):
        parent = tokens[-2] if len(tokens) > 1 else ""
        kind = SINGULAR.get(parent, parent or None)
        return kind, _text(path_params.get(last.strip("{}")))
    kind = SINGULAR.get(last, last)
    entity_id = None
    if isinstance(response, dict) and kind in ID_KEYS:
        entity_id = _text(response.get(ID_KEYS[kind]))
    if entity_id is None:
        # The nearest id in the path, e.g. the project when a document is created.
        for token in reversed(tokens[:-1]):
            if token.startswith("{"):
                entity_id = _text(path_params.get(token.strip("{}")))
                break
    return kind, entity_id


def _text(value) -> str | None:
    return None if value is None else str(value)


def record(
    *,
    action: str,
    summary: str,
    user: dict | None = None,
    login_id: str | None = None,
    method: str | None = None,
    path: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    detail: dict | None = None,
    ip_address: str | None = None,
) -> None:
    """Append one entry. A failure to write the log is logged but never breaks the request."""
    try:
        text = json.dumps(detail, default=str) if detail else None
        if text and len(text) > MAX_DETAIL:
            text = text[:MAX_DETAIL]
        db.exec_sql(
            """
            INSERT INTO audit_log (
                audit_id, occurred_at, user_id, username, login_id, role_name, action, method, path,
                entity_type, entity_id, summary, detail, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                str(uuid.uuid4()),
                _now(),
                (user or {}).get("user_id"),
                (user or {}).get("username"),
                (user or {}).get("login_id") or login_id,
                (user or {}).get("role_name"),
                action,
                method,
                path,
                entity_type,
                entity_id,
                summary[:500],
                text,
                ip_address,
            ],
        )
        gcs.upload_db()
    except Exception:
        logger.exception("Could not write the audit log")


def _entry(row: dict) -> dict:
    detail = row.get("detail")
    try:
        parsed = json.loads(detail) if detail else None
    except ValueError:
        parsed = None
    return {
        "audit_id": row["audit_id"],
        "occurred_at": row["occurred_at"],
        "user_id": row["user_id"],
        "username": row["username"],
        "login_id": row["login_id"],
        "role_name": row["role_name"],
        "action": row["action"],
        "method": row["method"],
        "path": row["path"],
        "entity_type": row["entity_type"],
        "entity_id": row["entity_id"],
        "summary": row["summary"],
        "detail": parsed,
        "ip_address": row["ip_address"],
    }


def list_entries(
    user: str = "",
    action: str = "",
    entity_type: str = "",
    since: str = "",
    until: str = "",
    limit: int = 2000,
) -> list[dict]:
    """Newest first. `user` matches the login ID or name, `since` and `until` are dates (YYYY-MM-DD, UTC)."""
    clauses: list[str] = []
    params: list = []
    if user.strip():
        clauses.append("(lower(login_id) = ? OR lower(username) = ?)")
        params += [user.strip().lower()] * 2
    if action.strip():
        clauses.append("action = ?")
        params.append(action.strip())
    if entity_type.strip():
        clauses.append("entity_type = ?")
        params.append(entity_type.strip())
    start = _day(since)
    if start:
        clauses.append("occurred_at >= ?")
        params.append(start)
    end = _day(until)
    if end:
        clauses.append("occurred_at < ?")
        params.append(end + _ONE_DAY)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    capped = max(1, min(int(limit), 10000))
    rows = db.fetchall(f"SELECT * FROM audit_log {where} ORDER BY occurred_at DESC, audit_id LIMIT {capped}", params)
    return [_entry(row) for row in rows]


def purge_entries(since: str, until: str) -> int:
    """Delete entries on the dates from `since` through `until` (YYYY-MM-DD, UTC). Both dates are required."""
    start = _day(since)
    end = _day(until)
    if start is None or end is None:
        raise AppError(400, "Choose a from date and a to date.")
    if start > end:
        raise AppError(400, "The from date must be on or before the to date.")
    params = [start, end + _ONE_DAY]
    found = db.fetchone("SELECT COUNT(*) AS removed FROM audit_log WHERE occurred_at >= ? AND occurred_at < ?", params)
    removed = int(found["removed"]) if found else 0
    db.exec_sql("DELETE FROM audit_log WHERE occurred_at >= ? AND occurred_at < ?", params)
    gcs.upload_db()
    return removed


def known_actions() -> list[str]:
    """Every action that appears in the log, for the filter."""
    return [row["action"] for row in db.fetchall("SELECT DISTINCT action FROM audit_log ORDER BY action")]


def _day(value: str) -> datetime | None:
    if not value.strip():
        return None
    try:
        return datetime.strptime(value.strip()[:10], "%Y-%m-%d")
    except ValueError:
        raise AppError(400, "Dates must look like 2026-10-14") from None
