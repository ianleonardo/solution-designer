"""Re-index: make every stored embedding again with the active embedding model.

It covers the knowledge base entries, guideline chunks, systems, interfaces and every project's reference chunks.
It runs in the background, starts by itself when the embedding setup changes, and reports progress for the LLM page.
"""

import hashlib
import logging
import threading
from datetime import datetime, timezone

from app import db
from app.services import llm

logger = logging.getLogger(__name__)

_lock = threading.RLock()
_state: dict = {}
_pending: str | None = None  # "full" or "missing": one more run to do when the current one ends
_target = ""


def reset() -> None:
    global _state, _pending, _target
    with _lock:
        _state = {"running": False, "total": 0, "done": 0, "failed": 0, "started_at": None, "finished_at": None, "message": ""}
        _pending = None
        _target = ""


reset()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def status() -> dict:
    with _lock:
        return dict(_state)


def signature() -> str:
    """Identifies the active embedding setup; empty when no embedding model is configured."""
    from app.services import llm_settings

    if not llm.embedding_configured():
        return ""
    provider = llm_settings.active_provider()
    config = llm_settings.runtime_config(provider)
    key = hashlib.sha256((config.embedding_api_key or config.api_key).encode()).hexdigest()[:12]
    return f"{provider}|{config.embedding_model}|{config.embedding_base_url}|{key}"


def _stored_signature() -> str:
    row = db.fetchone("SELECT indexed_embedding_signature AS value FROM app_settings WHERE settings_id = 'default'")
    return (row or {}).get("value") or ""


def _store_signature(value: str) -> None:
    db.exec_sql("UPDATE app_settings SET indexed_embedding_signature = ? WHERE settings_id = 'default'", [value])


def _spawn(job) -> None:
    threading.Thread(target=job, name="reindex", daemon=True).start()


def start_if_needed() -> bool:
    """Start a full re-index when the embedding setup differs from the one the stored vectors were made with."""
    current = signature()
    if current == _stored_signature():
        return False
    _request("full", current)
    return True


def embed_missing_in_background() -> None:
    """Embed rows that have no vector yet (for example a fresh interface upload)."""
    if llm.embedding_configured():
        _request("missing", signature())


def _request(mode: str, target: str) -> None:
    global _pending
    with _lock:
        if _state["running"]:
            if mode == "full" and target == _target:
                return
            _pending = "full" if mode == "full" or _pending == "full" else "missing"
            return
        _begin(mode, target)


def _begin(mode: str, target: str) -> None:
    global _target
    _target = target
    _state.update(running=True, total=0, done=0, failed=0, started_at=_now(), finished_at=None, message="")
    _spawn(lambda: _run(mode, target))


def _tables() -> list[tuple[str, str, str, str]]:
    """(table, key column, text for the row, label) for every embedded table."""
    return [
        ("rag_inventory", "rag_id", "inventory", "knowledge base entries"),
        ("guideline_chunks", "chunk_id", "guideline", "guideline chunks"),
        ("project_rag_chunks", "chunk_id", "project", "project references"),
        ("systems", "system_code", "system", "systems"),
        ("interfaces", "interface_id", "interface", "interfaces"),
        ("kb_tables", "table_id", "kb_table", "database tables"),
        ("kb_reports", "report_id", "kb_report", "reports"),
        ("kb_batches", "batch_id", "kb_batch", "batches"),
        ("kb_capabilities", "capability_id", "kb_capability", "capabilities"),
        ("kb_capability_nodes", "node_id", "kb_capability_node", "L1/L2 capability details"),
        ("kb_bitbucket_repos", "repo_id", "kb_bitbucket", "bitbucket repositories"),
    ]


def _rows(kind: str, only_missing: bool) -> list[tuple[str, str]]:
    """(row id, text to embed) for one table."""
    from app.services import guidelines, interfaces, systems, tables

    where = " WHERE embedding IS NULL" if only_missing else ""
    if kind == "inventory":
        rows = db.fetchall(f"SELECT rag_id, raw_content FROM rag_inventory{where}")
        return [(row["rag_id"], (row["raw_content"] or "")[:2000]) for row in rows]
    if kind == "guideline":
        rows = db.fetchall(
            f"""
            SELECT c.chunk_id, c.content, g.title, g.description
            FROM guideline_chunks c JOIN guidelines g ON g.guideline_id = c.guideline_id
            {'WHERE c.embedding IS NULL' if only_missing else ''}
            """
        )
        return [(row["chunk_id"], guidelines._embed_input(row["title"], row["description"], row["content"])) for row in rows]
    if kind == "project":
        rows = db.fetchall(f"SELECT chunk_id, content FROM project_rag_chunks{where}")
        return [(row["chunk_id"], row["content"]) for row in rows]
    if kind == "system":
        rows = db.fetchall(f"SELECT * FROM systems{where}")
        return [(row["system_code"], systems.text_for(row)) for row in rows]
    if kind == "kb_table":
        rows = db.fetchall(f"SELECT * FROM kb_tables{where}")
        return [(row["table_id"], tables.text_for(row)[:2000]) for row in rows]
    if kind == "kb_report":
        from app.services import reports as reports_svc

        rows = db.fetchall(f"SELECT * FROM kb_reports{where}")
        return [(row["report_id"], reports_svc.text_for(row)[:2000]) for row in rows]
    if kind == "kb_batch":
        from app.services import batches as batches_svc

        rows = db.fetchall(f"SELECT * FROM kb_batches{where}")
        return [(row["batch_id"], batches_svc.text_for(row)[:2000]) for row in rows]
    if kind == "kb_capability":
        from app.services import capabilities as capabilities_svc

        rows = db.fetchall(f"SELECT * FROM kb_capabilities{where}")
        return [(row["capability_id"], capabilities_svc.text_for(row)[: capabilities_svc.EMBED_CHARS]) for row in rows]
    if kind == "kb_capability_node":
        from app.services import capability_nodes as nodes_svc

        rows = db.fetchall(f"SELECT * FROM kb_capability_nodes{where}")
        return [(row["node_id"], nodes_svc.text_for(row)[: nodes_svc.caps.EMBED_CHARS]) for row in rows]
    if kind == "kb_bitbucket":
        from app.services import bitbucket_repos as bitbucket_svc

        rows = db.fetchall(f"SELECT * FROM kb_bitbucket_repos{where}")
        return [(row["repo_id"], bitbucket_svc.text_for(row)[: bitbucket_svc.EMBED_CHARS]) for row in rows]
    rows = db.fetchall(f"SELECT * FROM interfaces{where}")
    return [(row["interface_id"], interfaces.text_for(row)[: interfaces.EMBED_CHARS]) for row in interfaces.attach_fields(rows)]


def _run(mode: str, target: str) -> None:
    global _pending
    only_missing = mode == "missing"
    message = ""
    try:
        embed = llm.embedding_configured()
        if not embed and only_missing:
            only_missing = False
        plan = [(table, key, kind, label, _rows(kind, only_missing)) for table, key, kind, label in _tables()]
        with _lock:
            _state["total"] = sum(len(rows) for *_rest, rows in plan)
        for table, key, kind, label, rows in plan:
            for row_id, text in rows:
                vector = llm.embed(text) if embed and text.strip() else None
                db.exec_sql(f"UPDATE {table} SET embedding = ? WHERE {key} = ?", [vector, row_id])
                with _lock:
                    _state["done"] += 1
                    if embed and vector is None:
                        _state["failed"] += 1
        _refresh_guideline_counts(target if embed else "")
        if not only_missing:
            _store_signature(target)
        from app.services import gcs

        gcs.upload_db()
        with _lock:
            done, failed = _state["done"], _state["failed"]
        if not embed:
            message = f"No embedding model is configured, so {done} stored vectors were cleared. Search uses keywords only."
        elif failed:
            message = f"Re-indexed {done - failed} of {done} items; {failed} could not be embedded and are searched by keyword."
        else:
            message = f"Re-indexed {done} items."
    except Exception as exc:
        logger.exception("Re-index failed")
        message = f"Re-index stopped: {' '.join(str(exc).split())[:300] or exc.__class__.__name__}"
    finally:
        with _lock:
            _state.update(running=False, finished_at=_now(), message=message)
            queued, _pending = _pending, None
    if queued == "full":
        start_if_needed()
    elif queued:
        embed_missing_in_background()


def _refresh_guideline_counts(target: str) -> None:
    from app.services import guidelines

    model = guidelines.current_embedding_model()
    for row in db.fetchall("SELECT guideline_id FROM guidelines"):
        stats = db.fetchone(
            "SELECT COUNT(*) AS chunks, SUM(CASE WHEN embedding IS NULL THEN 0 ELSE 1 END) AS embedded FROM guideline_chunks WHERE guideline_id = ?",
            [row["guideline_id"]],
        ) or {}
        embedded = int(stats.get("embedded") or 0)
        db.exec_sql(
            "UPDATE guidelines SET chunk_count = ?, embedded_count = ?, embedding_model = ?, indexed_at = ? WHERE guideline_id = ?",
            [int(stats.get("chunks") or 0), embedded, model if embedded and target else "", datetime.now(timezone.utc), row["guideline_id"]],
        )
