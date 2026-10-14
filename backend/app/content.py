import re

from app.flow import (
    DEFAULT_FLOWCHART,
    STARTER_SEQUENCE,
    default_flowchart,
    default_sequence_flow,
    flow_to_mermaid,
    flowchart_to_mermaid,
)
from app.missing import evaluate_missing

_FENCE = re.compile(r"^```[A-Za-z]*[ \t]*\n(.*?)\n?```$", re.S)


def clean_mermaid(value) -> str:
    """Mermaid text as stored: no surrounding blank lines or ``` fence, which models like to add."""
    text = _as_text(value).replace("\r\n", "\n").strip()
    fenced = _FENCE.match(text)
    return (fenced.group(1) if fenced else text).strip("\n")


_SERIAL_HEADER = re.compile(r"^(?:sn|s/n|s\.n\.?|no\.?|#|serial(?:\s+(?:no\.?|number))?)$", re.I)


def serial_column(columns: list) -> int:
    """Index of the Serial No column (a first column headed SN, S/N, No, # or Serial No), or -1 when the table has none."""
    if columns and _SERIAL_HEADER.match(_as_text(columns[0]).strip()):
        return 0
    return -1


def number_rows(columns: list, rows: list[list[str]]) -> list[list[str]]:
    """The rows with the Serial No column set to 1, 2, 3... in row order. Tables without one are returned as they are."""
    index = serial_column(columns)
    if index < 0:
        return rows
    return [[str(number) if position == index else cell for position, cell in enumerate(row)] for number, row in enumerate(rows, start=1)]


def starter_diagram(sequence: bool) -> str:
    return STARTER_SEQUENCE if sequence else DEFAULT_FLOWCHART


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
            blocks.append({"type": "table", "columns": columns, "rows": number_rows(columns, rows)})
        elif kind == "diagram":
            sequence = bool(block.get("sequence"))
            blocks.append({"type": "diagram", "sequence": sequence, "mermaid": starter_diagram(sequence)})
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
            result.append({"type": "table", "columns": columns, "rows": number_rows(columns, rows)})
        elif kind == "diagram":
            # Any Mermaid is accepted in a diagram block; the layout only decides what a new block starts with.
            sequence = bool(schema.get("sequence"))
            mermaid = clean_mermaid((source or {}).get("mermaid")) or starter_diagram(sequence)
            result.append({"type": "diagram", "sequence": sequence, "mermaid": mermaid})
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


def _without(row: list, index: int) -> list[str]:
    return [_as_text(cell) for position, cell in enumerate(row) if position != index]


def section_is_empty(section: dict | None, template: dict | None = None) -> bool:
    """True when a section holds nothing a person or the model wrote yet (only blanks, starter rows or the starter diagram)."""
    starters = {
        DEFAULT_FLOWCHART.strip(),
        STARTER_SEQUENCE.strip(),
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
            # The Serial No column is numbered by the app, so it says nothing about whether anyone wrote in the table.
            skip = serial_column(block.get("columns") or [])
            starter_rows = [_without(row, skip) for row in starter.get("rows") or []]
            rows = [_without(row, skip) for row in block.get("rows") or []]
            if rows != starter_rows and any(cell.strip() for row in rows for cell in row):
                return False
        if kind == "diagram":
            text = _as_text(block.get("mermaid")).strip()
            if text and text not in starters:
                return False
        if kind == "image" and _as_text(block.get("url")).strip():
            return False
    return True
