import json
import math
import re

from app import db
from app.services import llm


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def score_text(query_tokens: set[str], text: str, query_vector: list[float] | None, embedding) -> float:
    """Hybrid score shared by the knowledge base and project references: token overlap + 5x cosine."""
    lexical = len(query_tokens & _tokens(text))
    semantic = 0.0
    if query_vector and embedding is not None and len(embedding):
        semantic = _cosine(query_vector, list(embedding))
    return lexical + semantic * 5


def retrieve(query: str, limit: int = 6) -> list[dict]:
    rows = db.fetchall(
        "SELECT rag_id, inventory_type, system_name, raw_content, parsed_json, embedding FROM rag_inventory"
    )
    query_tokens = _tokens(query)
    query_vector = llm.embed(query) if llm.embedding_configured() else None
    scored = []
    for row in rows:
        parsed = row.get("parsed_json") or ""
        score = score_text(
            query_tokens,
            f"{row.get('raw_content') or ''} {parsed} {row.get('inventory_type') or ''}",
            query_vector,
            row.get("embedding"),
        )
        if score <= 0:
            continue
        payload = json.loads(parsed) if isinstance(parsed, str) and parsed else parsed
        scored.append(
            {
                "rag_id": row["rag_id"],
                "inventory_type": row["inventory_type"],
                "system_name": row["system_name"],
                "raw_content": (row.get("raw_content") or "")[:500],
                "parsed": payload,
                "score": score,
            }
        )
    scored.extend(_guideline_hits(query_tokens, query_vector))
    scored.extend(_system_hits(query_tokens, query_vector))
    scored.extend(_interface_hits(query_tokens, query_vector))
    scored.sort(key=lambda item: item["score"], reverse=True)
    top = scored[:limit]
    return top + _related_systems(top)


def _entry(rag_id: str, inventory_type: str, name: str, text: str, parsed: dict, score: float) -> dict:
    return {"rag_id": rag_id, "inventory_type": inventory_type, "system_name": name, "raw_content": text, "parsed": parsed, "score": score}


def _system_hits(query_tokens: set[str], query_vector: list[float] | None) -> list[dict]:
    """Systems of the catalogue. A question that names a system code always finds it."""
    from app.services import systems

    hits = []
    for row in db.fetchall("SELECT * FROM systems"):
        text = systems.text_for(row)
        score = score_text(query_tokens, text, query_vector, row.get("embedding"))
        if row["system_code"].lower() in query_tokens:
            score += 3
        if score <= 0:
            continue
        hits.append(_entry(row["system_code"], "Systems", row["system_name"], text, {"upstreams": row["upstreams"], "downstreams": row["downstreams"]}, score))
    return hits


def _interface_hits(query_tokens: set[str], query_vector: list[float] | None) -> list[dict]:
    """Interfaces from the channel uploads. A question that names the source or destination system finds them."""
    from app.services import interfaces

    hits = []
    for row in db.fetchall("SELECT * FROM interfaces"):
        text = interfaces.text_for(row)
        score = score_text(query_tokens, text, query_vector, row.get("embedding"))
        score += sum(1 for code in (row["source"], row["destination"]) if code.lower() in query_tokens)
        if score <= 0:
            continue
        hits.append(_entry(row["interface_id"], "Interfaces", row["interface_name"], text, {"channel": row["channel"]}, score))
    return hits


def _related_systems(hits: list[dict], most: int = 3) -> list[dict]:
    """The direct upstream and downstream systems of the best matching systems, so 'what is downstream of X' is answered fully."""
    from app.services import systems

    present = {item["rag_id"] for item in hits}
    wanted: list[str] = []
    for item in [hit for hit in hits if hit["inventory_type"] == "Systems"][:most]:
        for code in systems.split_codes(item["parsed"].get("upstreams")) + systems.split_codes(item["parsed"].get("downstreams")):
            if code not in present and code not in wanted:
                wanted.append(code)
    related = []
    for code in wanted:
        row = db.fetchone("SELECT * FROM systems WHERE system_code = ?", [code])
        if row is not None:
            related.append(_entry(code, "Systems", row["system_name"], systems.text_for(row), {"upstreams": row["upstreams"], "downstreams": row["downstreams"], "related": True}, 0.0))
    return related


_ORDER = ("Systems", "Interfaces", "Capabilities", "Table Definitions", "Screens", "Batches", "Reports", "Guidelines", "Bitbucket Repos")


def summary() -> str:
    """What the knowledge base holds, so questions such as 'which systems exist' are answered from the whole of it."""
    lines = []
    catalogue = db.fetchall("SELECT system_code, system_name FROM systems ORDER BY system_code")
    if catalogue:
        listed = ", ".join(f"{row['system_code']} ({row['system_name']})" for row in catalogue[:60])
        more = f", and {len(catalogue) - 60} more" if len(catalogue) > 60 else ""
        lines.append(f"Systems ({len(catalogue)}): {listed}{more}")
    channels = db.fetchall("SELECT channel, COUNT(*) AS c FROM interfaces GROUP BY channel ORDER BY channel")
    if channels:
        lines.append("Interfaces: " + ", ".join(f"{row['channel']} {row['c']}" for row in channels))
    for row in db.fetchall("SELECT inventory_type, COUNT(*) AS c FROM rag_inventory GROUP BY inventory_type ORDER BY inventory_type"):
        lines.append(f"{row['inventory_type']}: {row['c']} entries")
    guidelines = db.fetchone("SELECT COUNT(*) AS c FROM guidelines")
    if guidelines and guidelines["c"]:
        lines.append(f"Guidelines: {guidelines['c']} documents")
    return "\n".join(lines)


def format_context(hits: list[dict], limit_chars: int = 12000) -> str:
    """Hits as labelled text, one section per type, cut at limit_chars. Far easier for the model than one JSON blob."""
    groups: dict[str, list[dict]] = {}
    for hit in hits:
        groups.setdefault(hit["inventory_type"], []).append(hit)
    order = [name for name in _ORDER if name in groups] + [name for name in groups if name not in _ORDER]
    out: list[str] = []
    used = 0
    for name in order:
        header = f"[{name}]"
        out.append(header)
        used += len(header) + 1
        for hit in groups[name]:
            if hit["inventory_type"] in ("Systems", "Interfaces"):
                body = hit["raw_content"]
            else:
                extra = {key: value for key, value in (hit.get("parsed") or {}).items() if value}
                body = f"{hit['system_name'] or ''}: {hit['raw_content']} {json.dumps(extra) if extra else ''}".strip()
            line = f"- {hit['rag_id']}: {body}"
            if used + len(line) > limit_chars:
                return "\n".join(out)
            out.append(line)
            used += len(line) + 1
    return "\n".join(out)


def _guideline_hits(query_tokens: set[str], query_vector: list[float] | None) -> list[dict]:
    """Chunks of uploaded guideline documents, scored like any other inventory entry."""
    rows = db.fetchall(
        """
        SELECT c.guideline_id, c.chunk_index, c.content, c.embedding, g.title, g.description
        FROM guideline_chunks c JOIN guidelines g ON g.guideline_id = c.guideline_id
        """
    )
    hits = []
    for row in rows:
        score = score_text(
            query_tokens,
            f"{row['title']} {row['description']} {row['content']} Guidelines",
            query_vector,
            row.get("embedding"),
        )
        if score <= 0:
            continue
        hits.append(
            {
                "rag_id": f"{row['guideline_id']}#{row['chunk_index']}",
                "inventory_type": "Guidelines",
                "system_name": row["title"],
                "raw_content": (row["content"] or "")[:500],
                "parsed": {"guideline_name": row["title"], "description": row["description"]},
                "score": score,
            }
        )
    return hits
