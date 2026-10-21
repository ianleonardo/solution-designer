"""Project documents: one per layout, or several when the layout allows multiple (SDD, Interface Specifications, ...)."""

import json
import uuid
from datetime import datetime, timezone

from app import db
from app.content import blank_content, sanitize_content
from app.errors import AppError
from app.missing import evaluate_missing
from app.permissions import can, require
from app.services import gcs, kb_links

_SELECT = """
    SELECT d.*, COALESCE(NULLIF(trim(d.title), ''), l.name) AS name, l.name AS layout_name
    FROM project_documents d JOIN document_layouts l ON l.layout_id = d.layout_id
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_writer(user: dict) -> None:
    require(user, "projects", "write")


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
    """API shape of a document. Content follows the document's own section copy, not the live layout."""
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
        "layout_name": row["layout_name"],
        "content_json": kb_links.annotate(sanitize_content(content, templates)),
        "last_modified": row["last_modified"],
        "generated_at": row["generated_at"],
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


def touch_project(project_id: str) -> None:
    """Record that something in the project changed."""
    db.exec_sql("UPDATE projects SET last_modified = ? WHERE project_id = ?", [_now(), project_id])


def create_blank(project_id: str, layout_id: str, now: datetime | None = None, title: str = "") -> str:
    templates = db.layout_snapshot(layout_id)
    if not templates:
        raise AppError(400, "That layout has no sections yet")
    document_id = str(uuid.uuid4())
    moment = now or _now()
    db.exec_sql(
        """
        INSERT INTO project_documents (
            document_id, project_id, layout_id, title, content_json, status, last_modified, generated_at,
            submitted_by, approved_by, approved_at, created_at, structure_json
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, NULL, NULL, NULL, NULL, ?, ?)
        """,
        [document_id, project_id, layout_id, title, json.dumps(blank_content(templates)), moment, moment, json.dumps(templates)],
    )
    return document_id


def _document_title(project_id: str, layout: dict, title: str) -> str:
    """The stored title for a new copy. Empty means the tab shows the layout name; extra copies need a distinct name."""
    cleaned = " ".join((title or "").split())
    if len(cleaned) > 100:
        raise AppError(400, "Document name must be 100 characters or fewer")
    taken = {
        row["name"].lower()
        for row in db.fetchall(f"{_SELECT} WHERE d.project_id = ?", [project_id])
    }
    if not cleaned:
        if layout["name"].lower() not in taken:
            return ""
        number = 2
        while f"{layout['name']} {number}".lower() in taken:
            number += 1
        return f"{layout['name']} {number}"
    if cleaned.lower() in taken:
        raise AppError(400, "This project already has a document with that name")
    return "" if cleaned == layout["name"] else cleaned


def create_document(user: dict, project_id: str, layout_id: str, title: str = "") -> dict:
    _ensure_writer(user)
    require_project(project_id)
    layout = db.fetchone("SELECT layout_id, name, allow_multiple FROM document_layouts WHERE layout_id = ?", [layout_id])
    if layout is None:
        raise AppError(404, "Layout not found")
    existing = db.fetchone(
        "SELECT document_id FROM project_documents WHERE project_id = ? AND layout_id = ?", [project_id, layout_id]
    )
    if existing and not layout["allow_multiple"]:
        raise AppError(400, "This project already has that document")
    document_id = create_blank(project_id, layout_id, title=_document_title(project_id, layout, title))
    touch_project(project_id)
    gcs.upload_db()
    return payload(document_row(project_id, document_id), with_templates=True)


def delete_document(user: dict, project_id: str, document_id: str) -> None:
    _ensure_writer(user)
    document_row(project_id, document_id)
    count = db.fetchone("SELECT count(*) AS c FROM project_documents WHERE project_id = ?", [project_id])
    if count and count["c"] <= 1:
        raise AppError(400, "A project needs at least one document")
    db.exec_sql("DELETE FROM project_documents WHERE document_id = ?", [document_id])
    touch_project(project_id)
    gcs.upload_db()


def save(user: dict, project_id: str, document_id: str | None, content: dict) -> dict:
    _ensure_writer(user)
    current = document_row(project_id, document_id)
    sanitized = sanitize_content(content, document_templates(current))
    db.exec_sql(
        "UPDATE project_documents SET content_json = ?, last_modified = ? WHERE document_id = ?",
        [json.dumps(sanitized), _now(), current["document_id"]],
    )
    touch_project(project_id)
    gcs.upload_db()
    return payload(document_row(project_id, current["document_id"]))


# --- Sections of one document -------------------------------------------------------------------------------------
# The structure (sections, their order and block layout, prompts) belongs to the document. Editing it never touches
# the layout, and a layout edit never touches it.

PROMPT_FIELDS = {"system_prompt", "temperature", "max_words", "hint"}
STRUCTURE_FIELDS = {"section_name", "blocks"}


def _renumber(templates: list[dict]) -> list[dict]:
    """Rewrite sequence_order in reading order so a parent stays before its descendants."""
    grouped: dict[str | None, list[dict]] = {}
    for item in templates:
        grouped.setdefault(item.get("parent_id") or None, []).append(item)
    result: list[dict] = []
    seen: set[str] = set()

    def walk(parent_id: str | None) -> None:
        kids = sorted(grouped.get(parent_id, []), key=lambda item: item["sequence_order"])
        for kid in kids:
            if kid["template_id"] in seen:
                continue
            seen.add(kid["template_id"])
            result.append({**kid, "sequence_order": len(result) + 1})
            walk(kid["template_id"])

    walk(None)
    for item in sorted(templates, key=lambda entry: entry["sequence_order"]):
        if item["template_id"] in seen:
            continue
        seen.add(item["template_id"])
        result.append({**item, "parent_id": None, "sequence_order": len(result) + 1})
        walk(item["template_id"])
    return result


def _store_structure(current: dict, templates: list[dict]) -> dict:
    """Save a new structure with the content re-fitted to it."""
    ordered = _renumber(templates)
    content = sanitize_content(json.loads(current["content_json"]), ordered)
    db.exec_sql(
        "UPDATE project_documents SET structure_json = ?, content_json = ?, last_modified = ? WHERE document_id = ?",
        [json.dumps(ordered), json.dumps(content), _now(), current["document_id"]],
    )
    touch_project(current["project_id"])
    gcs.upload_db()
    return payload(document_row(current["project_id"], current["document_id"]), with_templates=True)


def _find(templates: list[dict], section_id: str) -> dict:
    item = next((entry for entry in templates if entry["template_id"] == section_id), None)
    if item is None:
        raise AppError(404, "Section not found")
    return item


def add_section(user: dict, project_id: str, document_id: str, body: dict) -> dict:
    from app.services import layouts

    _ensure_writer(user)
    current = document_row(project_id, document_id)
    templates = document_templates(current)
    name = layouts.clean_section_name(body.get("section_name"))
    parent_id = body.get("parent_id") or None
    parent = None
    if parent_id:
        parent = _find(templates, parent_id)
        layouts.ensure_child_depth(templates, parent_id)
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
    return _store_structure(current, [*templates, section])


def update_section(user: dict, project_id: str, document_id: str, section_id: str, body: dict) -> dict:
    """Rename, change the block layout or the prompt of one section. Admin may change the prompt fields only."""
    from app.services import layouts

    wanted = set(body) & (PROMPT_FIELDS | STRUCTURE_FIELDS)
    # project writers change anything; settings writers (who manage prompts) may change only the prompt fields
    if not can(user, "projects", "write"):
        if not (can(user, "settings", "write") and wanted <= PROMPT_FIELDS):
            raise AppError(403, "Forbidden")
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
    return _store_structure(current, updated)


def delete_section(user: dict, project_id: str, document_id: str, section_id: str) -> dict:
    from app.services import layouts

    _ensure_writer(user)
    current = document_row(project_id, document_id)
    templates = document_templates(current)
    _find(templates, section_id)
    removed = set(layouts.subtree_ids(templates, section_id))
    remaining = [item for item in templates if item["template_id"] not in removed]
    if not remaining:
        raise AppError(400, "A document needs at least one section")
    return _store_structure(current, remaining)


def reorder_sections(user: dict, project_id: str, document_id: str, sections: list) -> dict:
    from app.services import layouts

    _ensure_writer(user)
    current = document_row(project_id, document_id)
    templates = document_templates(current)
    plan = layouts.plan_order(sections, {item["template_id"] for item in templates})
    by_id = {item["template_id"]: item for item in templates}
    moved = [{**by_id[identifier], "parent_id": parent_id, "sequence_order": sequence} for identifier, parent_id, sequence in plan]
    return _store_structure(current, moved)


def validate(user: dict, project_id: str, document_id: str | None) -> dict:
    require(user, "projects", "read")
    row = document_row(project_id, document_id)
    content = evaluate_missing(sanitize_content(json.loads(row["content_json"]), document_templates(row)))
    if can(user, "projects", "write"):
        db.exec_sql(
            "UPDATE project_documents SET content_json = ?, last_modified = ? WHERE document_id = ?",
            [json.dumps(content), _now(), row["document_id"]],
        )
    result = payload(document_row(project_id, row["document_id"]))
    result["content_json"] = content
    return result


def save_generated(row: dict, content: dict) -> None:
    now = _now()
    db.exec_sql(
        "UPDATE project_documents SET content_json = ?, last_modified = ?, generated_at = ? WHERE document_id = ?",
        [json.dumps(content), now, now, row["document_id"]],
    )
    touch_project(row["project_id"])
