"""Fill document tables from the Knowledge Base and keep the rows linked to their source items.

A layout table can name a Knowledge Base source (capabilities, interfaces, reports or tables). Columns are matched to
Knowledge Base fields by their headers, so any layout table works without a mapping screen. Each linked row stores
which columns came from the Knowledge Base ("owned") and the values it last took ("values"). Refresh rewrites only
owned cells; a row whose source now gives different values is "changed", and one whose source is gone is "deleted".
Columns about the project itself (New / Existing / Delete, Complexity, VAL ID ...) are never owned.
"""

import re

from app import db
from app.content import number_rows, serial_column, table_block
from app.errors import AppError

SOURCE_KIND = {"capabilities": "capability", "interfaces": "interface", "reports": "report", "tables": "column"}


def _key(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(header or "").lower())


# header (normalised) -> field name, per source
_ALIASES: dict[str, dict[str, str]] = {
    "capabilities": {
        "appname": "system", "application": "system", "system": "system", "systemcode": "system", "app": "system",
        "l1capability": "l1", "l1": "l1", "l2capability": "l2", "l2": "l2", "l3capability": "l3", "l3": "l3",
        "description": "description", "capabilitydescription": "description",
        "country": "country", "countries": "country",
    },
    "interfaces": {
        "interfacenamepurpose": "name_purpose",
        "interfacename": "name", "systeminterfacename": "name", "name": "name",
        "onlinebatch": "mode", "mode": "mode",
        "sourcesystem": "source", "source": "source",
        "destinationsystem": "destination", "destination": "destination", "targetsystem": "destination",
        "integrationlayer": "layer", "channel": "channel", "protocol": "protocol",
        "description": "description", "purpose": "description", "endpoint": "endpoint",
        "country": "country", "countries": "country",
    },
    "reports": {
        "appname": "system", "application": "system", "system": "system", "systemcode": "system",
        "reportname": "name", "name": "name", "reportcode": "code", "frequency": "frequency",
        "description": "description", "country": "country",
    },
    "tables": {
        "fieldname": "name", "columnname": "name", "column": "name", "field": "name",
        "fieldtype": "type", "datatype": "type", "type": "type",
        "fieldlength": "length", "length": "length", "size": "length",
        "fielddescription": "description", "description": "description",
        "nullable": "nullable", "isnull": "nullable", "primarykey": "primary_key", "pk": "primary_key",
    },
}
# Project-owned columns that get a default for a Knowledge Base item but are never refreshed.
_DEFAULTS = {"newexistingdelete": "Existing", "neweditdelete": "Existing", "action": "Existing"}

_TYPE_LENGTH = re.compile(r"^\s*([^()]+?)\s*\(\s*([^)]*?)\s*\)\s*$")
_BATCH_HINTS = ("file", "sftp", "ftp", "batch", "csv", "flat")


def split_type(data_type: str) -> tuple[str, str]:
    """`VARCHAR(20)` -> (`VARCHAR`, `20`); a type with no length keeps an empty length."""
    match = _TYPE_LENGTH.match(data_type or "")
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return (data_type or "").strip(), ""


def _mode(protocol: str) -> str:
    text = (protocol or "").lower()
    if not text:
        return ""
    return "Batch" if any(hint in text for hint in _BATCH_HINTS) else "Online"


def _fields(source: str, record: dict) -> dict[str, str]:
    text = {key: str(value or "").strip() for key, value in record.items()}
    if source == "capabilities":
        return {
            "system": text.get("system_code", ""), "l1": text.get("l1_capability", ""), "l2": text.get("l2_capability", ""),
            "l3": text.get("l3_capability", ""), "description": text.get("description", ""), "country": text.get("country", "") or "All",
        }
    if source == "interfaces":
        name, description = text.get("interface_name", ""), text.get("description", "")
        layer = " / ".join(part for part in (text.get("channel", ""), text.get("protocol", "")) if part)
        return {
            "name": name, "name_purpose": f"{name} – {description}" if description else name,
            "mode": _mode(text.get("protocol", "")), "source": text.get("source", ""), "destination": text.get("destination", ""),
            "layer": layer, "channel": text.get("channel", ""), "protocol": text.get("protocol", ""),
            "description": description, "endpoint": text.get("endpoint", ""), "country": text.get("country", "") or "All",
        }
    if source == "reports":
        return {
            "system": text.get("system_code", ""), "name": text.get("report_name", ""), "code": text.get("report_code", ""),
            "frequency": text.get("frequency_other", "") or text.get("frequency", ""),
            "description": text.get("description", ""), "country": text.get("country", ""),
        }
    data_type, length = split_type(text.get("data_type", ""))
    return {
        "name": text.get("column_name", ""), "type": data_type, "length": length,
        "description": text.get("description", ""), "nullable": text.get("is_null", ""), "primary_key": text.get("primary_key", ""),
    }


def row_for(source: str, record: dict, columns: list[str]) -> tuple[list[str], dict]:
    """The table row for one Knowledge Base item and the link that remembers it."""
    fields = _fields(source, record)
    aliases = _ALIASES[source]
    serial = serial_column(columns)
    cells = [""] * len(columns)
    owned: list[int] = []
    for index, header in enumerate(columns):
        if index == serial:
            continue
        key = _key(header)
        if key in aliases:
            cells[index] = fields.get(aliases[key], "")
            owned.append(index)
        elif key in _DEFAULTS:
            cells[index] = _DEFAULTS[key]
    link = {"kind": SOURCE_KIND[source], "id": record["_id"], "owned": owned, "values": {str(i): cells[i] for i in owned}}
    if source == "tables":
        link["table_id"] = record["table_id"]
    return cells, link


# --- loading Knowledge Base items ------------------------------------------------------------------------------------

_QUERIES = {
    "capability": ("SELECT *, capability_id AS _id FROM kb_capabilities WHERE capability_id IN ({})", "capabilities"),
    "interface": ("SELECT *, interface_id AS _id FROM interfaces WHERE interface_id IN ({})", "interfaces"),
    "report": ("SELECT *, report_id AS _id FROM kb_reports WHERE report_id IN ({})", "reports"),
    "column": ("SELECT *, column_id AS _id FROM kb_table_columns WHERE column_id IN ({})", "tables"),
}


def load(kind: str, ids: list[str]) -> dict[str, dict]:
    ids = [item for item in dict.fromkeys(ids) if item]
    if not ids:
        return {}
    sql, _ = _QUERIES[kind]
    rows = db.fetchall(sql.format(", ".join("?" for _ in ids)), ids)
    return {row["_id"]: row for row in rows}


def _table_record(table_id: str) -> dict:
    row = db.fetchone("SELECT * FROM kb_tables WHERE table_id = ?", [table_id])
    if row is None:
        raise AppError(404, "Table not found in the Knowledge Base")
    return row


def table_label(row: dict) -> str:
    return ".".join(part for part in (row.get("database_name"), row.get("schema_name"), row.get("table_name")) if part)


# --- change detection (added to API payloads, never stored) ----------------------------------------------------------


def annotate(content: dict) -> dict:
    """Mark each linked row ok / changed / deleted against the Knowledge Base as it is now."""
    wanted: dict[str, set[str]] = {}
    for section in (content.get("sections") or {}).values():
        for block in section.get("blocks") or []:
            for link in block.get("links") or []:
                if link:
                    wanted.setdefault(link["kind"], set()).add(link["id"])
    if not wanted:
        return content
    found = {kind: load(kind, list(ids)) for kind, ids in wanted.items()}
    for section in (content.get("sections") or {}).values():
        for block in section.get("blocks") or []:
            columns = block.get("columns") or []
            for link in block.get("links") or []:
                if not link:
                    continue
                record = found.get(link["kind"], {}).get(link["id"])
                if record is None:
                    link["state"] = "deleted"
                    continue
                _, fresh = row_for(_QUERIES[link["kind"]][1], record, columns)
                link["state"] = "ok" if all(fresh["values"].get(k) == v for k, v in link["values"].items()) else "changed"
    return content


# --- editing a document ----------------------------------------------------------------------------------------------


def _document(project_id: str, document_id: str):
    from app.services import documents

    row = documents.document_row(project_id, document_id)
    templates = documents.document_templates(row)
    payload = documents.payload(row)
    return documents, templates, payload["content_json"]


def _slot(templates: list[dict], section_id: str) -> tuple[dict, int, str]:
    """The section's template, the index (among its tables) of the linked table slot, and its source."""
    template = next((item for item in templates if item["template_id"] == section_id), None)
    if template is None:
        raise AppError(404, "Section not found")
    tables = [block for block in template["schema_json"]["blocks"] if block.get("type") == "table"]
    for index, block in enumerate(tables):
        if block.get("source") in SOURCE_KIND:
            return template, index, block["source"]
    raise AppError(400, "This section has no table that can be filled from the Knowledge Base")


def _is_blank(row: list[str], columns: list[str]) -> bool:
    serial = serial_column(columns)
    return not any(str(cell).strip() for position, cell in enumerate(row) if position != serial)


def _strip_state(block: dict) -> dict:
    return {**block, "links": [{k: v for k, v in link.items() if k != "state"} if link else None for link in block.get("links") or []]}


def _append(block: dict, source: str, records: list[dict], starter_rows: list[list[str]] | None = None) -> dict:
    """Add rows for the records. Blank rows and the layout's example rows make way for them."""
    columns = block["columns"]
    serial = serial_column(columns)

    def plain(row: list[str]) -> list[str]:
        return [str(cell).strip() for position, cell in enumerate(row) if position != serial]

    examples = [plain(row) for row in starter_rows or []]
    rows = [list(row) for row in block["rows"]]
    links = list(block.get("links") or []) + [None] * (len(rows) - len(block.get("links") or []))
    present = {(link["kind"], link["id"]) for link in links if link}
    keep = [i for i, row in enumerate(rows) if links[i] or not (_is_blank(row, columns) or plain(row) in examples)]
    rows, links = [rows[i] for i in keep], [links[i] for i in keep]
    for record in records:
        if (SOURCE_KIND[source], record["_id"]) in present:
            continue
        cells, link = row_for(source, record, columns)
        rows.append(cells)
        links.append(link)
    if not rows:
        rows, links = [[""] * len(columns)], [None]
    return table_block(columns, number_rows(columns, rows), {**block, "links": links})


def link_items(user: dict, project_id: str, document_id: str, section_id: str, body: dict) -> dict:
    documents, templates, content = _document(project_id, document_id)
    template, slot, source = _slot(templates, section_id)
    schema_tables = [block for block in template["schema_json"]["blocks"] if block.get("type") == "table"]
    starter_rows = schema_tables[slot].get("rows") or []
    section = content["sections"][section_id]
    blocks = [_strip_state(block) if block.get("type") == "table" else block for block in section["blocks"]]
    table_positions = [i for i, block in enumerate(blocks) if block.get("type") == "table"]
    if source == "tables":
        table = _table_record(str(body.get("table_id") or ""))
        wanted = [str(item) for item in body.get("column_ids") or []]
        loaded = load("column", wanted)
        records = [loaded[item] for item in wanted if item in loaded]
        if any(record["table_id"] != table["table_id"] for record in records):
            raise AppError(400, "Those columns are not from that table")
        slot_positions = table_positions[slot:]
        target = next((i for i in slot_positions if blocks[i].get("kb_table_id") == table["table_id"]), None)
        if target is None:
            target = next(
                (
                    i
                    for i in slot_positions
                    if not blocks[i].get("kb_table_id")
                    and not blocks[i].get("table_name")
                    and all(_is_blank(row, blocks[i]["columns"]) for row in blocks[i]["rows"])
                ),
                None,
            )
        if target is None:
            columns = blocks[slot_positions[-1]]["columns"]
            blocks.insert(slot_positions[-1] + 1, {"type": "table", "columns": columns, "rows": [[""] * len(columns)]})
            target = slot_positions[-1] + 1
        updated = _append(
            {**blocks[target], "table_name": table_label(table), "kb_table_id": table["table_id"]}, source, records, starter_rows
        )
        blocks[target] = updated
    else:
        if slot >= len(table_positions):
            raise AppError(400, "The section's table is missing")
        ids = [str(item) for item in body.get("ids") or []]
        found = load(SOURCE_KIND[source], ids)
        missing = [item for item in ids if item not in found]
        if missing:
            raise AppError(404, "Some items are no longer in the Knowledge Base")
        target = table_positions[slot]
        blocks[target] = _append(blocks[target], source, [found[item] for item in ids], starter_rows)
    content["sections"][section_id] = {**section, "blocks": blocks}
    return documents.save(user, project_id, document_id, content)


def refresh(user: dict, project_id: str, document_id: str, section_id: str) -> dict:
    """Rewrite the Knowledge Base cells of every linked row in the section; project-owned cells are left alone."""
    documents, templates, content = _document(project_id, document_id)
    _slot(templates, section_id)
    section = content["sections"][section_id]
    blocks = []
    for block in section["blocks"]:
        if block.get("type") != "table" or not block.get("links"):
            blocks.append(block)
            continue
        block = _strip_state(block)
        rows = [list(row) for row in block["rows"]]
        links = block["links"]
        by_kind: dict[str, list[str]] = {}
        for link in links:
            if link:
                by_kind.setdefault(link["kind"], []).append(link["id"])
        found = {kind: load(kind, ids) for kind, ids in by_kind.items()}
        for index, link in enumerate(links):
            record = found.get(link["kind"], {}).get(link["id"]) if link else None
            if record is None:
                continue
            cells, fresh = row_for(_QUERIES[link["kind"]][1], record, block["columns"])
            for position in link["owned"]:
                rows[index][position] = cells[position]
            link["values"] = {str(position): cells[position] for position in link["owned"]}
        if block.get("kb_table_id"):
            table = db.fetchone("SELECT * FROM kb_tables WHERE table_id = ?", [block["kb_table_id"]])
            if table:
                block["table_name"] = table_label(table)
        blocks.append(table_block(block["columns"], rows, block))
    content["sections"][section_id] = {**section, "blocks": blocks}
    return documents.save(user, project_id, document_id, content)


def related(project_id: str, document_id: str, section_id: str, body: dict) -> list[dict]:
    """Other sections of this document that could take items related to the ones just added."""
    _, templates, content = _document(project_id, document_id)
    _, _, source = _slot(templates, section_id)
    ids = [str(item) for item in body.get("ids") or []]
    if not ids:
        return []
    placeholders = ", ".join("?" for _ in ids)
    wanted: dict[str, list[str]] = {}
    if source == "capabilities":
        for target, table, column in (
            ("interfaces", "kb_capability_interfaces", "interface_id"),
            ("reports", "kb_capability_reports", "report_id"),
            ("tables", "kb_capability_tables", "table_id"),
        ):
            rows = db.fetchall(f"SELECT DISTINCT {column} AS id FROM {table} WHERE capability_id IN ({placeholders})", ids)
            wanted[target] = [row["id"] for row in rows]
    elif source == "interfaces":
        wanted["interfaces"] = ids
    suggestions = []
    for template in templates:
        if template["template_id"] == section_id:
            continue
        try:
            _, _, target_source = _slot(templates, template["template_id"])
        except AppError:
            continue
        candidates = wanted.get(target_source) or []
        if not candidates:
            continue
        blocks = content["sections"].get(template["template_id"], {}).get("blocks") or []
        if target_source == "tables":
            present = {block.get("kb_table_id") for block in blocks if block.get("type") == "table"}
            rows = db.fetchall(
                f"SELECT * FROM kb_tables WHERE table_id IN ({', '.join('?' for _ in candidates)})", candidates
            )
            items = [{"id": row["table_id"], "label": table_label(row)} for row in rows if row["table_id"] not in present]
        else:
            kind = SOURCE_KIND[target_source]
            present = {link["id"] for block in blocks for link in block.get("links") or [] if link and link["kind"] == kind}
            found = load(kind, candidates)
            label = (lambda row: row.get("interface_name")) if kind == "interface" else (lambda row: row.get("report_name"))
            items = [{"id": item, "label": label(found[item]) or item} for item in candidates if item in found and item not in present]
        if items:
            suggestions.append(
                {"section_id": template["template_id"], "section_title": template["section_name"], "source": target_source, "items": items}
            )
    return suggestions
