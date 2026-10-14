import io
import re
from pathlib import Path

from bs4 import BeautifulSoup

from app.errors import AppError

BASELINE_EXTENSIONS = {".pdf", ".md", ".markdown", ".xlsx", ".xls"}
RAG_EXTENSIONS = {".pdf", ".md", ".markdown", ".html", ".htm"}
GUIDELINE_EXTENSIONS = {".md", ".markdown", ".pdf", ".txt"}
MAX_BYTES = 20 * 1024 * 1024

INVENTORY_TYPES = (
    "Interfaces",
    "Table Definitions",
    "Bitbucket Repos",
    "Capabilities",
    "Reports",
    "Guidelines",
    "Screens",
    "Batches",
)
PREFIX = {
    "Interfaces": "IF",
    "Table Definitions": "TD",
    "Bitbucket Repos": "RE",
    "Capabilities": "CA",
    "Reports": "RP",
    "Guidelines": "GL",
    "Screens": "SC",
    "Batches": "BA",
}
HEADER_ALIASES = {
    "system": "system",
    "system name": "system",
    "country": "country",
    "protocol": "protocol",
    "purpose": "purpose",
    "repo": "repo_name",
    "repo name": "repo_name",
    "repository": "repo_name",
    "framework": "framework",
    "l1": "l1_capability",
    "l1 capability": "l1_capability",
    "l2": "l2_capability",
    "l2 capability": "l2_capability",
    "table": "table",
    "column": "column",
    "keys": "keys",
    "key": "keys",
    "guideline": "guideline_name",
    "guideline name": "guideline_name",
    "name": "guideline_name",
    "request": "request_fields",
    "request fields": "request_fields",
    "response": "response_fields",
    "response fields": "response_fields",
    "sample": "samples",
    "samples": "samples",
    "proposing logic": "proposing_logic",
    "logic": "proposing_logic",
}


def safe_name(filename: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name) or "upload"


def extract_text(filename: str, data: bytes, allowed: set[str]) -> str:
    if len(data) > MAX_BYTES:
        raise AppError(400, "File exceeds 20 MB.")
    ext = Path(filename).suffix.lower()
    if ext not in allowed:
        raise AppError(400, "Unsupported file type.")
    if ext in {".md", ".markdown", ".txt"}:
        return data.decode("utf-8", errors="replace")
    if ext == ".pdf":
        import pdfplumber

        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages)
        except Exception as exc:
            raise AppError(400, "The PDF could not be read. Check that it is a valid, unprotected PDF.") from exc
    if ext in {".xlsx", ".xls"}:
        import pandas as pd

        sheets = pd.read_excel(io.BytesIO(data), sheet_name=None)
        parts = []
        for name, frame in sheets.items():
            parts.append(f"# {name}\n{frame.to_csv(index=False)}")
        return "\n".join(parts)
    soup = BeautifulSoup(data, "lxml")
    return soup.get_text("\n")


def _split_row(line: str) -> list[str]:
    core = line.strip()
    if core.startswith("|"):
        core = core[1:]
    if core.endswith("|"):
        core = core[:-1]
    return [cell.strip() for cell in core.split("|")]


def _is_separator(line: str) -> bool:
    if not line.strip().startswith("|"):
        return False
    cells = _split_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def _tables(lines: list[str]) -> list[dict]:
    tables = []
    index = 0
    while index < len(lines):
        if index + 1 < len(lines) and lines[index].strip().startswith("|") and _is_separator(lines[index + 1]):
            header = _split_row(lines[index])
            index += 2
            rows = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append(_split_row(lines[index]))
                index += 1
            tables.append({"columns": header, "rows": rows})
            continue
        index += 1
    return tables


def classify_heading(title: str) -> str | None:
    lowered = title.lower()
    if "interface" in lowered:
        return "Interfaces"
    if "bitbucket" in lowered or "repo" in lowered:
        return "Bitbucket Repos"
    if "table definition" in lowered or lowered.strip() in {"tables", "table definitions"}:
        return "Table Definitions"
    if "capabilit" in lowered:
        return "Capabilities"
    if "report" in lowered:
        return "Reports"
    if "guideline" in lowered:
        return "Guidelines"
    if "screen" in lowered:
        return "Screens"
    if "batch" in lowered:
        return "Batches"
    return None


def _map_row(columns: list[str], row: list[str]) -> dict:
    parsed: dict[str, str] = {}
    for index, column in enumerate(columns):
        key = HEADER_ALIASES.get(column.strip().lower())
        value = row[index].strip() if index < len(row) else ""
        if key:
            parsed[key] = value
        elif column.strip():
            parsed[column.strip()] = value
    return parsed


def _sections(text: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, list[str]]] = []
    current_title = "Document"
    current: list[str] = []
    for line in text.splitlines():
        match = re.match(r"^#{1,3}\s+(.*)$", line.strip())
        if match:
            sections.append((current_title, current))
            current_title = match.group(1).strip()
            current = []
        else:
            current.append(line)
    sections.append((current_title, current))
    return [(title, "\n".join(lines)) for title, lines in sections]


def heuristic_entities(filename: str, text: str, forced_type: str | None = None) -> list[dict]:
    entities = []
    for title, body in _sections(text):
        inventory_type = forced_type or classify_heading(title)
        if not inventory_type:
            continue
        found = False
        for table in _tables(body.splitlines()):
            for row in table["rows"]:
                if not any(cell.strip() for cell in row):
                    continue
                parsed = _map_row(table["columns"], row)
                entities.append(
                    {
                        "inventory_type": inventory_type,
                        "system_name": parsed.get("system") or Path(filename).stem,
                        "parsed": parsed,
                        "raw_content": " | ".join(cell for cell in row if cell.strip()),
                    }
                )
                found = True
        if not found and body.strip():
            entities.append(
                {
                    "inventory_type": inventory_type,
                    "system_name": Path(filename).stem,
                    "parsed": {"purpose": body.strip()[:1000]},
                    "raw_content": body.strip()[:2000],
                }
            )
    if entities:
        return entities
    return [
        {
            "inventory_type": forced_type or "Guidelines",
            "system_name": Path(filename).stem,
            "parsed": {"guideline_name": Path(filename).stem, "purpose": text.strip()[:1000]},
            "raw_content": text.strip()[:4000],
        }
    ]


def extract_entities(filename: str, text: str, forced_type: str | None = None) -> list[dict]:
    from app.services import llm

    if llm.configured():
        try:
            raw = llm.complete(
                "Extract architecture inventory entities. Return JSON "
                '{"entities":[{"inventory_type":"Interfaces|Table Definitions|Bitbucket Repos|Capabilities|Reports|Guidelines|Screens|Batches",'
                '"system_name":"","parsed":{},"raw_content":""}]}.',
                f"FILE: {filename}\n\n{text[:12000]}",
                0,
            )
            import json

            parsed = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
            entities = []
            for item in parsed.get("entities") or []:
                if item.get("inventory_type") not in INVENTORY_TYPES:
                    continue
                entities.append(
                    {
                        "inventory_type": forced_type or item["inventory_type"],
                        "system_name": item.get("system_name") or Path(filename).stem,
                        "parsed": item.get("parsed") or {},
                        "raw_content": item.get("raw_content") or "",
                    }
                )
            if entities:
                return entities
        except Exception:
            pass
    return heuristic_entities(filename, text, forced_type)
