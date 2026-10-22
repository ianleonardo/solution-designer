"""Details for L1 and L2 capabilities: description, country specific behavior and diagrams.

L1 and L2 are not rows of their own in kb_capabilities; they are the names shared by L3 rows. A node record is
matched to the tree by system and name (case-insensitive). Like an L3 capability, a node record applies to all
countries (empty country) or to a list of countries, and a node can have one record per country selection.
"""

import uuid
from datetime import datetime, timezone

from app import db
from app.errors import AppError
from app.permissions import require
from app.services import capabilities as caps
from app.services import gcs, llm


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _codes(value: str) -> set[str]:
    return {part.strip().upper() for part in (value or "").split(",") if part.strip()}


def _level(value) -> int:
    try:
        level = int(value)
    except (TypeError, ValueError) as exc:
        raise AppError(400, "Level must be 1 or 2.") from exc
    if level not in (1, 2):
        raise AppError(400, "Level must be 1 or 2.")
    return level


def _names(level: int, l1: str, l2: str) -> tuple[str, str]:
    l1 = caps._level(l1, "L1 capability")
    l2 = caps._level(l2, "L2 capability") if level == 2 else ""
    return l1, l2


def node_title(row: dict) -> str:
    return " / ".join(part for part in (row.get("l1_capability"), row.get("l2_capability")) if part)


def _payload(row: dict) -> dict:
    return {
        "node_id": row["node_id"],
        "country": row["country"],
        "system_code": row["system_code"],
        "level": int(row["level"]),
        "l1_capability": caps.sentence_case(row["l1_capability"]),
        "l2_capability": caps.sentence_case(row["l2_capability"] or ""),
        "description": row["description"] or "",
        "country_behavior": row.get("country_behavior") or "",
        "sequence_diagrams": caps._diagram_list(row.get("sequence_diagrams")),
        "l3_count": _l3_count(row),
        "created_at": row["created_at"],
        "last_modified": row["last_modified"],
    }


def _l3_count(row: dict) -> int:
    sql = "SELECT COUNT(*) AS c FROM kb_capabilities WHERE system_code = ? AND lower(l1_capability) = lower(?)"
    params = [row["system_code"], row["l1_capability"]]
    if int(row["level"]) == 2:
        sql += " AND lower(l2_capability) = lower(?)"
        params.append(row["l2_capability"])
    found = db.fetchone(sql, params)
    return int(found["c"]) if found else 0


def text_for(row: dict) -> str:
    level = int(row["level"])
    parts = [
        f"L{level} capability {node_title(row)} "
        f"(country {caps.country_label(row.get('country') or '')}, system {row['system_code']})."
    ]
    if (row.get("description") or "").strip():
        parts.append(row["description"].strip())
    behavior = (row.get("country_behavior") or "").strip()
    if behavior:
        parts.append(f"Country specific behavior: {behavior}")
    for item in caps._diagram_list(row.get("sequence_diagrams")):
        title = str(item.get("title") or "Diagram").strip()
        mermaid = str(item.get("mermaid") or "").strip()
        parts.append(f"Diagram {title}:\n{mermaid}" if mermaid else f"Diagram {title}")
    return "\n".join(parts)


def _embed(node_id: str) -> None:
    row = db.fetchone("SELECT * FROM kb_capability_nodes WHERE node_id = ?", [node_id])
    if row is None:
        return
    vector = llm.embed(text_for(row)[: caps.EMBED_CHARS]) if llm.embedding_configured() else None
    db.exec_sql("UPDATE kb_capability_nodes SET embedding = ? WHERE node_id = ?", [vector, node_id])


def _row(node_id: str) -> dict:
    row = db.fetchone("SELECT * FROM kb_capability_nodes WHERE node_id = ?", [node_id])
    if row is None:
        raise AppError(404, "Capability details not found")
    return row


def list_nodes(system_code: str = "") -> list[dict]:
    if system_code.strip():
        rows = db.fetchall(
            "SELECT * FROM kb_capability_nodes WHERE system_code = ? ORDER BY level, l1_capability, l2_capability, country",
            [system_code.strip().upper()],
        )
    else:
        rows = db.fetchall("SELECT * FROM kb_capability_nodes ORDER BY system_code, level, l1_capability, l2_capability, country")
    return [_payload(row) for row in rows]


def get_node(node_id: str) -> dict:
    return _payload(_row(node_id))


def _check_overlap(country: str, system_code: str, level: int, l1: str, l2: str, node_id: str = "") -> None:
    """Each country sees at most one record for a node, so selections may not overlap."""
    mine = _codes(country)
    for other in db.fetchall(
        """
        SELECT node_id, country FROM kb_capability_nodes
        WHERE system_code = ? AND level = ? AND lower(l1_capability) = lower(?) AND lower(l2_capability) = lower(?)
          AND node_id <> ?
        """,
        [system_code, level, l1, l2, node_id],
    ):
        theirs = _codes(other["country"])
        if not mine or not theirs or mine & theirs:
            label = f"L{level} {l1}" + (f" / {l2}" if l2 else "")
            raise AppError(
                400,
                f"{label} already has details for {caps.country_label(other['country'])}. "
                "Edit those, or choose countries that do not overlap.",
            )


def _fields(body: dict, current: dict | None = None) -> dict:
    current = current or {}
    level = _level(body.get("level", current.get("level")))
    system_code = caps._system_code(str(body.get("system_code", current.get("system_code")) or ""))
    l1, l2 = _names(
        level,
        str(body.get("l1_capability", current.get("l1_capability")) or ""),
        str(body.get("l2_capability", current.get("l2_capability")) or ""),
    )
    description = str(body.get("description", current.get("description", "")) or "").strip()
    if len(description) > caps.MAX_RULES:
        raise AppError(400, f"Description must be {caps.MAX_RULES} characters or fewer.")
    if "sequence_diagrams" in body:
        diagrams = caps._diagrams(body.get("sequence_diagrams"))
    else:
        diagrams = current.get("sequence_diagrams") or "[]"
    return {
        "country": caps._country(str(body.get("country", current.get("country", "")) or "")),
        "system_code": system_code,
        "level": level,
        "l1_capability": l1,
        "l2_capability": l2,
        "description": description,
        "country_behavior": caps._behavior(str(body.get("country_behavior", current.get("country_behavior", "")) or "")),
        "sequence_diagrams": diagrams,
    }


def create_node(user: dict, body: dict) -> dict:
    require(user, "knowledge", "write")
    data = _fields(body)
    _check_overlap(data["country"], data["system_code"], data["level"], data["l1_capability"], data["l2_capability"])
    node_id = str(uuid.uuid4())
    now = _now()
    db.exec_sql(
        """
        INSERT INTO kb_capability_nodes (
            node_id, country, system_code, level, l1_capability, l2_capability,
            description, country_behavior, sequence_diagrams, created_at, last_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            node_id,
            data["country"],
            data["system_code"],
            data["level"],
            data["l1_capability"],
            data["l2_capability"],
            data["description"],
            data["country_behavior"],
            data["sequence_diagrams"],
            now,
            now,
        ],
    )
    _embed(node_id)
    gcs.upload_db()
    return get_node(node_id)


def update_node(user: dict, node_id: str, body: dict) -> dict:
    """Changes the text, countries and diagrams. The node it belongs to is fixed; use rename to change names."""
    require(user, "knowledge", "write")
    current = _row(node_id)
    body = {key: value for key, value in body.items() if key not in {"system_code", "level", "l1_capability", "l2_capability"}}
    data = _fields(body, current)
    _check_overlap(data["country"], data["system_code"], data["level"], data["l1_capability"], data["l2_capability"], node_id)
    db.exec_sql(
        """
        UPDATE kb_capability_nodes
        SET country = ?, description = ?, country_behavior = ?, sequence_diagrams = ?, last_modified = ?
        WHERE node_id = ?
        """,
        [data["country"], data["description"], data["country_behavior"], data["sequence_diagrams"], _now(), node_id],
    )
    _embed(node_id)
    gcs.upload_db()
    return get_node(node_id)


def delete_node(user: dict, node_id: str) -> None:
    require(user, "knowledge", "write")
    _row(node_id)
    db.exec_sql("DELETE FROM kb_capability_nodes WHERE node_id = ?", [node_id])
    gcs.upload_db()


def rename(user: dict, body: dict) -> dict:
    """Rename an L1 or L2 for one system, in every country: its L3 capabilities and its details move with it."""
    require(user, "knowledge", "write")
    level = _level(body.get("level"))
    system_code = caps._system_code(str(body.get("system_code") or ""))
    l1, l2 = _names(level, str(body.get("l1_capability") or ""), str(body.get("l2_capability") or ""))
    new_name = caps._level(str(body.get("new_name") or ""), f"New L{level} name")

    if level == 1:
        match_sql = "system_code = ? AND lower(l1_capability) = lower(?)"
        match_params = [system_code, l1]
    else:
        match_sql = "system_code = ? AND lower(l1_capability) = lower(?) AND lower(l2_capability) = lower(?)"
        match_params = [system_code, l1, l2]

    moving = db.fetchall(f"SELECT * FROM kb_capabilities WHERE {match_sql}", match_params)
    moving_nodes = db.fetchall(f"SELECT * FROM kb_capability_nodes WHERE {match_sql}", match_params)
    if not moving and not moving_nodes:
        raise AppError(404, f"L{level} capability not found")

    def renamed(row: dict) -> tuple[str, str]:
        if level == 1:
            return new_name, row["l2_capability"] or ""
        return row["l1_capability"], new_name

    # L3 rows that would end up with the same country / names as one that is not moving.
    moving_ids = {row["capability_id"] for row in moving}
    taken = {
        (row["country"], row["l1_capability"].lower(), row["l2_capability"].lower(), row["l3_capability"].lower())
        for row in db.fetchall("SELECT * FROM kb_capabilities WHERE system_code = ?", [system_code])
        if row["capability_id"] not in moving_ids
    }
    for row in moving:
        new_l1, new_l2 = renamed(row)
        if (row["country"], new_l1.lower(), new_l2.lower(), row["l3_capability"].lower()) in taken:
            raise AppError(
                400,
                f"Cannot rename: {new_l1} / {new_l2} / {row['l3_capability']} already exists for "
                f"{caps.country_label(row['country'])}.",
            )
    moving_node_ids = {row["node_id"] for row in moving_nodes}
    staying_nodes = [
        row for row in db.fetchall("SELECT * FROM kb_capability_nodes WHERE system_code = ?", [system_code]) if row["node_id"] not in moving_node_ids
    ]
    for row in moving_nodes:
        new_l1, new_l2 = renamed(row)
        for other in staying_nodes:
            if (
                int(other["level"]) == int(row["level"])
                and other["l1_capability"].lower() == new_l1.lower()
                and (other["l2_capability"] or "").lower() == new_l2.lower()
            ):
                mine, theirs = _codes(row["country"]), _codes(other["country"])
                if not mine or not theirs or mine & theirs:
                    raise AppError(
                        400,
                        f"Cannot rename: {node_title({'l1_capability': new_l1, 'l2_capability': new_l2})} already has details for "
                        f"{caps.country_label(other['country'])}. Delete one of them first.",
                    )

    now = _now()
    column = "l1_capability" if level == 1 else "l2_capability"
    with db.transaction():
        db.exec_sql(f"UPDATE kb_capabilities SET {column} = ?, last_modified = ? WHERE {match_sql}", [new_name, now, *match_params])
        db.exec_sql(f"UPDATE kb_capability_nodes SET {column} = ?, last_modified = ? WHERE {match_sql}", [new_name, now, *match_params])
    for row in moving:
        caps._embed(row["capability_id"])
    for row in moving_nodes:
        _embed(row["node_id"])
    gcs.upload_db()
    return {"renamed": len(moving), "details": len(moving_nodes), "new_name": new_name}


def _overlaps(a: str, b: str) -> bool:
    mine, theirs = _codes(a), _codes(b)
    return not mine or not theirs or bool(mine & theirs)


def detail_lines(description: str, behavior: str, diagrams: list[dict], *, empty_note: bool = True) -> list[str]:
    """Description, country specific behavior and diagrams as level-3 sections (diagrams as Mermaid fences)."""
    lines = ["### Description", "", (description or "").strip() or "No description.", ""]
    if (behavior or "").strip() or empty_note:
        lines.extend(["### Country specific behavior", "", (behavior or "").strip() or "None.", ""])
    lines.extend(["### Diagrams", ""])
    if not diagrams:
        lines.extend(["No diagrams.", ""])
    for diagram in diagrams:
        lines.extend([f"#### {diagram.get('title') or 'Diagram'}", "", "```mermaid", diagram.get("mermaid") or "", "```", ""])
    return lines


def context_lines(system_code: str, l1: str, l2: str, country: str, levels: tuple[int, ...]) -> list[str]:
    """Sections for the L1 (and L2) above a capability: the details that apply to any of its countries."""
    lines: list[str] = []
    for level in levels:
        name = l1 if level == 1 else l2
        lines.extend([f"## L{level} — {caps.sentence_case(name)}", ""])
        rows = [
            row
            for row in db.fetchall(
                """
                SELECT * FROM kb_capability_nodes
                WHERE system_code = ? AND level = ? AND lower(l1_capability) = lower(?) AND lower(l2_capability) = lower(?)
                ORDER BY country
                """,
                [system_code, level, l1, l2 if level == 2 else ""],
            )
            if _overlaps(row["country"], country)
        ]
        if not rows:
            lines.extend([f"No L{level} details.", ""])
        for row in rows:
            lines.extend([f"**Applicable for:** {caps.country_label(row['country'])}", ""])
            lines.extend(detail_lines(row["description"], row.get("country_behavior") or "", caps._diagram_list(row.get("sequence_diagrams")), empty_note=False))
    return lines


def markdown_body(record: dict) -> tuple[str, str]:
    """An L2 download starts with its L1's details; an L1 download is the L1 alone."""
    level = int(record.get("level") or 1)
    title = f"L{level} — {node_title(record) or 'Capability'}"
    country = record.get("country") or ""
    lines = [
        f"**System:** {record.get('system_code') or ''}",
        f"**Applicable for:** {caps.country_label(country)}",
        "",
    ]
    if level == 2:
        lines.extend(context_lines(record["system_code"], record["l1_capability"], "", country, (1,)))
    name = record.get("l2_capability") if level == 2 else record.get("l1_capability")
    lines.extend([f"## L{level} — {name}", ""])
    lines.extend(detail_lines(record.get("description") or "", record.get("country_behavior") or "", record.get("sequence_diagrams") or []))
    return title, "\n".join(lines).rstrip() + "\n"
