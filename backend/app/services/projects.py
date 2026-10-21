import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import bcrypt

from app import db
from app.config import data_dir, kb_countries
from app.errors import AppError
from app.permissions import LEGACY_ROLES, require
from app.seed_layouts import SDD_LAYOUT_ID
from app.services import documents, files, gcs, images, layouts, ldap_auth, project_rag
from app.services.files import PREFIX


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure(user: dict, area: str) -> None:
    require(user, area, "write")


def _role_names() -> dict[str, str]:
    return {row["role_id"]: row["name"] for row in db.fetchall("SELECT role_id, name FROM roles")}


def public_user(row: dict, names: dict[str, str] | None = None) -> dict:
    names = names if names is not None else _role_names()
    return {
        "user_id": row["user_id"],
        "username": row["username"],
        "login_id": row["email"],
        "role_id": row["role_name"],
        "role_name": names.get(row["role_name"], row["role_name"]),
        "auth_provider": (row.get("auth_provider") or "local"),
        "created_at": row["created_at"],
    }


def _password_matches(hashed: str, password: str) -> bool:
    if not password or not hashed or not str(hashed).startswith("$2"):
        return False
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def authenticate(login_id: str, password: str) -> dict:
    row = db.fetchone("SELECT * FROM users WHERE lower(email) = ?", [login_id.strip().lower()])
    if row is None:
        raise AppError(401, "Invalid login ID or password")
    if (row.get("auth_provider") or "local") == "ldap":
        display_name = ldap_auth.authenticate(row["email"], password).strip()[:100]
        if display_name and display_name != row["username"]:
            db.exec_sql("UPDATE users SET username = ? WHERE user_id = ?", [display_name, row["user_id"]])
            gcs.upload_db()
            row = db.fetchone("SELECT * FROM users WHERE user_id = ?", [row["user_id"]])
        return public_user(row)
    if not _password_matches(row["password_hash"], password):
        raise AppError(401, "Invalid login ID or password")
    return public_user(row)


def _codes(value) -> list[str]:
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def project_row(row: dict) -> dict:
    return {
        "project_id": row["project_id"],
        "project_name": row["project_name"],
        "description": row.get("description") or "",
        "countries": _codes(row.get("countries")),
        "systems": _codes(row.get("systems")),
        "owner_id": row["owner_id"],
        "owner_name": row.get("owner_name"),
        "owner_role": row.get("owner_role"),
        "created_at": row["created_at"],
        "last_modified": row["last_modified"],
    }


def list_projects() -> list[dict]:
    rows = db.fetchall(
        """
        SELECT p.*, u.username AS owner_name, COALESCE(r.name, u.role_name) AS owner_role
        FROM projects p JOIN users u ON u.user_id = p.owner_id LEFT JOIN roles r ON r.role_id = u.role_name
        ORDER BY p.last_modified DESC
        """
    )
    return [project_row(row) for row in rows]


def _rag_country(parsed) -> str:
    """Best-effort country from a rag_inventory parsed_json blob."""
    data = parsed
    if isinstance(parsed, str):
        try:
            data = json.loads(parsed) if parsed else {}
        except json.JSONDecodeError:
            data = {}
    if not isinstance(data, dict):
        return "Unspecified"
    raw = ""
    for key, value in data.items():
        if str(key).strip().lower() == "country":
            raw = str(value or "").strip()
            break
    if not raw:
        return "Unspecified"
    lookup = {item.lower(): item for item in kb_countries()}
    return lookup.get(raw.lower(), raw.upper())


def _kb_counts_by_country() -> list[dict]:
    """Per-country counts for capabilities, interfaces, tables, batches and reports.

    An item's country may be one code, a comma list ("SG,MY") or empty / "ALL" meaning every country.
    A list counts once towards each listed country; an all-country item counts once towards every country.
    """
    catalog = list(kb_countries())
    lookup = {code.lower(): code for code in catalog}
    counts: dict[str, dict[str, int]] = {}

    def row_for(country: str) -> dict[str, int]:
        return counts.setdefault(
            country,
            {"country": country, "capabilities": 0, "interfaces": 0, "tables": 0, "batches": 0, "reports": 0},
        )

    for country in catalog:
        row_for(country)

    def targets(raw) -> list[str]:
        codes = []
        for part in str(raw or "").split(","):
            code = part.strip()
            if not code:
                continue
            if code.lower() == "all":
                return catalog
            normalised = lookup.get(code.lower(), code.upper())
            if normalised not in codes:
                codes.append(normalised)
        return codes or catalog

    sources = {
        "capabilities": "kb_capabilities",
        "interfaces": "interfaces",
        "tables": "kb_tables",
        "batches": "kb_batches",
        "reports": "kb_reports",
    }
    for field, table in sources.items():
        for item in db.fetchall(f"SELECT country, COUNT(*) AS c FROM {table} GROUP BY country"):
            for country in targets(item["country"]):
                row_for(country)[field] += int(item["c"])

    catalog_set = set(catalog)
    extras = sorted((counts[c] for c in counts if c not in catalog_set), key=lambda item: item["country"])
    return [counts[c] for c in catalog] + extras


def dashboard() -> dict:
    total = db.fetchone("SELECT count(*) AS c FROM projects")
    documents_total = db.fetchone("SELECT count(*) AS c FROM project_documents")
    return {
        "total_projects": total["c"] if total else 0,
        "total_documents": documents_total["c"] if documents_total else 0,
        "kb_by_country": _kb_counts_by_country(),
    }


def _require_project(project_id: str) -> dict:
    row = db.fetchone(
        """
        SELECT p.*, u.username AS owner_name, COALESCE(r.name, u.role_name) AS owner_role
        FROM projects p JOIN users u ON u.user_id = p.owner_id LEFT JOIN roles r ON r.role_id = u.role_name
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


def _clean_scope(values, allowed: set[str], label: str) -> str:
    """A comma list of known codes, in the order given. Empty means the project covers all of them."""
    if values is None:
        return ""
    if isinstance(values, str):
        values = values.split(",")
    lookup = {code.lower(): code for code in allowed}
    result: list[str] = []
    for value in values:
        code = str(value or "").strip()
        if not code:
            continue
        known = lookup.get(code.lower())
        if known is None:
            raise AppError(400, f"Unknown {label}: {code}")
        if known not in result:
            result.append(known)
    return ",".join(result)


def _known_systems() -> set[str]:
    return {row["system_code"] for row in db.fetchall("SELECT system_code FROM systems")}


def create_project(
    user: dict, name: str, description: str = "", countries: list[str] | None = None, systems: list[str] | None = None
) -> dict:
    _ensure(user, "projects")
    cleaned = name.strip()
    summary = _clean_description(description)
    country_scope = _clean_scope(countries, set(kb_countries()), "country")
    system_scope = _clean_scope(systems, _known_systems(), "system")
    if not cleaned:
        raise AppError(400, "Project name is required")
    if len(cleaned) > 200:
        raise AppError(400, "Project name must be 200 characters or fewer")
    project_id = str(uuid.uuid4())
    now = _now()
    db.exec_sql(
        """
        INSERT INTO projects (
            project_id, project_name, description, countries, systems, owner_id, status, created_at, last_modified
        )
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
        """,
        [project_id, cleaned, summary, country_scope, system_scope, user["user_id"], now, now],
    )
    documents.create_blank(project_id, SDD_LAYOUT_ID, now)
    gcs.upload_db()
    return project_row(_require_project(project_id))


def update_project(
    user: dict,
    project_id: str,
    name: str | None = None,
    description: str | None = None,
    countries: list[str] | None = None,
    systems: list[str] | None = None,
) -> dict:
    _ensure(user, "projects")
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
    if countries is not None:
        assignments.append("countries = ?")
        params.append(_clean_scope(countries, set(kb_countries()), "country"))
    if systems is not None:
        assignments.append("systems = ?")
        params.append(_clean_scope(systems, _known_systems(), "system"))
    params.append(project_id)
    db.exec_sql(
        f"UPDATE projects SET {', '.join(assignments)} WHERE project_id = ?",
        params,
    )
    gcs.upload_db()
    return project_row(_require_project(project_id))


def delete_project(user: dict, project_id: str) -> None:
    _ensure(user, "projects")
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
    _ensure(user, "projects")
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
    _ensure(user, "projects")
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


_BASELINE_MEDIA = {
    "md": "text/markdown",
    "markdown": "text/markdown",
    "txt": "text/plain",
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
}


def original_baseline_file(project_id: str, doc_id: str) -> tuple[Path, str, str]:
    """Path, download name and media type of an uploaded project reference."""
    _require_project(project_id)
    row = db.fetchone(
        "SELECT * FROM baseline_docs WHERE project_id = ? AND doc_id = ?",
        [project_id, doc_id],
    )
    if row is None:
        raise AppError(404, "Reference not found")
    stored = Path(row["storage_path"])
    object_name = f"uploads/baselines/{project_id}/{stored.name}"
    if not stored.is_file() and not gcs.fetch_file(stored, object_name):
        raise AppError(404, "The original file could not be found in storage.")
    name = row["file_name"] or stored.name
    file_type = (row["file_type"] or Path(name).suffix.lstrip(".")).lower()
    return stored, name, _BASELINE_MEDIA.get(file_type, "application/octet-stream")


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
    _ensure(user, "knowledge")
    if inventory_type is not None and inventory_type not in files.INVENTORY_TYPES:
        raise AppError(400, "Unknown inventory type")
    if inventory_type == "Guidelines":
        raise AppError(400, "Add guidelines from the Guidelines page (they need a title and description).")
    if inventory_type == "Reports":
        raise AppError(400, "Add reports from the Reports page (upload Excel by country and system).")
    if inventory_type == "Batches":
        raise AppError(400, "Add batches from the Batches page (upload Excel by country and system).")
    if inventory_type == "Capabilities":
        raise AppError(400, "Add capabilities from the Capabilities page (upload Excel by country and system).")
    if inventory_type == "Tables":
        raise AppError(400, "Add tables from the Tables page.")
    if inventory_type == "Bitbucket Repos":
        raise AppError(400, "Add Bitbucket repositories from the Bitbucket Repositories page (upload Excel on the project tab).")
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
    _ensure(user, "knowledge")
    row = db.fetchone("SELECT rag_id FROM rag_inventory WHERE rag_id = ?", [rag_id])
    if row is None:
        raise AppError(404, "Inventory record not found")
    db.exec_sql("DELETE FROM rag_inventory WHERE rag_id = ?", [rag_id])
    gcs.upload_db()


def list_users(user: dict) -> list[dict]:
    require(user, "settings", "read")
    names = _role_names()
    return [public_user(row, names) for row in db.fetchall("SELECT * FROM users ORDER BY created_at")]


LOGIN_ID_PATTERN = re.compile(r"^[A-Za-z0-9]{3,64}$")
UNUSABLE_PASSWORD = "!"


def _provider(value: str) -> str:
    provider = (value or "local").strip().lower()
    if provider == "local":
        return "local"
    if provider == "ldap":
        return "ldap"
    raise AppError(400, "Sign-in must be local or Active Directory (LDAP).")


def create_user(actor: dict, login_id: str, password: str, role_name: str, username: str, auth_provider: str = "local") -> dict:
    """The Login ID is a plain ID, not an email (stored in the legacy `email` column)."""
    _ensure(actor, "settings")
    role_name = _known_role(role_name)
    provider = _provider(auth_provider)
    cleaned = login_id.strip()
    if not LOGIN_ID_PATTERN.fullmatch(cleaned):
        raise AppError(400, "Login ID must be 3-64 letters or numbers, with no spaces or special characters")
    if db.fetchone("SELECT user_id FROM users WHERE lower(email) = ?", [cleaned.lower()]):
        raise AppError(400, "A user with that Login ID already exists")
    if provider == "ldap":
        if password.strip():
            raise AppError(400, "Active Directory users sign in through LDAP. Do not set a password.")
        if not ldap_auth.configured():
            raise AppError(400, "LDAP is not configured. Set LDAP_HOST in the environment.")
        hashed = UNUSABLE_PASSWORD
    else:
        if len(password) < 8:
            raise AppError(400, "Password must be at least 8 characters")
        hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user_id = str(uuid.uuid4())
    db.exec_sql(
        """
        INSERT INTO users (user_id, username, email, password_hash, role_name, auth_provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [user_id, username.strip() or cleaned, cleaned, hashed, role_name, provider, _now()],
    )
    gcs.upload_db()
    row = db.fetchone("SELECT * FROM users WHERE user_id = ?", [user_id])
    return public_user(row)


def _known_role(value: str) -> str:
    """The role id for a role id, a role name (any case) or one of the old fixed role names."""
    text = str(value or "").strip()
    row = db.fetchone("SELECT role_id FROM roles WHERE role_id = ?", [text]) or db.fetchone(
        "SELECT role_id FROM roles WHERE lower(name) = lower(?)", [text]
    )
    if row is None and text in LEGACY_ROLES:
        row = db.fetchone("SELECT role_id FROM roles WHERE role_id = ?", [LEGACY_ROLES[text]])
    if row is None:
        raise AppError(400, "Unknown role")
    return row["role_id"]


def _manages_settings(role_id: str) -> bool:
    row = db.fetchone("SELECT settings FROM roles WHERE role_id = ?", [role_id])
    return bool(row) and row["settings"] == "write"


def _admin_count() -> int:
    """Users whose role can change settings (and so manage users and roles)."""
    row = db.fetchone("SELECT count(*) AS c FROM users u JOIN roles r ON r.role_id = u.role_name WHERE r.settings = 'write'")
    return row["c"] if row else 0


def update_user(actor: dict, user_id: str, username: str, role_name: str, password: str = "", auth_provider: str | None = None) -> dict:
    """The display name, role, sign-in method, and password can change. The Login ID is fixed.

    A blank password is left as it is for a local user. An Active Directory user has no stored password.
    """
    _ensure(actor, "settings")
    row = db.fetchone("SELECT * FROM users WHERE user_id = ?", [user_id])
    if row is None:
        raise AppError(404, "User not found")
    role_name = _known_role(role_name)
    cleaned = username.strip()
    if not cleaned:
        raise AppError(400, "Name is required")
    if len(cleaned) > 100:
        raise AppError(400, "Name must be 100 characters or fewer")
    if _manages_settings(row["role_name"]) and not _manages_settings(role_name) and _admin_count() <= 1:
        raise AppError(400, "The last user who can manage settings cannot lose that role")
    current_provider = (row.get("auth_provider") or "local").strip().lower()
    provider = _provider(auth_provider) if auth_provider is not None else current_provider
    new_password = password.strip()
    if provider == "ldap":
        if new_password:
            raise AppError(400, "Active Directory users sign in through LDAP. Do not set a password.")
        if not ldap_auth.configured():
            raise AppError(400, "LDAP is not configured. Set LDAP_HOST in the environment.")
        db.exec_sql(
            "UPDATE users SET username = ?, role_name = ?, auth_provider = ?, password_hash = ? WHERE user_id = ?",
            [cleaned, role_name, provider, UNUSABLE_PASSWORD, user_id],
        )
    elif current_provider == "ldap" and not new_password:
        raise AppError(400, "Set a password when changing this user to a local sign-in.")
    elif new_password:
        if len(new_password) < 8:
            raise AppError(400, "Password must be at least 8 characters")
        hashed = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
        db.exec_sql(
            "UPDATE users SET username = ?, role_name = ?, auth_provider = ?, password_hash = ? WHERE user_id = ?",
            [cleaned, role_name, provider, hashed, user_id],
        )
    else:
        db.exec_sql(
            "UPDATE users SET username = ?, role_name = ?, auth_provider = ? WHERE user_id = ?",
            [cleaned, role_name, provider, user_id],
        )
    gcs.upload_db()
    return public_user(db.fetchone("SELECT * FROM users WHERE user_id = ?", [user_id]))


def delete_user(actor: dict, user_id: str) -> None:
    _ensure(actor, "settings")
    if actor["user_id"] == user_id:
        raise AppError(400, "You cannot delete your own account")
    row = db.fetchone("SELECT * FROM users WHERE user_id = ?", [user_id])
    if row is None:
        raise AppError(404, "User not found")
    if _manages_settings(row["role_name"]) and _admin_count() <= 1:
        raise AppError(400, "The last user who can manage settings cannot be deleted")
    db.exec_sql("DELETE FROM users WHERE user_id = ?", [user_id])
    gcs.upload_db()
