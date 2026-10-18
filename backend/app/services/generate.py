import json
import re

from app import db
from app.config import DIAGRAM_RULES, GENERATION_RULES
from app.content import diagram_block, diagram_groups, header_block, image_block, number_rows
from app.services import llm


def _limit_words(markdown: str, max_words: int) -> str:
    words = markdown.split()
    if max_words <= 0 or len(words) <= max_words:
        return markdown
    return " ".join(words[:max_words])


def _parse_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.S)
        if not match:
            raise
        return json.loads(match.group(0))


# Header and image blocks are authored by people; the model never writes them.
STATIC_BLOCKS = {"header", "image"}


def _generated_schema(schema_blocks: list[dict]) -> list[dict]:
    return [block for block in schema_blocks if block.get("type") not in STATIC_BLOCKS]


def _first_text(block: dict, *names: str) -> str:
    """The first of the named fields that holds text; models sometimes rename a field (`content` for `markdown`)."""
    for name in names:
        value = block.get(name)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _apply(schema_blocks: list[dict], payload: dict, max_words: int, existing: list[dict] | None = None) -> list[dict]:
    incoming = [block for block in payload.get("blocks") or [] if isinstance(block, dict)]
    pools: dict[str, list] = {}
    for block in incoming:
        pools.setdefault(block.get("type"), []).append(block)
    kept: dict[str, list] = {}
    for block in existing or []:
        if isinstance(block, dict) and block.get("type") in STATIC_BLOCKS:
            kept.setdefault(block["type"], []).append(block)
    groups = diagram_groups(existing)
    group_index = 0
    result = []
    index = 0
    while index < len(schema_blocks):
        schema = schema_blocks[index]
        kind = schema.get("type")
        if kind in STATIC_BLOCKS:
            previous = kept.get(kind, [])
            source = previous.pop(0) if previous else None
            result.append(header_block(schema, source) if kind == "header" else image_block(schema, source))
            index += 1
            continue
        if kind == "diagram":
            run = 1
            while index + run < len(schema_blocks) and schema_blocks[index + run].get("type") == "diagram":
                run += 1
            group = groups[group_index] if group_index < len(groups) else []
            if group:
                group_index += 1
            model_diagrams = pools.get("diagram", [])
            for offset in range(run):
                found = model_diagrams.pop(0) if model_diagrams else {}
                sequence = bool(schema_blocks[index + offset].get("sequence"))
                text = _first_text(found, "mermaid", "code", "diagram", "source")
                result.append(diagram_block({"mermaid": text} if text else None, sequence))
            for extra in group[run:]:
                result.append(diagram_block(extra, bool(extra.get("sequence"))))
            index += run
            continue
        source = pools.get(kind, [])
        found = source.pop(0) if source else {}
        if kind == "prose":
            result.append({"type": "prose", "markdown": _limit_words(_first_text(found, "markdown", "content", "text", "body"), max_words)})
        elif kind == "table":
            columns = list(schema.get("columns") or [])
            rows = []
            for row in found.get("rows") or []:
                cells = ["" if cell is None else str(cell) for cell in row]
                if len(cells) < len(columns):
                    cells.extend([""] * (len(columns) - len(cells)))
                rows.append(cells[: len(columns)])
            if not rows:
                rows = [[""] * len(columns)]
            result.append({"type": "table", "columns": columns, "rows": number_rows(columns, rows)})
        index += 1
    for group in groups[group_index:]:
        for extra in group:
            result.append(diagram_block(extra, bool(extra.get("sequence"))))
    return result


def _reference_context(project_id: str | None, query: str, baselines: list[dict]) -> str:
    """Project RAG excerpts; falls back to truncated full text when nothing is indexed."""
    if project_id:
        try:
            from app.services import project_rag

            chunks = project_rag.retrieve(project_id, query, limit=8)
        except Exception:
            chunks = []
        if chunks:
            return "\n\n".join(f"[{item['file_name']} #{item['chunk_index'] + 1}]\n{item['content']}" for item in chunks)
    documents = []
    budget = 15000
    for baseline in baselines:
        text = (baseline.get("extracted_text") or "")[:budget]
        documents.append(f"FILE {baseline.get('file_name')}:\n{text}")
        budget -= len(text)
        if budget <= 0:
            break
    return "\n".join(documents)


def _project_context(project_id: str | None) -> str:
    row = db.fetchone("SELECT project_name, description FROM projects WHERE project_id = ?", [project_id]) if project_id else None
    if not row:
        return ""
    description = " ".join(str(row.get("description") or "").split())
    return f"PROJECT: {row['project_name']}\nPROJECT_DESCRIPTION: {description or 'None given.'}\n"


def generate_section(
    template: dict,
    baselines: list[dict],
    settings: dict,
    project_id: str | None = None,
    existing: dict | None = None,
    instruction: str = "",
) -> dict:
    query = f"{template['section_name']} {template.get('hint') or ''}"
    hits = []
    try:
        from app.services.retrieve import retrieve

        hits = retrieve(query, limit=6)
    except Exception:
        hits = []
    references = _reference_context(project_id, query, baselines)
    has_diagram = any(block.get("type") == "diagram" for block in template["schema_json"]["blocks"])
    user = (
        f"{_project_context(project_id)}"
        f"SECTION: {template['section_name']}\n"
        f"HINT: {template.get('hint') or ''}\n"
        f"MAX_WORDS: {template['max_words']}\n"
        f"BLOCK_SCHEMA: {json.dumps(_generated_schema(template['schema_json']['blocks']))}\n"
        f"PROJECT_REFERENCES:\n{references or 'None uploaded.'}\n"
        f"INVENTORY:\n{json.dumps(hits)[:6000]}\n"
        "Infer this section from the project references and the knowledge-base inventory. "
        "Follow the section prompt. Return JSON {\"blocks\": [...]} with one object per block in BLOCK_SCHEMA order, shaped "
        "exactly as {\"type\": \"prose\", \"markdown\": \"...\"}, {\"type\": \"table\", \"columns\": [...], \"rows\": [[...]]} or "
        "{\"type\": \"diagram\", \"mermaid\": \"...\"}. Table columns must match the schema. "
        "Leave a fact that is not in the context empty or write 'To be confirmed'. Do not invent volumetric numbers."
        + (f"\n{DIAGRAM_RULES}" if has_diagram else "")
    )
    extra = " ".join((instruction or "").split())[:1000]
    if extra:
        user += f"\nADDITIONAL INSTRUCTION FROM THE USER FOR THIS RUN (follow it unless it conflicts with the rules above): {extra}"
    system = f"{settings['global_system_prompt']}\n{template['system_prompt']}\n{GENERATION_RULES}"
    previous = (existing or {}).get("blocks") or []
    raw = llm.complete(system, user, float(template["temperature"]))
    try:
        payload = _parse_json(raw)
        blocks = _apply(template["schema_json"]["blocks"], payload, int(template["max_words"]), previous)
    except (json.JSONDecodeError, ValueError):
        blocks = _apply(
            template["schema_json"]["blocks"],
            {"blocks": [{"type": "prose", "markdown": raw[:4000]}]},
            int(template["max_words"]),
            previous,
        )
    return {
        "template_id": template["template_id"],
        "title": template["section_name"],
        "blocks": blocks,
        "missing": [],
    }
