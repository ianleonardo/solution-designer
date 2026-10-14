"""Project documents: each project holds one document per layout (SDD, Interface Specifications, ...)."""

import json
import uuid
from datetime import datetime, timezone

from app import db
from app.config import CONTENT_AUTHORS, WRITERS
from app.content import blank_content, sanitize_content
from app.errors import AppError
from app.missing import evaluate_missing
from app.services import gcs

_SELECT = """
    SELECT d.*, l.name AS name
    FROM project_documents d JOIN document_layouts l ON l.layout_id = d.layout_id
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure(user: dict, roles: set[str]) -> None:
    if user["role_name"] not in roles:
        raise AppError(403, "Forbidden")


def require_project(project_id: str) -> None:
    if db.fetchone("SELECT project_id FROM projects WHERE project_id = ?", [project_id]) is None:
        raise AppError(404, "Project not found")


def document_row(project_id: str, document_id: str | None = None) -> dict:
    """The requested document, or the project's first one when no id is given (legacy routes)."""
    require_project(project_id)
    if document_id:
        row = db.fetchone(f"{_SELECT} WHERE d.project_id = ? AND d.document_id = ?", [project_id, document_id])
    else:
        row = db.fetchone(
            f"{_SELECT} WHERE d.project_id = ? ORDER BY (d.layout_id = 'sdd') DESC, d.created_at, d.document_id LIMIT 1",
            [project_id],
        )
    if row is None:
        raise AppError(404, "Document not found")
    return row


def document_templates(row: dict) -> list[dict]:
    """The document's own sections. The layout is copied when the document is created, so layout edits never reach it."""
    raw = row.get("structure_json")
    if raw is None:
        # A row written before snapshots existed: copy the layout as it is now, once.
        snapshot = db.layout_snapshot(row["layout_id"])
        db.exec_sql(
            "UPDATE project_documents SET structure_json = ? WHERE document_id = ?",
            [json.dumps(snapshot), row["document_id"]],
        )
    else:
        snapshot = json.loads(raw) if isinstance(raw, str) else raw
    return sorted(snapshot, key=lambda item: item["sequence_order"])


def public_section(item: dict) -> dict:
    """A section as the workspace needs it: the public template fields plus its block layout and hint."""
    result = db.public_template(item)
    result["blocks"] = item["schema_json"]["blocks"]
    result["hint"] = item.get("hint") or ""
    return result


def payload(row: dict, with_templates: bool = False) -> dict:
    """API shape of a document. Content is reconciled with the layout as it is today."""
    templates = document_templates(row)
    content = row["content_json"]
    if isinstance(content, str):
        content = json.loads(content)
    result = {
        "document_id": row["document_id"],
        "sdd_id": row["document_id"],
        "project_id": row["project_id"],
        "layout_id": row["layout_id"],
        "name": row["name"],
        "content_json": sanitize_content(content, templates),
        "status": row["status"],
        "last_modified": row["last_modified"],
        "generated_at": row["generated_at"],
        "submitted_by": row["submitted_by"],
        "approved_by": row["approved_by"],
        "approved_at": row["approved_at"],
    }
    if with_templates:
        result["templates"] = [public_section(item) for item in templates]
    return result


def list_documents(project_id: str, with_templates: bool = False) -> list[dict]:
    require_project(project_id)
    rows = db.fetchall(
        f"{_SELECT} WHERE d.project_id = ? ORDER BY (d.layout_id = 'sdd') DESC, d.created_at, d.document_id",
        [project_id],
    )
    return [payload(row, with_templates) for row in rows]


def refresh_project_status(project_id: str) -> str:
    """The project shows the least advanced state of its documents."""
    rows = db.fetchall("SELECT status FROM project_documents WHERE project_id = ?", [project_id])
    statuses = {row["status"] for row in rows}
    if "pending_approval" in statuses:
        status = "pending_approval"
    elif statuses and statuses == {"approved"}:
        status = "approved"
    else:
        status = "draft"
    db.exec_sql("UPDATE projects SET status = ?, last_modified = ? WHERE project_id = ?", [status, _now(), project_id])
    return status


def create_blank(project_id: str, layout_id: str, now: datetime | None = None) -> str:
    templates = db.layout_snapshot(layout_id)
    if not templates:
        raise AppError(400, "That layout has no sections yet")
    document_id = str(uuid.uuid4())
    moment = now or _now()
    db.exec_sql(
        """
        INSERT INTO project_documents (
            document_id, project_id, layout_id, content_json, status, last_modified, generated_at,
            submitted_by, approved_by, approved_at, created_at, structure_json
        ) VALUES (?, ?, ?, ?, 'draft', ?, NULL, NULL, NULL, NULL, ?, ?)
        """,
        [document_id, project_id, layout_id, json.dumps(blank_content(templates)), moment, moment, json.dumps(templates)],
    )
    return document_id


def create_document(user: dict, project_id: str, layout_id: str) -> dict:
    _ensure(user, CONTENT_AUTHORS)
    require_project(project_id)
    if db.fetchone("SELECT layout_id FROM document_layouts WHERE layout_id = ?", [layout_id]) is None:
        raise AppError(404, "Layout not found")
    if db.fetchone(
        "SELECT document_id FROM project_documents WHERE project_id = ? AND layout_id = ?", [project_id, layout_id]
    ):
        raise AppError(400, "This project already has that document")
    document_id = create_blank(project_id, layout_id)
    refresh_project_status(project_id)
    gcs.upload_db()
    return payload(document_row(project_id, document_id), with_templates=True)


def delete_document(user: dict, project_id: str, document_id: str) -> None:
    _ensure(user, CONTENT_AUTHORS)
    document_row(project_id, document_id)
    count = db.fetchone("SELECT count(*) AS c FROM project_documents WHERE project_id = ?", [project_id])
    if count and count["c"] <= 1:
        raise AppError(400, "A project needs at least one document")
    db.exec_sql("DELETE FROM project_documents WHERE document_id = ?", [document_id])
    refresh_project_status(project_id)
    gcs.upload_db()


def save(user: dict, project_id: str, document_id: str | None, content: dict) -> dict:
    _ensure(user, CONTENT_AUTHORS)
    current = document_row(project_id, document_id)
    sanitized = sanitize_content(content, document_templates(current))
    status = current["status"]
    submitted_by = current["submitted_by"]
    approved_by = current["approved_by"]
    approved_at = current["approved_at"]
    if user["role_name"] != "Admin" and status in {"approved", "pending_approval"}:
        status = "draft"
        submitted_by = None
        approved_by = None
        approved_at = None
    db.exec_sql(
        """
        UPDATE project_documents
        SET content_json = ?, status = ?, last_modified = ?, submitted_by = ?, approved_by = ?, approved_at = ?
        WHERE document_id = ?
        """,
        [json.dumps(sanitized), status, _now(), submitted_by, approved_by, approved_at, current["document_id"]],
    )
    refresh_project_status(project_id)
    gcs.upload_db()
    return payload(document_row(project_id, current["document_id"]))


# --- Sections of one document -------------------------------------------------------------------------------------
# The structure (sections, their order and block layout, prompts) belongs to the document. Editing it never touches
# the layout, and a layout edit never touches it.

PROMPT_FIELDS = {"system_prompt", "temperature", "max_words", "hint"}
STRUCTURE_FIELDS = {"section_name", "blocks"}


def _renumber(templates: list[dict]) -> list[dict]:
    """Rewrite sequence_order as 100, 200, ... for sections and 101, 102, ... for their sub-sections."""
    top = sorted((item for item in templates if not item["parent_id"]), key=lambda item: item["sequence_order"])
    result: list[dict] = []
    for index, parent in enumerate(top, start=1):
        result.append({**parent, "sequence_order": index * 100})
        children = sorted(
            (item for item in templates if item["parent_id"] == parent["template_id"]),
            key=lambda item: item["sequence_order"],
        )
        for child_index, child in enumerate(children, start=1):
            result.append({**child, "sequence_order": index * 100 + child_index})
    return result


def _store_structure(
    user: dict, current: dict, templates: list[dict], content_changed: bool = True
) -> dict:
    """Save a new structure with the content re-fitted to it. Content authors' edits send the document back to draft."""
    ordered = _renumber(templates)
    content = sanitize_content(json.loads(current["content_json"]), ordered)
    status = current["status"]
    submitted_by, approved_by, approved_at = current["submitted_by"], current["approved_by"], current["approved_at"]
    if content_changed and user["role_name"] != "Admin" and status in {"approved", "pending_approval"}:
        status, submitted_by, approved_by, approved_at = "draft", None, None, None
    db.exec_sql(
        """
        UPDATE project_documents
        SET structure_json = ?, content_json = ?, status = ?, last_modified = ?,
            submitted_by = ?, approved_by = ?, approved_at = ?
        WHERE document_id = ?
        """,
        [
            json.dumps(ordered),
            json.dumps(content),
            status,
            _now(),
            submitted_by,
            approved_by,
            approved_at,
            current["document_id"],
        ],
    )
    refresh_project_status(current["project_id"])
    gcs.upload_db()
    return payload(document_row(current["project_id"], current["document_id"]), with_templates=True)


def _find(templates: list[dict], section_id: str) -> dict:
    item = next((entry for entry in templates if entry["template_id"] == section_id), None)
    if item is None:
        raise AppError(404, "Section not found")
    return item


def add_section(user: dict, project_id: str, document_id: str, body: dict) -> dict:
    from app.services import layouts

    _ensure(user, CONTENT_AUTHORS)
    current = document_row(project_id, document_id)
    templates = document_templates(current)
    name = layouts.clean_section_name(body.get("section_name"))
    parent_id = body.get("parent_id") or None
    parent = None
    if parent_id:
        parent = _find(templates, parent_id)
        if parent["parent_id"]:
            raise AppError(400, "Sub-sections cannot be nested further")
    blocks = layouts.normalize_blocks(body.get("blocks") or [{"type": "prose"}])
    fields = layouts.clean_prompt_fields(body)
    hint = fields.get("hint", "")
    used = {item["template_id"] for item in templates}
    identifier = f"s-{uuid.uuid4().hex[:8]}"
    while identifier in used:
        identifier = f"s-{uuid.uuid4().hex[:8]}"
    if parent:
        sequence = parent["sequence_order"] + 99
    else:
        top = [item["sequence_order"] for item in templates if not item["parent_id"]]
        sequence = (max(top) + 100) if top else 100
    section = {
        "layout_id": current["layout_id"],
        "template_id": identifier,
        "parent_id": parent_id,
        "section_name": name,
        "sequence_order": sequence,
        "system_prompt": fields.get("system_prompt") or db.default_section_prompt(current["name"], name, hint),
        "temperature": fields.get("temperature", 0.2),
        "max_words": fields.get("max_words", 2000),
        "content_kind": db.kind_from_blocks(blocks),
        "schema_json": {"blocks": blocks},
        "hint": hint,
    }
    return _store_structure(user, current, [*templates, section])


def update_section(user: dict, project_id: str, document_id: str, section_id: str, body: dict) -> dict:
    """Rename, change the block layout or the prompt of one section. Admin may change the prompt fields only."""
    from app.services import layouts

    wanted = set(body) & (PROMPT_FIELDS | STRUCTURE_FIELDS)
    if user["role_name"] == "Admin" and not wanted <= PROMPT_FIELDS:
        raise AppError(403, "Forbidden")
    if user["role_name"] != "Admin":
        _ensure(user, CONTENT_AUTHORS)
    current = document_row(project_id, document_id)
    templates = document_templates(current)
    section = _find(templates, section_id)
    values = layouts.clean_prompt_fields(body)
    if "section_name" in body:
        values["section_name"] = layouts.clean_section_name(body.get("section_name"))
    if "blocks" in body:
        blocks = layouts.normalize_blocks(body.get("blocks"))
        values["schema_json"] = {"blocks": blocks}
        values["content_kind"] = db.kind_from_blocks(blocks)
    updated = [{**item, **values} if item["template_id"] == section["template_id"] else item for item in templates]
    return _store_structure(user, current, updated, content_changed=bool(wanted & STRUCTURE_FIELDS))


def delete_section(user: dict, project_id: str, document_id: str, section_id: str) -> dict:
    _ensure(user, CONTENT_AUTHORS)
    current = document_row(project_id, document_id)
    templates = document_templates(current)
    _find(templates, section_id)
    remaining = [item for item in templates if item["template_id"] != section_id and item["parent_id"] != section_id]
    if not remaining:
        raise AppError(400, "A document needs at least one section")
    return _store_structure(user, current, remaining)


def reorder_sections(user: dict, project_id: str, document_id: str, sections: list) -> dict:
    from app.services import layouts

    _ensure(user, CONTENT_AUTHORS)
    current = document_row(project_id, document_id)
    templates = document_templates(current)
    plan = layouts.plan_order(sections, {item["template_id"] for item in templates})
    by_id = {item["template_id"]: item for item in templates}
    moved = [{**by_id[identifier], "parent_id": parent_id, "sequence_order": sequence} for identifier, parent_id, sequence in plan]
    return _store_structure(user, current, moved)


def validate(user: dict, project_id: str, document_id: str | None) -> dict:
    if user["role_name"] not in WRITERS | {"Viewer"}:
        raise AppError(403, "Forbidden")
    row = document_row(project_id, document_id)
    content = evaluate_missing(sanitize_content(json.loads(row["content_json"]), document_templates(row)))
    if user["role_name"] in CONTENT_AUTHORS:
        db.exec_sql(
            "UPDATE project_documents SET content_json = ?, last_modified = ? WHERE document_id = ?",
            [json.dumps(content), _now(), row["document_id"]],
        )
    result = payload(document_row(project_id, row["document_id"]))
    result["content_json"] = content
    return result


def submit(user: dict, project_id: str, document_id: str | None) -> dict:
    _ensure(user, {"Maker", "Checker"})
    current = document_row(project_id, document_id)
    if current["status"] != "draft":
        raise AppError(400, "Only a draft can be submitted")
    db.exec_sql(
        """
        UPDATE project_documents
        SET status = 'pending_approval', submitted_by = ?, last_modified = ?
        WHERE document_id = ?
        """,
        [user["user_id"], _now(), current["document_id"]],
    )
    refresh_project_status(project_id)
    gcs.upload_db()
    return payload(document_row(project_id, current["document_id"]))


def approve(user: dict, project_id: str, document_id: str | None) -> dict:
    _ensure(user, {"Checker"})
    current = document_row(project_id, document_id)
    if current["status"] != "pending_approval":
        raise AppError(400, "Checker approval requires a submitted document")
    now = _now()
    db.exec_sql(
        """
        UPDATE project_documents
        SET status = 'approved', approved_by = ?, approved_at = ?, last_modified = ?
        WHERE document_id = ?
        """,
        [user["user_id"], now, now, current["document_id"]],
    )
    refresh_project_status(project_id)
    gcs.upload_db()
    return payload(document_row(project_id, current["document_id"]))


def status_after_generation(row: dict, user: dict) -> str:
    return row["status"] if user["role_name"] == "Admin" else "draft"


def save_generated(row: dict, content: dict, status: str) -> None:
    now = _now()
    db.exec_sql(
        """
        UPDATE project_documents
        SET content_json = ?, last_modified = ?, generated_at = ?, status = ?
        WHERE document_id = ?
        """,
        [json.dumps(content), now, now, status, row["document_id"]],
    )
    refresh_project_status(row["project_id"])
