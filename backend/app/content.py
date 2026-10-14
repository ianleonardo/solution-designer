import re

from app.flow import (
    DEFAULT_FLOWCHART,
    default_flowchart,
    default_sequence_flow,
    flow_to_mermaid,
    flowchart_to_mermaid,
    mermaid_to_flow,
    mermaid_to_flowchart,
    normalize_flowchart,
)
from app.missing import evaluate_missing

IMAGE_URL = re.compile(r"^/api/projects/[0-9a-fA-F-]{8,64}/images/[A-Za-z0-9._-]{1,200}$")


def header_level(value) -> int:
    try:
        level = int(value)
    except (TypeError, ValueError):
        return 1
    return min(max(level, 1), 3)


def header_block(schema: dict, source: dict | None = None) -> dict:
    text = (source or {}).get("text")
    if text is None:
        text = schema.get("text")
    # The size picked in the document wins; the layout's size is the starting point.
    level = (source or {}).get("level")
    return {"type": "header", "text": _as_text(text), "level": header_level(level if level is not None else schema.get("level"))}


def image_block(schema: dict, source: dict | None = None) -> dict:
    url = _as_text((source or {}).get("url"))
    if url and not IMAGE_URL.fullmatch(url):
        url = ""
    caption = (source or {}).get("caption")
    if caption is None:
        caption = schema.get("caption")
    return {"type": "image", "url": url, "caption": _as_text(caption), "alt": _as_text((source or {}).get("alt"))}


def blocks_from_schema(schema_blocks: list[dict]) -> list[dict]:
    blocks = []
    for block in schema_blocks:
        kind = block.get("type")
        if kind == "header":
            blocks.append(header_block(block))
        elif kind == "image":
            blocks.append(image_block(block))
        elif kind == "prose":
            blocks.append({"type": "prose", "markdown": ""})
        elif kind == "table":
            columns = list(block.get("columns") or [])
            rows = [list(row) for row in (block.get("rows") or [[""] * len(columns)])]
            blocks.append({"type": "table", "columns": columns, "rows": rows})
        elif kind == "diagram":
            if block.get("sequence"):
                flow = default_sequence_flow()
                blocks.append(
                    {
                        "type": "diagram",
                        "sequence": True,
                        "mermaid": flow_to_mermaid(flow),
                        "flow": flow,
                    }
                )
            else:
                chart = default_flowchart()
                blocks.append(
                    {
                        "type": "diagram",
                        "sequence": False,
                        "mermaid": flowchart_to_mermaid(chart),
                        "flow": chart,
                    }
                )
    return blocks


def blank_content(templates: list[dict]) -> dict:
    sections = {}
    for template in templates:
        sections[template["template_id"]] = {
            "template_id": template["template_id"],
            "title": template["section_name"],
            "blocks": blocks_from_schema(template["schema_json"]["blocks"]),
            "missing": [],
        }
    return evaluate_missing({"sections": sections})


def _as_text(value) -> str:
    if value is None:
        return ""
    return str(value)


def _sanitize_blocks(incoming: list, schema_blocks: list[dict]) -> list[dict]:
    pools: dict[str, list] = {}
    for block in incoming or []:
        if isinstance(block, dict) and block.get("type"):
            pools.setdefault(block["type"], []).append(block)
    result = []
    for schema in schema_blocks:
        kind = schema.get("type")
        found = pools.get(kind, [])
        source = found.pop(0) if found else None
        if kind == "header":
            result.append(header_block(schema, source))
        elif kind == "image":
            result.append(image_block(schema, source))
        elif kind == "prose":
            result.append({"type": "prose", "markdown": _as_text((source or {}).get("markdown"))})
        elif kind == "table":
            columns = list(schema.get("columns") or [])
            rows = []
            for row in (source or {}).get("rows") or schema.get("rows") or [[""] * len(columns)]:
                cells = [_as_text(cell) for cell in row]
                if len(cells) < len(columns):
                    cells.extend([""] * (len(columns) - len(cells)))
                rows.append(cells[: len(columns)])
            if not rows:
                rows = [[""] * len(columns)]
            result.append({"type": "table", "columns": columns, "rows": rows})
        elif kind == "diagram":
            sequence = bool(schema.get("sequence"))
            mermaid = _as_text((source or {}).get("mermaid"))
            flow = (source or {}).get("flow")
            is_sequence_text = mermaid.lstrip().startswith("sequenceDiagram")
            if sequence != is_sequence_text and mermaid:
                # The block type was switched in the section settings: start the other kind afresh.
                mermaid, flow = "", None
            if sequence and not mermaid:
                flow = default_flow()
                mermaid = flow_to_mermaid(flow)
            elif sequence and not flow:
                flow = mermaid_to_flow(mermaid)
            if not sequence:
                # A drawn flowchart is the source of truth; otherwise read the Mermaid text when it is simple enough.
                chart = normalize_flowchart(flow)
                if chart:
                    mermaid = flowchart_to_mermaid(chart)
                else:
                    mermaid = mermaid or DEFAULT_FLOWCHART
                    chart = mermaid_to_flowchart(mermaid)
                flow = chart
            result.append({"type": "diagram", "sequence": sequence, "mermaid": mermaid, "flow": flow})
    return result


def default_flow():
    return default_sequence_flow()


def sanitize_content(content: dict, templates: list[dict]) -> dict:
    incoming = (content or {}).get("sections") or {}
    sections = {}
    for template in templates:
        section_id = template["template_id"]
        source = incoming.get(section_id) or {}
        sections[section_id] = {
            "template_id": section_id,
            "title": template["section_name"],
            "blocks": _sanitize_blocks(source.get("blocks") or [], template["schema_json"]["blocks"]),
            "missing": [],
        }
    return evaluate_missing({"sections": sections})


def section_is_empty(section: dict | None, template: dict | None = None) -> bool:
    """True when a section holds nothing a person or the model wrote yet (only blanks, starter rows or the starter diagram)."""
    starters = {
        DEFAULT_FLOWCHART.strip(),
        flowchart_to_mermaid(default_flowchart()).strip(),
        flow_to_mermaid(default_flow()).strip(),
    }
    schema_blocks = ((template or {}).get("schema_json") or {}).get("blocks") or (template or {}).get("blocks") or []
    schema_tables = [block for block in schema_blocks if block.get("type") == "table"]
    table_index = 0
    for block in (section or {}).get("blocks") or []:
        kind = block.get("type")
        if kind == "prose" and _as_text(block.get("markdown")).strip():
            return False
        if kind == "table":
            starter = schema_tables[table_index] if table_index < len(schema_tables) else {}
            table_index += 1
            starter_rows = [[_as_text(cell) for cell in row] for row in starter.get("rows") or []]
            rows = [[_as_text(cell) for cell in row] for row in block.get("rows") or []]
            if rows != starter_rows and any(cell.strip() for row in rows for cell in row):
                return False
        if kind == "diagram":
            text = _as_text(block.get("mermaid")).strip()
            if text and text not in starters:
                return False
        if kind == "image" and _as_text(block.get("url")).strip():
            return False
    return True
