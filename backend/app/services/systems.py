"""The systems catalogue: a code, a name, a description and the codes of the systems upstream and downstream of it."""

from datetime import datetime, timezone

from app import db
from app.errors import AppError
from app.services import gcs, llm

MAX_CODE = 50
MAX_NAME = 200
MAX_DESCRIPTION = 2000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_admin(user: dict) -> None:
    if user["role_name"] != "Admin":
        raise AppError(403, "Forbidden")


def split_codes(value: str | None) -> list[str]:
    """A comma-separated list of system codes: trimmed, upper case, no blanks, no duplicates, order kept."""
    seen: dict[str, None] = {}
    for part in (value or "").split(","):
        code = part.strip().upper()
        if code:
            seen.setdefault(code, None)
    return list(seen)


def existing_codes() -> set[str]:
    return {row["system_code"] for row in db.fetchall("SELECT system_code FROM systems")}


def text_for(row: dict) -> str:
    """The system as one readable sentence: what is embedded, searched and shown to the chat model."""
    parts = [f"System {row['system_code']} - {row['system_name']}."]
    if row.get("description"):
        parts.append(f"{row['description']}.".replace("..", "."))
    if row.get("upstreams"):
        parts.append(f"Upstreams: {row['upstreams']}.")
    if row.get("downstreams"):
        parts.append(f"Downstreams: {row['downstreams']}.")
    return " ".join(parts)


def _embed(row: dict) -> None:
    vector = llm.embed(text_for(row)) if llm.embedding_configured() else None
    db.exec_sql("UPDATE systems SET embedding = ? WHERE system_code = ?", [vector, row["system_code"]])


def _payload(row: dict) -> dict:
    return {
        "system_code": row["system_code"],
        "system_name": row["system_name"],
        "description": row["description"],
        "upstreams": row["upstreams"],
        "downstreams": row["downstreams"],
        "created_at": row["created_at"],
        "last_modified": row["last_modified"],
    }


def list_systems() -> list[dict]:
    return [_payload(row) for row in db.fetchall("SELECT * FROM systems ORDER BY system_code")]


def _row(code: str) -> dict:
    row = db.fetchone("SELECT * FROM systems WHERE system_code = ?", [code.strip().upper()])
    if row is None:
        raise AppError(404, "System not found")
    return row


def _linked(label: str, value: str | None, own_code: str, known: set[str]) -> str:
    codes = split_codes(value)
    if own_code in codes:
        raise AppError(400, f"{label} cannot include the system itself ({own_code}).")
    unknown = [code for code in codes if code not in known]
    if unknown:
        raise AppError(400, f"{label} has unknown system code(s): {', '.join(unknown)}.")
    return ", ".join(codes)


def _text(value: str | None, label: str, limit: int, required: bool = False) -> str:
    text = (value or "").strip()
    if required and not text:
        raise AppError(400, f"{label} is required.")
    if len(text) > limit:
        raise AppError(400, f"{label} must be {limit} characters or fewer.")
    return text


def create_system(user: dict, body: dict) -> dict:
    _require_admin(user)
    code = _text(str(body.get("system_code") or ""), "System code", MAX_CODE, required=True).upper()
    if "," in code or " " in code:
        raise AppError(400, "System code cannot contain spaces or commas.")
    name = _text(str(body.get("system_name") or ""), "System name", MAX_NAME, required=True)
    description = _text(str(body.get("description") or ""), "Description", MAX_DESCRIPTION)
    known = existing_codes()
    if code in known:
        raise AppError(400, f"System code {code} already exists.")
    upstreams = _linked("Upstreams", body.get("upstreams"), code, known)
    downstreams = _linked("Downstreams", body.get("downstreams"), code, known)
    now = _now()
    db.exec_sql(
        """
        INSERT INTO systems (system_code, system_name, description, upstreams, downstreams, created_at, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [code, name, description, upstreams, downstreams, now, now],
    )
    _embed(_row(code))
    gcs.upload_db()
    return _payload(_row(code))


def update_system(user: dict, code: str, body: dict) -> dict:
    _require_admin(user)
    current = _row(code)
    code = current["system_code"]
    name = _text(str(body.get("system_name", current["system_name"]) or ""), "System name", MAX_NAME, required=True)
    description = _text(str(body.get("description", current["description"]) or ""), "Description", MAX_DESCRIPTION)
    known = existing_codes()
    upstreams = _linked("Upstreams", body.get("upstreams", current["upstreams"]), code, known)
    downstreams = _linked("Downstreams", body.get("downstreams", current["downstreams"]), code, known)
    db.exec_sql(
        """
        UPDATE systems SET system_name = ?, description = ?, upstreams = ?, downstreams = ?, last_modified = ?
        WHERE system_code = ?
        """,
        [name, description, upstreams, downstreams, _now(), code],
    )
    _embed(_row(code))
    gcs.upload_db()
    return _payload(_row(code))


def delete_system(user: dict, code: str) -> None:
    _require_admin(user)
    code = _row(code)["system_code"]
    users = [
        row["system_code"]
        for row in db.fetchall("SELECT system_code, upstreams, downstreams FROM systems WHERE system_code <> ?", [code])
        if code in split_codes(row["upstreams"]) or code in split_codes(row["downstreams"])
    ]
    if users:
        raise AppError(409, f"{code} is still listed as upstream or downstream of: {', '.join(users)}. Remove it there first.")
    used = db.fetchall(
        "SELECT DISTINCT channel FROM interfaces WHERE source = ? OR destination = ? ORDER BY channel", [code, code]
    )
    if used:
        raise AppError(409, f"{code} is used by interfaces in: {', '.join(row['channel'] for row in used)}. Upload a new file without it first.")
    db.exec_sql("DELETE FROM systems WHERE system_code = ?", [code])
    gcs.upload_db()
