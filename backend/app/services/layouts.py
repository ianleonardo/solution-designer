"""Document layout management: layouts, their sections/sub-sections and block definitions."""

import json

from app import cache, db
from app.errors import AppError
from app.services import gcs
from app.template_parser import slugify

BLOCK_TYPES = ("header", "prose", "table", "image", "diagram")
MAX_BLOCKS = 12
MAX_COLUMNS = 12
SDD_LAYOUT_ID = "sdd"


def _admin(user: dict) -> None:
    if user["role_name"] != "Admin":
        raise AppError(403, "Forbidden")


def admin_template(row: dict) -> dict:
    payload = db.public_template(row)
    payload["blocks"] = row["schema_json"]["blocks"]
    payload["hint"] = row.get("hint") or ""
    return payload


def normalize_blocks(blocks) -> list[dict]:
    """Validate the block definitions of one section and return the canonical form."""
    if not isinstance(blocks, list) or not blocks:
        raise AppError(400, "A section needs at least one block")
    if len(blocks) > MAX_BLOCKS:
        raise AppError(400, f"A section can have at most {MAX_BLOCKS} blocks")
    result: list[dict] = []
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") not in BLOCK_TYPES:
            raise AppError(400, f"Block type must be one of: {', '.join(BLOCK_TYPES)}")
        kind = block["type"]
        if kind == "header":
            text = str(block.get("text") or "").strip()
            if len(text) > 200:
                raise AppError(400, "Header text must be 200 characters or fewer")
            try:
                level = int(block.get("level") or 1)
            except (TypeError, ValueError) as exc:
                raise AppError(400, "Header level must be 1, 2 or 3") from exc
            if level not in (1, 2, 3):
                raise AppError(400, "Header level must be 1, 2 or 3")
            result.append({"type": "header", "text": text, "level": level})
        elif kind == "prose":
            result.append({"type": "prose"})
        elif kind == "table":
            columns = [str(item or "").strip() for item in block.get("columns") or []]
            if not columns or any(not item for item in columns):
                raise AppError(400, "A table needs at least one named column")
            if len(columns) > MAX_COLUMNS:
                raise AppError(400, f"A table can have at most {MAX_COLUMNS} columns")
            rows = []
            for row in block.get("rows") or []:
                cells = [str(cell or "") for cell in row][: len(columns)]
                cells.extend([""] * (len(columns) - len(cells)))
                rows.append(cells)
            result.append({"type": "table", "columns": columns, "rows": rows or [[""] * len(columns)]})
        elif kind == "image":
            caption = str(block.get("caption") or "").strip()
            if len(caption) > 200:
                raise AppError(400, "Image caption must be 200 characters or fewer")
            result.append({"type": "image", "caption": caption})
        else:
            result.append({"type": "diagram", "sequence": bool(block.get("sequence"))})
    return result


def _layout_row(layout_id: str) -> dict:
    row = db.fetchone("SELECT * FROM document_layouts WHERE layout_id = ?", [layout_id])
    if row is None:
        raise AppError(404, "Layout not found")
    return row


def _layout_payload(row: dict) -> dict:
    sections = db.fetchone("SELECT count(*) AS c FROM layout_templates WHERE layout_id = ?", [row["layout_id"]])
    used = db.fetchone("SELECT count(*) AS c FROM project_documents WHERE layout_id = ?", [row["layout_id"]])
    return {
        "layout_id": row["layout_id"],
        "name": row["name"],
        "description": row["description"],
        "is_system": bool(row["is_system"]),
        "section_count": sections["c"] if sections else 0,
        "document_count": used["c"] if used else 0,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_layouts() -> list[dict]:
    rows = db.fetchall("SELECT * FROM document_layouts ORDER BY is_system DESC, created_at")
    return [_layout_payload(row) for row in rows]


def get_layout(layout_id: str) -> dict:
    row = _layout_row(layout_id)
    payload = _layout_payload(row)
    templates = sorted(cache.get_templates(layout_id), key=lambda item: item["sequence_order"])
    payload["templates"] = [admin_template(item) for item in templates]
    return payload


def _clean_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise AppError(400, "Document name is required")
    if len(cleaned) > 100:
        raise AppError(400, "Document name must be 100 characters or fewer")
    return cleaned


def _clean_description(description: str) -> str:
    cleaned = (description or "").strip()
    if len(cleaned) > 500:
        raise AppError(400, "Description must be 500 characters or fewer")
    return cleaned


def _ensure_unique_name(name: str, layout_id: str | None = None) -> None:
    rows = db.fetchall("SELECT layout_id FROM document_layouts WHERE lower(name) = lower(?)", [name])
    if any(row["layout_id"] != layout_id for row in rows):
        raise AppError(400, "A layout with that name already exists")


def _new_layout_id(name: str) -> str:
    base = slugify(name)
    candidate, counter = base, 2
    while db.fetchone("SELECT layout_id FROM document_layouts WHERE layout_id = ?", [candidate]):
        candidate = f"{base}-{counter}"
        counter += 1
    return candidate


def _template_id(layout_id: str, name: str) -> str:
    base = f"{layout_id}--{slugify(name)}"
    candidate, counter = base, 2
    while db.fetchone("SELECT template_id FROM layout_templates WHERE template_id = ?", [candidate]):
        candidate = f"{base}-{counter}"
        counter += 1
    return candidate


def _document_name(layout_id: str) -> str:
    return _layout_row(layout_id)["name"]


def create_layout(user: dict, name: str, description: str = "", copy_from: str | None = None) -> dict:
    _admin(user)
    cleaned = _clean_name(name)
    summary = _clean_description(description)
    _ensure_unique_name(cleaned)
    source = _layout_row(copy_from) if copy_from else None
    layout_id = _new_layout_id(cleaned)
    now = db._now()
    db.exec_sql(
        """
        INSERT INTO document_layouts (layout_id, name, description, is_system, created_at, updated_at)
        VALUES (?, ?, ?, FALSE, ?, ?)
        """,
        [layout_id, cleaned, summary, now, now],
    )
    if source:
        mapping: dict[str, str] = {}
        templates = sorted(cache.get_templates(source["layout_id"]), key=lambda item: item["sequence_order"])
        for template in templates:
            mapping[template["template_id"]] = _template_id(layout_id, template["section_name"])
            db.insert_template(
                layout_id,
                {
                    **template,
                    "template_id": mapping[template["template_id"]],
                    "parent_id": mapping.get(template["parent_id"]) if template["parent_id"] else None,
                },
            )
        cache.invalidate()
    gcs.upload_db()
    return get_layout(layout_id)


def update_layout(user: dict, layout_id: str, name: str | None, description: str | None) -> dict:
    _admin(user)
    row = _layout_row(layout_id)
    assignments = ["updated_at = ?"]
    params: list = [db._now()]
    if name is not None:
        cleaned = _clean_name(name)
        _ensure_unique_name(cleaned, layout_id)
        assignments.append("name = ?")
        params.append(cleaned)
    if description is not None:
        assignments.append("description = ?")
        params.append(_clean_description(description))
    params.append(row["layout_id"])
    db.exec_sql(f"UPDATE document_layouts SET {', '.join(assignments)} WHERE layout_id = ?", params)
    gcs.upload_db()
    return _layout_payload(_layout_row(layout_id))


def delete_layout(user: dict, layout_id: str) -> None:
    _admin(user)
    row = _layout_row(layout_id)
    if row["is_system"]:
        raise AppError(400, "Built-in layouts cannot be deleted")
    used = db.fetchone("SELECT count(*) AS c FROM project_documents WHERE layout_id = ?", [layout_id])
    if used and used["c"]:
        raise AppError(400, f"{used['c']} project document(s) use this layout. Remove them first")
    db.exec_sql("DELETE FROM layout_templates WHERE layout_id = ?", [layout_id])
    db.exec_sql("DELETE FROM document_layouts WHERE layout_id = ?", [layout_id])
    cache.invalidate()
    gcs.upload_db()


def _touch_layout(layout_id: str) -> None:
    db.exec_sql("UPDATE document_layouts SET updated_at = ? WHERE layout_id = ?", [db._now(), layout_id])
    cache.invalidate()
    gcs.upload_db()


def clean_section_name(name) -> str:
    cleaned = str(name or "").strip()
    if not cleaned:
        raise AppError(400, "Section name is required")
    if len(cleaned) > 150:
        raise AppError(400, "Section name must be 150 characters or fewer")
    return cleaned


def clean_prompt_fields(body: dict) -> dict:
    values: dict = {}
    if "system_prompt" in body:
        prompt = str(body.get("system_prompt") or "")
        if not prompt.strip():
            raise AppError(400, "Section prompt is required")
        values["system_prompt"] = prompt
    if "temperature" in body:
        try:
            temperature = float(body.get("temperature"))
        except (TypeError, ValueError) as exc:
            raise AppError(400, "Temperature must be a number") from exc
        if temperature < 0 or temperature > 2:
            raise AppError(400, "Temperature must be between 0 and 2")
        values["temperature"] = temperature
    if "max_words" in body:
        try:
            max_words = int(body.get("max_words"))
        except (TypeError, ValueError) as exc:
            raise AppError(400, "Max words must be a number") from exc
        if max_words < 1 or max_words > 5000:
            raise AppError(400, "Max words must be between 1 and 5000")
        values["max_words"] = max_words
    if "hint" in body:
        hint = str(body.get("hint") or "").strip()
        if len(hint) > 1000:
            raise AppError(400, "Hint must be 1000 characters or fewer")
        values["hint"] = hint
    return values


def add_template(user: dict, layout_id: str, body: dict) -> dict:
    _admin(user)
    layout = _layout_row(layout_id)
    name = clean_section_name(body.get("section_name"))
    parent_id = body.get("parent_id") or None
    templates = cache.get_templates(layout_id)
    if parent_id:
        parent = next((item for item in templates if item["template_id"] == parent_id), None)
        if parent is None:
            raise AppError(404, "Parent section not found")
        if parent["parent_id"]:
            raise AppError(400, "Sub-sections cannot be nested further")
    blocks = normalize_blocks(body.get("blocks") or [{"type": "prose"}])
    fields = clean_prompt_fields(body)
    hint = fields.get("hint", "")
    siblings = [item for item in templates if (item["parent_id"] or None) == parent_id]
    if parent_id:
        sequence = parent["sequence_order"] + len(siblings) + 1
    else:
        top = [item["sequence_order"] for item in templates if item["parent_id"] is None]
        sequence = (max(top) // 100 + 1) * 100 if top else 100
    identifier = _template_id(layout_id, name)
    db.insert_template(
        layout_id,
        {
            "template_id": identifier,
            "parent_id": parent_id,
            "section_name": name,
            "sequence_order": sequence,
            "system_prompt": fields.get("system_prompt") or db.default_section_prompt(layout["name"], name, hint),
            "temperature": fields.get("temperature", 0.2),
            "max_words": fields.get("max_words", 2000),
            "content_kind": db.kind_from_blocks(blocks),
            "schema_json": {"blocks": blocks},
            "hint": hint,
        },
    )
    _touch_layout(layout_id)
    return admin_template(next(item for item in cache.get_templates(layout_id) if item["template_id"] == identifier))


def _template(template_id: str) -> dict:
    row = next((item for item in cache.get_all_templates() if item["template_id"] == template_id), None)
    if row is None:
        raise AppError(404, "Section template not found")
    return row


def update_template(user: dict, template_id: str, body: dict) -> dict:
    _admin(user)
    row = _template(template_id)
    values = clean_prompt_fields(body)
    if "section_name" in body:
        values["section_name"] = clean_section_name(body.get("section_name"))
    if "blocks" in body:
        blocks = normalize_blocks(body.get("blocks"))
        values["schema_json"] = {"blocks": blocks}
        values["content_kind"] = db.kind_from_blocks(blocks)
    if values:
        assignments = []
        params: list = []
        for column, value in values.items():
            assignments.append(f"{column} = ?")
            params.append(json.dumps(value) if column == "schema_json" else value)
        params.append(template_id)
        db.exec_sql(f"UPDATE layout_templates SET {', '.join(assignments)} WHERE template_id = ?", params)
        _touch_layout(row["layout_id"])
    return admin_template(_template(template_id))


def delete_template(user: dict, template_id: str) -> None:
    _admin(user)
    row = _template(template_id)
    ids = [template_id] + [
        item["template_id"] for item in cache.get_templates(row["layout_id"]) if item["parent_id"] == template_id
    ]
    for identifier in ids:
        db.exec_sql("DELETE FROM layout_templates WHERE template_id = ?", [identifier])
    _touch_layout(row["layout_id"])


def plan_order(sections, known: set[str]) -> list[tuple[str, str | None, int]]:
    """Validate a requested order and return (template_id, parent_id, sequence_order) for every section.

    `sections` is [{template_id, children: [template_id]}]; every known section must appear exactly once.
    """
    seen: list[str] = []
    plan: list[tuple[str, str | None, int]] = []
    if not isinstance(sections, list):
        raise AppError(400, "Provide the sections in order")
    for index, section in enumerate(sections, start=1):
        if not isinstance(section, dict) or not section.get("template_id"):
            raise AppError(400, "Each section needs a template_id")
        parent = section["template_id"]
        seen.append(parent)
        plan.append((parent, None, index * 100))
        for child_index, child in enumerate(section.get("children") or [], start=1):
            seen.append(child)
            plan.append((child, parent, index * 100 + child_index))
    if sorted(seen) != sorted(known):
        raise AppError(400, "Provide every section of the layout exactly once")
    return plan


def reorder_layout(user: dict, layout_id: str, sections: list) -> dict:
    """`sections` is [{template_id, children: [template_id]}]; every section of the layout appears exactly once."""
    _admin(user)
    _layout_row(layout_id)
    templates = cache.get_templates(layout_id)
    plan = plan_order(sections, {item["template_id"] for item in templates})
    for identifier, parent_id, sequence in plan:
        db.exec_sql(
            "UPDATE layout_templates SET parent_id = ?, sequence_order = ? WHERE template_id = ?",
            [parent_id, sequence, identifier],
        )
    _touch_layout(layout_id)
    return get_layout(layout_id)


def reorder_top_level(user: dict, template_ids: list[str]) -> list[dict]:
    """Legacy ordering of the SDD's top-level sections; sub-sections stay with their parents."""
    _admin(user)
    templates = cache.get_templates(SDD_LAYOUT_ID)
    parents = [item["template_id"] for item in templates if item["parent_id"] is None]
    if sorted(template_ids) != sorted(parents):
        raise AppError(400, "Provide every top-level section id exactly once")
    sections = []
    for template_id in template_ids:
        children = sorted(
            (item for item in templates if item["parent_id"] == template_id), key=lambda item: item["sequence_order"]
        )
        sections.append({"template_id": template_id, "children": [item["template_id"] for item in children]})
    reorder_layout(user, SDD_LAYOUT_ID, sections)
    return [db.public_template(item) for item in cache.get_templates(SDD_LAYOUT_ID)]
