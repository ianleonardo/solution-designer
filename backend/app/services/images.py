"""Image uploads for image blocks. Files live under DATA_DIR/uploads/images/<project_id>/."""

import base64
import re
import shutil
import uuid
from pathlib import Path

from app import db
from app.config import data_dir
from app.errors import AppError
from app.permissions import require
from app.services import gcs

MAX_BYTES = 5 * 1024 * 1024
URL_PATTERN = re.compile(r"^/api/projects/([0-9a-fA-F-]{8,64})/images/([A-Za-z0-9._-]{1,200})$")
NAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
MEDIA_TYPES = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}


def _kind(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _folder(project_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-fA-F-]{8,64}", project_id):
        raise AppError(404, "Image not found")
    return data_dir() / "uploads" / "images" / project_id


def save_image(user: dict, project_id: str, data: bytes) -> dict:
    require(user, "projects", "write")
    if db.fetchone("SELECT project_id FROM projects WHERE project_id = ?", [project_id]) is None:
        raise AppError(404, "Project not found")
    if not data:
        raise AppError(400, "The image is empty")
    if len(data) > MAX_BYTES:
        raise AppError(400, "Images must be 5 MB or smaller")
    kind = _kind(data)
    if kind is None:
        raise AppError(400, "Only PNG, JPEG, GIF and WEBP images are supported")
    folder = _folder(project_id)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{kind}"
    path = folder / name
    path.write_bytes(data)
    gcs.persist_file(path, f"uploads/images/{project_id}/{name}")
    gcs.upload_db()
    return {"url": f"/api/projects/{project_id}/images/{name}", "file_name": name}


def read_image(project_id: str, name: str) -> tuple[bytes, str]:
    if not NAME_PATTERN.fullmatch(name):
        raise AppError(404, "Image not found")
    path = _folder(project_id) / name
    if not path.is_file():
        raise AppError(404, "Image not found")
    data = path.read_bytes()
    kind = _kind(data)
    if kind is None:
        raise AppError(404, "Image not found")
    return data, MEDIA_TYPES[kind]


def data_uri(url: str) -> str | None:
    """Inline an uploaded image for exports. Returns None if the file is missing."""
    match = URL_PATTERN.fullmatch(url or "")
    if not match:
        return None
    try:
        data, media_type = read_image(match.group(1), match.group(2))
    except AppError:
        return None
    return f"data:{media_type};base64,{base64.b64encode(data).decode()}"


def remove_project_images(project_id: str) -> None:
    shutil.rmtree(_folder(project_id), ignore_errors=True)
