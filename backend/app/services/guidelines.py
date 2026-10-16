"""Guideline documents: a title, a description and a file that is chunked and embedded for RAG."""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app import db
from app.config import KB_EDITORS, data_dir
from app.errors import AppError
from app.services import files, gcs, llm
from app.services.project_rag import chunk_text

logger = logging.getLogger(__name__)

PREFIX = "GL"
MAX_TITLE = 200
MAX_DESCRIPTION = 2000
MAX_CHUNKS = 1000
# The description is added to every embedded chunk, so it is kept short there.
EMBED_DESCRIPTION_CHARS = 300


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_editor(user: dict) -> None:
    if user["role_name"] not in KB_EDITORS:
        raise AppError(403, "Forbidden")


def current_embedding_model() -> str:
    """Identifier of the embedding model new vectors would be made with; empty when none is configured."""
    from app.services import llm_settings

    if not llm.embedding_configured():
        return ""
    provider = llm_settings.active_provider()
    return f"{provider}:{llm_settings.runtime_config(provider).embedding_model}"


def _status(row: dict, current: str) -> str:
    chunks = int(row["chunk_count"] or 0)
    embedded = int(row["embedded_count"] or 0)
    if embedded == 0:
        return "keyword_only"
    if embedded < chunks or (current and row["embedding_model"] != current):
        return "outdated"
    return "embedded"


def _payload(row: dict, current: str) -> dict:
    return {
        "guideline_id": row["guideline_id"],
        "title": row["title"],
        "description": row["description"],
        "file_name": row["file_name"],
        "file_type": row["file_type"],
        "has_file": bool(row["storage_path"]),
        "chunk_count": int(row["chunk_count"] or 0),
        "embedded_count": int(row["embedded_count"] or 0),
        "embedding_model": row["embedding_model"],
        "status": _status(row, current),
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "indexed_at": row["indexed_at"],
    }


def _row(guideline_id: str) -> dict:
    row = db.fetchone("SELECT * FROM guidelines WHERE guideline_id = ?", [guideline_id])
    if row is None:
        raise AppError(404, "Guideline not found")
    return row


def list_guidelines() -> list[dict]:
    current = current_embedding_model()
    rows = db.fetchall("SELECT * FROM guidelines ORDER BY created_at DESC, guideline_id DESC")
    return [_payload(row, current) for row in rows]


def get_guideline(guideline_id: str) -> dict:
    return _payload(_row(guideline_id), current_embedding_model())


def _next_id() -> str:
    number = 1
    for row in db.fetchall("SELECT guideline_id FROM guidelines WHERE guideline_id LIKE ?", [f"{PREFIX}-%"]):
        try:
            number = max(number, int(row["guideline_id"].split("-", 1)[1]) + 1)
        except (IndexError, ValueError):
            continue
    return f"{PREFIX}-{number:04d}"


def _embed_input(title: str, description: str, chunk: str) -> str:
    return "\n".join(part for part in (title, description[:EMBED_DESCRIPTION_CHARS], chunk) if part)


def _embed_chunks(title: str, description: str, chunks: list[str]) -> tuple[list[list[float] | None], str]:
    """One vector per chunk (None when unavailable) and the identifier of the model that made them."""
    if not llm.embedding_configured():
        return [None] * len(chunks), ""
    model = current_embedding_model()
    return [llm.embed(_embed_input(title, description, chunk)) for chunk in chunks], model


def _store_chunks(guideline_id: str, chunks: list[str], vectors: list[list[float] | None]) -> None:
    db.exec_sql("DELETE FROM guideline_chunks WHERE guideline_id = ?", [guideline_id])
    for index, (content, vector) in enumerate(zip(chunks, vectors, strict=True)):
        db.exec_sql(
            "INSERT INTO guideline_chunks (chunk_id, guideline_id, chunk_index, content, embedding) VALUES (?, ?, ?, ?, ?)",
            [str(uuid.uuid4()), guideline_id, index, content, vector],
        )


def _update_index(guideline_id: str, chunks: list[str], vectors: list[list[float] | None], model: str) -> None:
    embedded = sum(1 for vector in vectors if vector)
    _store_chunks(guideline_id, chunks, vectors)
    db.exec_sql(
        "UPDATE guidelines SET chunk_count = ?, embedded_count = ?, embedding_model = ?, indexed_at = ? WHERE guideline_id = ?",
        [len(chunks), embedded, model if embedded else "", _now(), guideline_id],
    )


def _chunks_for(text: str) -> list[str]:
    chunks = chunk_text(text)
    if not chunks:
        raise AppError(400, "No text could be read from the file. Scanned documents need OCR first.")
    if len(chunks) > MAX_CHUNKS:
        raise AppError(400, f"The document is too long to index ({len(chunks)} chunks, limit {MAX_CHUNKS}). Split it into smaller guidelines.")
    return chunks


def _warning(embedded: int, chunks: int) -> str:
    if embedded >= chunks:
        return ""
    if embedded == 0:
        return "Saved without embeddings: configure an embedding model under Settings > LLM and it is re-indexed automatically. It is searched by keyword until then."
    return f"Only {embedded} of {chunks} chunks could be embedded. The rest are searched by keyword until the next re-index."


def create(user: dict, title: str, description: str, filename: str, data: bytes) -> dict:
    _require_editor(user)
    title = (title or "").strip()
    description = (description or "").strip()
    if not title:
        raise AppError(400, "Guideline title is required")
    if len(title) > MAX_TITLE:
        raise AppError(400, f"Title must be {MAX_TITLE} characters or fewer")
    if len(description) > MAX_DESCRIPTION:
        raise AppError(400, f"Description must be {MAX_DESCRIPTION} characters or fewer")
    if not filename:
        raise AppError(400, "Upload a file")
    text = files.extract_text(filename, data, files.GUIDELINE_EXTENSIONS)
    chunks = _chunks_for(text)

    folder = data_dir() / "uploads" / "guidelines"
    folder.mkdir(parents=True, exist_ok=True)
    stored = folder / f"{uuid.uuid4()}_{files.safe_name(filename)}"
    stored.write_bytes(data)

    vectors, model = _embed_chunks(title, description, chunks)
    guideline_id = _next_id()
    db.exec_sql(
        """
        INSERT INTO guidelines (
            guideline_id, title, description, file_name, file_type, storage_path, extracted_text,
            embedding_model, chunk_count, embedded_count, created_by, created_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, 0, ?, ?, NULL)
        """,
        [
            guideline_id,
            title,
            description,
            Path(filename).name,
            Path(filename).suffix.lower().lstrip("."),
            str(stored),
            text,
            user["user_id"],
            _now(),
        ],
    )
    _update_index(guideline_id, chunks, vectors, model)
    gcs.persist_file(stored, _object_name(stored.name))
    gcs.upload_db()
    result = get_guideline(guideline_id)
    result["warning"] = _warning(result["embedded_count"], result["chunk_count"])
    return result


def _object_name(stored_name: str) -> str:
    return f"uploads/guidelines/{stored_name}"


_MEDIA_TYPES = {"md": "text/markdown", "markdown": "text/markdown", "txt": "text/plain", "pdf": "application/pdf"}


def original_file(user: dict, guideline_id: str) -> tuple[Path, str, str]:
    """Path, download name and media type of the file that was uploaded.

    The local copy is used when present; otherwise it is fetched back from the GCS bucket.
    """
    del user
    row = _row(guideline_id)
    if not row["storage_path"]:
        raise AppError(404, "The original file is not available for this guideline.")
    stored = Path(row["storage_path"])
    if not stored.is_file() and not gcs.fetch_file(stored, _object_name(stored.name)):
        raise AppError(404, "The original file could not be found in storage.")
    name = row["file_name"] or stored.name
    return stored, name, _MEDIA_TYPES.get(row["file_type"], "application/octet-stream")


def _chunk_contents(guideline_id: str) -> list[str]:
    rows = db.fetchall("SELECT content FROM guideline_chunks WHERE guideline_id = ? ORDER BY chunk_index", [guideline_id])
    return [row["content"] for row in rows]


def delete(user: dict, guideline_id: str) -> None:
    _require_editor(user)
    row = _row(guideline_id)
    db.exec_sql("DELETE FROM guideline_chunks WHERE guideline_id = ?", [guideline_id])
    db.exec_sql("DELETE FROM guidelines WHERE guideline_id = ?", [guideline_id])
    stored = Path(row["storage_path"]) if row["storage_path"] else None
    if stored is not None:
        if stored.is_file():
            try:
                stored.unlink()
            except OSError:
                logger.warning("Could not remove %s", stored)
        gcs.delete_file(_object_name(stored.name))
    gcs.upload_db()


def migrate_legacy() -> int:
    """Turn old Guidelines inventory entries into guideline documents. Rows are consumed, so this runs once.

    Chunks are indexed by keyword only (no API key needed); the re-index adds vectors.
    """
    rows = db.fetchall("SELECT * FROM rag_inventory WHERE inventory_type = 'Guidelines' ORDER BY rag_id")
    moved = 0
    for row in rows:
        parsed = row.get("parsed_json") or {}
        if isinstance(parsed, str):
            try:
                parsed = json.loads(parsed)
            except json.JSONDecodeError:
                parsed = {}
        text = (row.get("raw_content") or "").strip() or str(parsed.get("purpose") or "").strip()
        title = str(parsed.get("guideline_name") or row.get("system_name") or row.get("source_name") or row["rag_id"]).strip()
        chunks = chunk_text(text)
        guideline_id = row["rag_id"]
        if db.fetchone("SELECT 1 AS x FROM guidelines WHERE guideline_id = ?", [guideline_id]) is not None:
            guideline_id = _next_id()
        db.exec_sql(
            """
            INSERT INTO guidelines (
                guideline_id, title, description, file_name, file_type, storage_path, extracted_text,
                embedding_model, chunk_count, embedded_count, created_by, created_at, indexed_at
            ) VALUES (?, ?, '', ?, ?, '', ?, '', 0, 0, '', ?, ?)
            """,
            [
                guideline_id,
                title[:MAX_TITLE] or guideline_id,
                row.get("source_name") or "",
                Path(row.get("source_name") or "").suffix.lower().lstrip("."),
                text,
                row.get("created_at") or _now(),
                _now(),
            ],
        )
        _update_index(guideline_id, chunks, [None] * len(chunks), "")
        db.exec_sql("DELETE FROM rag_inventory WHERE rag_id = ?", [row["rag_id"]])
        moved += 1
    return moved
