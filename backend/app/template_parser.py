import re
from pathlib import Path

DIAGRAM_SLUGS = {"high-level-flow", "data-model", "downstream-data-flow-reports"}
SEQUENCE_SLUGS = {"happy-flows", "exception-flows"}
HEADING = re.compile(r"^(#{2,3})\s+(.*)$")


def slugify(name: str) -> str:
    cleaned = name.replace("<", " ").replace(">", " ").strip().lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", cleaned)
    return cleaned.strip("-") or "section"


def display_name(name: str) -> str:
    return name.replace("<", "").replace(">", "").strip()


def split_row(line: str) -> list[str]:
    core = line.strip()
    if core.startswith("|"):
        core = core[1:]
    if core.endswith("|"):
        core = core[:-1]
    return [cell.strip() for cell in core.split("|")]


def is_separator(line: str) -> bool:
    if not line.strip().startswith("|"):
        return False
    cells = split_row(line)
    if not cells:
        return False
    return all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def is_hint(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.startswith("*") and stripped.endswith("*"):
        return True
    return stripped.startswith("<<") and stripped.endswith(">>")


def clean_hint(line: str) -> str:
    stripped = line.strip().strip("*").strip()
    return stripped.strip("<>").strip()


def parse_body(lines: list[str]) -> tuple[list[dict], str]:
    tables: list[dict] = []
    hints: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if index + 1 < len(lines) and line.strip().startswith("|") and is_separator(lines[index + 1]):
            header = [cell if cell else f"Column {n + 1}" for n, cell in enumerate(split_row(line))]
            index += 2
            rows: list[list[str]] = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                row = split_row(lines[index])
                if len(row) < len(header):
                    row.extend([""] * (len(header) - len(row)))
                rows.append(row[: len(header)])
                index += 1
            if not rows:
                rows = [[""] * len(header)]
            tables.append({"columns": header, "rows": rows})
            continue
        if is_hint(line):
            hint = clean_hint(line)
            if hint:
                hints.append(hint)
        index += 1
    return tables, " ".join(hints)


def classify(section_id: str, tables: list[dict]) -> tuple[str, list[dict]]:
    if section_id in SEQUENCE_SLUGS:
        blocks = [
            {"type": "table", "columns": table["columns"], "rows": table["rows"]} for table in tables
        ]
        if not blocks:
            blocks = [
                {
                    "type": "table",
                    "columns": ["SN", "Use Case", "Sequence Diagram"],
                    "rows": [["", "", ""]],
                }
            ]
        blocks.append({"type": "diagram", "sequence": True})
        return "mixed", blocks
    if section_id in DIAGRAM_SLUGS:
        return "diagram", [{"type": "diagram", "sequence": False}]
    if tables:
        return "table", [
            {"type": "table", "columns": table["columns"], "rows": table["rows"]} for table in tables
        ]
    return "prose", [{"type": "prose"}]


def default_prompt(name: str, hint: str) -> str:
    prompt = f"Write the '{name}' section of a Solution Design Document."
    if hint:
        prompt += f" Guidance: {hint}"
    prompt += (
        " Use only the baseline and inventory context. If a value is unknown, use an empty string. "
        "Return JSON with a blocks array matching the schema."
    )
    return prompt


def parse_template(path: Path) -> list[dict]:
    chunks: list[dict] = []
    current: dict | None = None
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        match = HEADING.match(line)
        if match:
            if current:
                chunks.append(current)
            current = {"level": len(match.group(1)), "title": match.group(2).strip(), "lines": []}
        elif current is not None:
            current["lines"].append(line)
    if current:
        chunks.append(current)

    templates: list[dict] = []
    seen: set[str] = set()
    parent_index = 0
    child_index = 0
    parent_id: str | None = None
    for chunk in chunks:
        name = display_name(chunk["title"])
        section_id = slugify(name)
        if section_id in seen:
            section_id = f"{section_id}-{len(seen)}"
        seen.add(section_id)
        tables, hint = parse_body(chunk["lines"])
        if chunk["level"] == 2:
            parent_index += 1
            child_index = 0
            parent_id = None
            sequence = parent_index * 100
        else:
            child_index += 1
            sequence = parent_index * 100 + child_index
        kind, blocks = classify(section_id, tables)
        row_parent = parent_id
        templates.append(
            {
                "template_id": section_id,
                "parent_id": row_parent,
                "section_name": name,
                "sequence_order": sequence,
                "system_prompt": default_prompt(name, hint),
                "temperature": 0.2,
                "max_words": 2000,
                "content_kind": kind,
                "schema_json": {"blocks": blocks},
                "hint": hint,
            }
        )
        if chunk["level"] == 2:
            parent_id = section_id
    return templates
