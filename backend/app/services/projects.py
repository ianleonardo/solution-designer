import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import bcrypt

from app import db
from app.config import CONTENT_AUTHORS, KB_EDITORS, data_dir
from app.errors import AppError
from app.seed_layouts import SDD_LAYOUT_ID
from app.services import documents, files, gcs, images, layouts, project_rag
from app.services.files import PREFIX


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure(user: dict, roles: set[str]) -> None:
    if user["role_name"] not in roles:
        raise AppError(403, "Forbidden")


def public_user(row: dict) -> dict:
    return {
        "user_id": row["user_id"],
        "username": row["username"],
        "login_id": row["email"],
        "role_name": row["role_name"],
        "created_at": row["created_at"],
    }


def authenticate(login_id: str, password: str) -> dict:
    row = db.fetchone("SELECT * FROM users WHERE lower(email) = ?", [login_id.strip().lower()])
    if row is None or not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        raise AppError(401, "Invalid login ID or password")
    return public_user(row)


def project_row(row: dict) -> dict:
    return {
        "project_id": row["project_id"],
        "project_name": row["project_name"],
        "description": row.get("description") or "",
        "owner_id": row["owner_id"],
        "owner_name": row.get("owner_name"),
        "owner_role": row.get("owner_role"),
        "created_at": row["created_at"],
        "last_modified": row["last_modified"],
    }


def list_projects() -> list[dict]:
    rows = db.fetchall(
        """
        SELECT p.*, u.username AS owner_name, u.role_name AS owner_role
        FROM projects p JOIN users u ON u.user_id = p.owner_id
        ORDER BY p.last_modified DESC
        """
    )
    return [project_row(row) for row in rows]


def dashboard() -> dict:
    total = db.fetchone("SELECT count(*) AS c FROM projects")
    generated = db.fetchone("SELECT count(*) AS c FROM project_documents WHERE generated_at IS NOT NULL")
    documents_total = db.fetchone("SELECT count(*) AS c FROM project_documents")
    return {
        "total_projects": total["c"] if total else 0,
        "total_documents": documents_total["c"] if documents_total else 0,
        "documents_generated": generated["c"] if generated else 0,
    }


def _require_project(project_id: str) -> dict:
    row = db.fetchone(
        """
        SELECT p.*, u.username AS owner_name, u.role_name AS owner_role
        FROM projects p JOIN users u ON u.user_id = p.owner_id
        WHERE p.project_id = ?
        """,
        [project_id],
    )
    if row is None:
        raise AppError(404, "Project not found")
    return row


def _clean_description(description: str) -> str:
    cleaned = description.strip()
    if len(cleaned) > 2000:
        raise AppError(400, "Description must be 2000 characters or fewer")
    return cleaned


def create_project(user: dict, name: str, description: str = "") -> dict:
    _ensure(user, CONTENT_AUTHORS)
    cleaned = name.strip()
    summary = _clean_description(description)
    if not cleaned:
        raise AppError(400, "Project name is required")
    if len(cleaned) > 200:
        raise AppError(400, "Project name must be 200 characters or fewer")
    project_id = str(uuid.uuid4())
    now = _now()
    db.exec_sql(
        """
        INSERT INTO projects (project_id, project_name, description, owner_id, status, created_at, last_modified)
        VALUES (?, ?, ?, ?, 'draft', ?, ?)
        """,
        [project_id, cleaned, summary, user["user_id"], now, now],
    )
    documents.create_blank(project_id, SDD_LAYOUT_ID, now)
    gcs.upload_db()
    return project_row(_require_project(project_id))


def update_project(user: dict, project_id: str, name: str | None = None, description: str | None = None) -> dict:
    _ensure(user, CONTENT_AUTHORS)
    _require_project(project_id)
    assignments = ["last_modified = ?"]
    params: list = [_now()]
    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise AppError(400, "Project name is required")
        if len(cleaned) > 200:
            raise AppError(400, "Project name must be 200 characters or fewer")
        assignments.append("project_name = ?")
        params.append(cleaned)
    if description is not None:
        assignments.append("description = ?")
        params.append(_clean_description(description))
    params.append(project_id)
    db.exec_sql(
        f"UPDATE projects SET {', '.join(assignments)} WHERE project_id = ?",
        params,
    )
    gcs.upload_db()
    return project_row(_require_project(project_id))


def delete_project(user: dict, project_id: str) -> None:
    _ensure(user, CONTENT_AUTHORS)
    _require_project(project_id)
    for row in db.fetchall("SELECT storage_path FROM baseline_docs WHERE project_id = ?", [project_id]):
        path = Path(row["storage_path"])
        if path.exists():
            path.unlink()
    project_rag.remove_project(project_id)
    db.exec_sql("DELETE FROM baseline_docs WHERE project_id = ?", [project_id])
    db.exec_sql("DELETE FROM project_documents WHERE project_id = ?", [project_id])
    db.exec_sql("DELETE FROM generated_sdds WHERE project_id = ?", [project_id])
    images.remove_project_images(project_id)
    db.exec_sql("DELETE FROM projects WHERE project_id = ?", [project_id])
    gcs.upload_db()


def list_baselines(project_id: str) -> list[dict]:
    _require_project(project_id)
    rows = db.fetchall(
        """
        SELECT doc_id, project_id, file_name, file_type, uploaded_by, storage_path, extracted_text, uploaded_at
        FROM baseline_docs WHERE project_id = ? ORDER BY uploaded_at
        """,
        [project_id],
    )
    stats = project_rag.chunk_stats(project_id)
    payload = []
    for row in rows:
        path = Path(row["storage_path"])
        stat = stats.get(row["doc_id"], {"chunks": 0, "embedded": 0})
        payload.append(
            {
                "doc_id": row["doc_id"],
                "file_name": row["file_name"],
                "file_type": row["file_type"],
                "uploaded_by": row["uploaded_by"],
                "uploaded_at": row["uploaded_at"],
                "size_bytes": path.stat().st_size if path.exists() else 0,
                "extracted_text": (row["extracted_text"] or "")[:2000],
                "chunk_count": stat["chunks"],
                # Embedded chunks support semantic search; the rest are searched by keyword only.
                "indexed": stat["chunks"] > 0 and stat["embedded"] == stat["chunks"],
            }
        )
    return payload


def add_baseline(user: dict, project_id: str, filename: str, data: bytes) -> dict:
    _ensure(user, CONTENT_AUTHORS)
    _require_project(project_id)
    text = files.extract_text(filename, data, files.BASELINE_EXTENSIONS)
    doc_id = str(uuid.uuid4())
    folder = data_dir() / "uploads" / "baselines" / project_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{doc_id}_{files.safe_name(filename)}"
    path.write_bytes(data)
    db.exec_sql(
        """
        INSERT INTO baseline_docs (
            doc_id, project_id, file_name, file_type, uploaded_by, storage_path, extracted_text, uploaded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            doc_id,
            project_id,
            Path(filename).name,
            Path(filename).suffix.lower().lstrip("."),
            user["user_id"],
            str(path),
            text[:500000],
            _now(),
        ],
    )
    project_rag.index_document(project_id, doc_id, text[:500000])
    gcs.persist_file(path, f"uploads/baselines/{project_id}/{path.name}")
    gcs.upload_db()
    return next(item for item in list_baselines(project_id) if item["doc_id"] == doc_id)


def delete_baseline(user: dict, project_id: str, doc_id: str) -> None:
    _ensure(user, CONTENT_AUTHORS)
    row = db.fetchone(
        "SELECT * FROM baseline_docs WHERE project_id = ? AND doc_id = ?",
        [project_id, doc_id],
    )
    if row is None:
        raise AppError(404, "Baseline not found")
    path = Path(row["storage_path"])
    if path.exists():
        path.unlink()
    project_rag.remove_document(doc_id)
    db.exec_sql("DELETE FROM baseline_docs WHERE doc_id = ?", [doc_id])
    gcs.upload_db()


def workspace(project_id: str) -> dict:
    project = _require_project(project_id)
    documents_payload = documents.list_documents(project_id, with_templates=True)
    first = documents_payload[0] if documents_payload else None
    return {
        "project": project_row(project),
        "documents": documents_payload,
        "layouts": layouts.list_layouts(),
        "references": list_baselines(project_id),
        # Legacy keys: the first document and its templates.
        "sdd": first,
        "templates": first["templates"] if first else [],
    }


def _next_rag_id(inventory_type: str) -> str:
    prefix = PREFIX[inventory_type]
    rows = db.fetchall("SELECT rag_id FROM rag_inventory WHERE rag_id LIKE ?", [f"{prefix}-%"])
    number = 1
    for row in rows:
        try:
            number = max(number, int(row["rag_id"].split("-", 1)[1]) + 1)
        except (IndexError, ValueError):
            continue
    return f"{prefix}-{number:04d}"


def add_rag(user: dict, filename: str, data: bytes, inventory_type: str | None = None) -> list[dict]:
    _ensure(user, KB_EDITORS)
    if inventory_type is not None and inventory_type not in files.INVENTORY_TYPES:
        raise AppError(400, "Unknown inventory type")
    if inventory_type == "Guidelines":
        raise AppError(400, "Add guidelines from the Guidelines page (they need a title and description).")
    text = files.extract_text(filename, data, files.RAG_EXTENSIONS)
    folder = data_dir() / "uploads" / "rag"
    folder.mkdir(parents=True, exist_ok=True)
    stored = folder / f"{uuid.uuid4()}_{files.safe_name(filename)}"
    stored.write_bytes(data)
    created = []
    for entity in files.extract_entities(Path(filename).name, text, inventory_type):
        rag_id = _next_rag_id(entity["inventory_type"])
        raw = entity.get("raw_content") or ""
        vector = None
        from app.services import llm

        if llm.embedding_configured():
            vector = llm.embed(raw[:2000])
        db.exec_sql(
            """
            INSERT INTO rag_inventory (
                rag_id, inventory_type, system_name, source_name, raw_content, parsed_json, embedding, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                rag_id,
                entity["inventory_type"],
                entity.get("system_name"),
                Path(filename).name,
                raw[:20000],
                json.dumps(entity.get("parsed") or {}),
                vector,
                _now(),
            ],
        )
        created.append(rag_id)
    gcs.persist_file(stored, f"uploads/rag/{stored.name}")
    gcs.upload_db()
    return [item for item in list_rag() if item["rag_id"] in created]


def list_rag() -> list[dict]:
    rows = db.fetchall(
        """
        SELECT rag_id, inventory_type, system_name, source_name, raw_content, parsed_json, created_at
        FROM rag_inventory ORDER BY created_at DESC
        """
    )
    payload = []
    for row in rows:
        parsed = row["parsed_json"]
        payload.append(
            {
                "rag_id": row["rag_id"],
                "inventory_type": row["inventory_type"],
                "system_name": row["system_name"],
                "source_name": row["source_name"],
                "raw_content": row["raw_content"],
                "parsed": json.loads(parsed) if isinstance(parsed, str) else parsed,
                "created_at": row["created_at"],
            }
        )
    return payload


def delete_rag(user: dict, rag_id: str) -> None:
    _ensure(user, KB_EDITORS)
    row = db.fetchone("SELECT rag_id FROM rag_inventory WHERE rag_id = ?", [rag_id])
    if row is None:
        raise AppError(404, "Inventory record not found")
    db.exec_sql("DELETE FROM rag_inventory WHERE rag_id = ?", [rag_id])
    gcs.upload_db()


def list_users(user: dict) -> list[dict]:
    _ensure(user, {"Admin"})
    return [public_user(row) for row in db.fetchall("SELECT * FROM users ORDER BY created_at")]


ROLES = {"Admin", "Analyst", "Viewer"}
LOGIN_ID_PATTERN = re.compile(r"^[A-Za-z0-9]{3,64}$")


def create_user(actor: dict, login_id: str, password: str, role_name: str, username: str) -> dict:
    """The Login ID is a plain ID, not an email (stored in the legacy `email` column)."""
    _ensure(actor, {"Admin"})
    if role_name not in ROLES:
        raise AppError(400, "Unknown role")
    if len(password) < 8:
        raise AppError(400, "Password must be at least 8 characters")
    cleaned = login_id.strip()
    if not LOGIN_ID_PATTERN.fullmatch(cleaned):
        raise AppError(400, "Login ID must be 3-64 letters or numbers, with no spaces or special characters")
    if db.fetchone("SELECT user_id FROM users WHERE lower(email) = ?", [cleaned.lower()]):
        raise AppError(400, "A user with that Login ID already exists")
    user_id = str(uuid.uuid4())
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    db.exec_sql(
        """
        INSERT INTO users (user_id, username, email, password_hash, role_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [user_id, username.strip() or cleaned, cleaned, hashed, role_name, _now()],
    )
    gcs.upload_db()
    row = db.fetchone("SELECT * FROM users WHERE user_id = ?", [user_id])
    return public_user(row)


def _admin_count() -> int:
    row = db.fetchone("SELECT count(*) AS c FROM users WHERE role_name = 'Admin'")
    return row["c"] if row else 0


def update_user(actor: dict, user_id: str, username: str, role_name: str) -> dict:
    """Only the display name and role can change; the Login ID is fixed."""
    _ensure(actor, {"Admin"})
    row = db.fetchone("SELECT * FROM users WHERE user_id = ?", [user_id])
    if row is None:
        raise AppError(404, "User not found")
    if role_name not in ROLES:
        raise AppError(400, "Unknown role")
    cleaned = username.strip()
    if not cleaned:
        raise AppError(400, "Name is required")
    if len(cleaned) > 100:
        raise AppError(400, "Name must be 100 characters or fewer")
    if row["role_name"] == "Admin" and role_name != "Admin" and _admin_count() <= 1:
        raise AppError(400, "The last admin cannot be demoted")
    db.exec_sql("UPDATE users SET username = ?, role_name = ? WHERE user_id = ?", [cleaned, role_name, user_id])
    gcs.upload_db()
    return public_user(db.fetchone("SELECT * FROM users WHERE user_id = ?", [user_id]))


def delete_user(actor: dict, user_id: str) -> None:
    _ensure(actor, {"Admin"})
    if actor["user_id"] == user_id:
        raise AppError(400, "You cannot delete your own account")
    row = db.fetchone("SELECT * FROM users WHERE user_id = ?", [user_id])
    if row is None:
        raise AppError(404, "User not found")
    if row["role_name"] == "Admin" and _admin_count() <= 1:
        raise AppError(400, "The last admin cannot be deleted")
    db.exec_sql("DELETE FROM users WHERE user_id = ?", [user_id])
    gcs.upload_db()
