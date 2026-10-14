"""Per-project RAG over the reference documents uploaded to a project."""

import logging
import uuid
from datetime import datetime, timezone

from app import db
from app.services import llm
from app.services.retrieve import _tokens, score_text

logger = logging.getLogger(__name__)

CHUNK_SIZE = 800
CHUNK_OVERLAP = 120


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into ~size character chunks, preferring paragraph/line/sentence/word boundaries."""
    text = (text or "").strip()
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    length = len(text)
    while start < length:
        end = min(start + size, length)
        if end < length:
            window = text[start:end]
            cut = max(window.rfind("\n\n"), window.rfind("\n"), window.rfind(". "), window.rfind(" "))
            if cut > size // 2:
                end = start + cut + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= length:
            break
        start = max(end - overlap, start + 1)
    return chunks


def index_document(project_id: str, doc_id: str, text: str) -> int:
    """Replace the chunks of one document. Embeds each chunk when an embedding model is configured."""
    remove_document(doc_id)
    chunks = chunk_text(text)
    embed = llm.embedding_configured()
    for index, content in enumerate(chunks):
        vector = None
        if embed:
            vector = llm.embed(content)
        db.exec_sql(
            """
            INSERT INTO project_rag_chunks (chunk_id, project_id, doc_id, chunk_index, content, embedding, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [str(uuid.uuid4()), project_id, doc_id, index, content, vector, datetime.now(timezone.utc)],
        )
    return len(chunks)


def remove_document(doc_id: str) -> None:
    db.exec_sql("DELETE FROM project_rag_chunks WHERE doc_id = ?", [doc_id])


def remove_project(project_id: str) -> None:
    db.exec_sql("DELETE FROM project_rag_chunks WHERE project_id = ?", [project_id])


def index_missing() -> int:
    """Lexically index reference documents that predate project RAG. Runs at startup; needs no API key."""
    rows = db.fetchall(
        """
        SELECT d.doc_id, d.project_id, d.extracted_text
        FROM baseline_docs d
        WHERE NOT EXISTS (SELECT 1 FROM project_rag_chunks c WHERE c.doc_id = d.doc_id)
        """
    )
    indexed = 0
    for row in rows:
        text = row["extracted_text"] or ""
        for index, content in enumerate(chunk_text(text)):
            db.exec_sql(
                """
                INSERT INTO project_rag_chunks (chunk_id, project_id, doc_id, chunk_index, content, embedding, created_at)
                VALUES (?, ?, ?, ?, ?, NULL, ?)
                """,
                [str(uuid.uuid4()), row["project_id"], row["doc_id"], index, content, datetime.now(timezone.utc)],
            )
        indexed += 1
    return indexed


def chunk_stats(project_id: str) -> dict[str, dict]:
    """doc_id -> {chunks, embedded} for one project."""
    rows = db.fetchall(
        """
        SELECT doc_id, COUNT(*) AS chunks, SUM(CASE WHEN embedding IS NULL THEN 0 ELSE 1 END) AS embedded
        FROM project_rag_chunks WHERE project_id = ? GROUP BY doc_id
        """,
        [project_id],
    )
    return {row["doc_id"]: {"chunks": int(row["chunks"]), "embedded": int(row["embedded"] or 0)} for row in rows}


def retrieve(project_id: str, query: str, limit: int = 8) -> list[dict]:
    """Top chunks of this project's references. Never touches other projects' documents."""
    rows = db.fetchall(
        """
        SELECT c.doc_id, c.chunk_index, c.content, c.embedding, d.file_name
        FROM project_rag_chunks c JOIN baseline_docs d ON d.doc_id = c.doc_id
        WHERE c.project_id = ?
        """,
        [project_id],
    )
    if not rows:
        return []
    query_tokens = _tokens(query)
    query_vector = None
    if llm.embedding_configured():
        try:
            query_vector = llm.embed(query)
        except Exception:
            logger.exception("Query embedding failed")
    scored = []
    for row in rows:
        score = score_text(query_tokens, row["content"], query_vector, row.get("embedding"))
        if score > 0:
            scored.append(
                {
                    "doc_id": row["doc_id"],
                    "file_name": row["file_name"],
                    "chunk_index": row["chunk_index"],
                    "content": row["content"],
                    "score": score,
                }
            )
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[:limit]
