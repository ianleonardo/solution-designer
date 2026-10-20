import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def _client():
    from google.cloud import storage

    return storage.Client()


def enabled() -> bool:
    return bool(os.environ.get("GCS_BUCKET"))


def local_db() -> Path:
    from app.config import db_path

    return db_path()


def download_db_if_needed() -> None:
    if not enabled() or local_db().exists():
        return
    try:
        blob = _client().bucket(os.environ["GCS_BUCKET"]).blob(
            os.environ.get("GCS_DB_PATH", "duckdb/solutioncrafter.duckdb")
        )
        if blob.exists():
            local_db().parent.mkdir(parents=True, exist_ok=True)
            blob.download_to_filename(str(local_db()))
    except Exception:
        logger.exception("Could not download DuckDB from GCS")


def upload_db() -> None:
    if not enabled() or not local_db().exists():
        return
    try:
        blob = _client().bucket(os.environ["GCS_BUCKET"]).blob(
            os.environ.get("GCS_DB_PATH", "duckdb/solutioncrafter.duckdb")
        )
        blob.upload_from_filename(str(local_db()))
    except Exception:
        logger.exception("Could not upload DuckDB to GCS")


def fetch_file(path: Path, object_name: str) -> bool:
    """Download an object to `path` when the local copy is gone (for example after a Cloud Run restart)."""
    if not enabled():
        return False
    try:
        blob = _client().bucket(os.environ["GCS_BUCKET"]).blob(object_name)
        if not blob.exists():
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(str(path))
        return True
    except Exception:
        logger.exception("Could not download %s from GCS", object_name)
        return False


def delete_file(object_name: str) -> None:
    if not enabled():
        return
    try:
        blob = _client().bucket(os.environ["GCS_BUCKET"]).blob(object_name)
        if blob.exists():
            blob.delete()
    except Exception:
        logger.exception("Could not delete %s from GCS", object_name)


def persist_file(path: Path, object_name: str) -> None:
    if not enabled() or not path.exists():
        return
    try:
        blob = _client().bucket(os.environ["GCS_BUCKET"]).blob(object_name)
        blob.upload_from_filename(str(path))
    except Exception:
        logger.exception("Could not upload %s to GCS", object_name)
