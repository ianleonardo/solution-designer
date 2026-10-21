"""Structured knowledge-base Bitbucket repositories, one row per system, project and repository."""

import io
import json
import uuid
from datetime import datetime, timezone

from app import db
from app.config import kb_bitbucket_projects
from app.errors import AppError
from app.permissions import require
from app.services import gcs, llm

HEADERS = ("BITBUCKET_PROJECT", "BITBUCKET_REPO_NAME", "DESCRIPTION", "MAIN_COMPONENTS")
REQUIRED = ("BITBUCKET_REPO_NAME",)
MAX_ROWS = 5000
MAX_BYTES = 20 * 1024 * 1024
MAX_NAME = 200
MAX_DESCRIPTION = 4000
MAX_COMPONENTS = 100000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_editor(user: dict) -> None:
    require(user, "knowledge", "write")


def _project(value: str) -> str:
    code = (value or "").strip().upper()
    allowed = kb_bitbucket_projects()
    if code not in allowed:
        raise AppError(404, "Unknown Bitbucket project")
    return code


def _repo_name(value: str) -> str:
    name = (value or "").strip().lower()
    if not name:
        raise AppError(400, "Repository name is required.")
    if len(name) > MAX_NAME:
        raise AppError(400, f"Repository name must be {MAX_NAME} characters or fewer.")
    return name


def _components(value: str) -> str:
    text = (value or "").strip()
    if len(text) > MAX_COMPONENTS:
        raise AppError(400, f"Main components must be {MAX_COMPONENTS} characters or fewer.")
    return text


def heuristic_description(project: str, repo: str, components: str = "") -> str:
    sentence = f"{repo} is a Bitbucket repository in {project}."
    extra = (components or "").strip()
    if extra:
        sentence = f"{sentence} Main components: {extra}."
    return sentence[:MAX_DESCRIPTION]


def infer_descriptions(rows: list[tuple[str, str, str]]) -> list[str]:
    """One short sentence per repository. Uses the model when it is configured."""
    results = [heuristic_description(project, repo, components) for project, repo, components in rows]
    if not rows or not llm.configured():
        return results
    size = 40
    for start in range(0, len(rows), size):
        batch = rows[start : start + size]
        try:
            raw = llm.complete(
                "You write short catalogue descriptions for source-code repositories. "
                "Each item has a Bitbucket project, a repository name, and optional main components. "
                "Write one plain sentence that says what the repository is for. "
                'Return JSON only: {"descriptions":["..."]} with one string per item, in the same order.',
                json.dumps(
                    [
                        {"project": project, "repo": repo, "components": components}
                        for project, repo, components in batch
                    ]
                ),
                0.2,
            )
            start_brace, end_brace = raw.find("{"), raw.rfind("}")
            if start_brace == -1 or end_brace == -1:
                continue
            sentences = json.loads(raw[start_brace : end_brace + 1]).get("descriptions") or []
            for index, sentence in enumerate(sentences):
                text = " ".join(str(sentence).split()).strip().strip('"')
                if text and index < len(batch):
                    results[start + index] = text[:MAX_DESCRIPTION]
        except Exception:
            continue
    return results


def inferred_description(project: str, repo: str, components: str = "") -> str:
    return infer_descriptions([(project, repo, components)])[0]


def text_for(row: dict) -> str:
    components = (row.get("main_components") or "").strip()
    components_bit = f" Main components: {components[:800]}." if components else ""
    desc = f" {row['description']}" if row.get("description") else ""
    return (
        f"Bitbucket repository {row['repo_name']} in project {row['bitbucket_project']}.{desc}{components_bit}"
    )


def _embed(repo_id: str) -> None:
    row = db.fetchone("SELECT * FROM kb_bitbucket_repos WHERE repo_id = ?", [repo_id])
    if row is None:
        return
    vector = llm.embed(text_for(row)[:2000]) if llm.embedding_configured() else None
    db.exec_sql("UPDATE kb_bitbucket_repos SET embedding = ? WHERE repo_id = ?", [vector, repo_id])


def _payload(row: dict) -> dict:
    return {
        "repo_id": row["repo_id"],
        "bitbucket_project": row["bitbucket_project"],
        "repo_name": row["repo_name"],
        "description": row["description"],
        "main_components": row["main_components"],
        "created_at": row["created_at"],
        "last_modified": row["last_modified"],
    }


def list_repos(project: str) -> list[dict]:
    rows = db.fetchall(
        """
        SELECT * FROM kb_bitbucket_repos
        WHERE bitbucket_project = ?
        ORDER BY repo_name
        """,
        [_project(project)],
    )
    return [_payload(row) for row in rows]


def get_repo(project: str, repo_id: str) -> dict:
    row = db.fetchone(
        "SELECT * FROM kb_bitbucket_repos WHERE bitbucket_project = ? AND repo_id = ?",
        [_project(project), repo_id],
    )
    if row is None:
        raise AppError(404, "Repository not found")
    return _payload(row)


def _find(project: str, repo_name: str, exclude: str | None = None) -> dict | None:
    sql = """
        SELECT * FROM kb_bitbucket_repos
        WHERE bitbucket_project = ? AND repo_name = ?
    """
    params: list = [project, repo_name]
    if exclude:
        sql += " AND repo_id <> ?"
        params.append(exclude)
    return db.fetchone(sql, params)


def create_repo(user: dict, project_raw: str, body: dict) -> dict:
    _require_editor(user)
    project = _project(project_raw)
    repo_name = _repo_name(str(body.get("repo_name") or ""))
    components = _components(str(body.get("main_components") or ""))
    description = (body.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION:
        raise AppError(400, f"Description must be {MAX_DESCRIPTION} characters or fewer.")
    if not description:
        description = inferred_description(project, repo_name, components)
    if _find(project, repo_name) is not None:
        raise AppError(400, f"Repository {repo_name} already exists in {project}.")
    repo_id = str(uuid.uuid4())
    now = _now()
    db.exec_sql(
        """
        INSERT INTO kb_bitbucket_repos (
            repo_id, bitbucket_project, repo_name, description, main_components, created_at, last_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [repo_id, project, repo_name, description, components, now, now],
    )
    _embed(repo_id)
    gcs.upload_db()
    return get_repo(project, repo_id)


def update_repo(user: dict, project_raw: str, repo_id: str, body: dict) -> dict:
    _require_editor(user)
    project = _project(project_raw)
    current = db.fetchone(
        "SELECT * FROM kb_bitbucket_repos WHERE bitbucket_project = ? AND repo_id = ?",
        [project, repo_id],
    )
    if current is None:
        raise AppError(404, "Repository not found")
    repo_name = _repo_name(str(body.get("repo_name", current["repo_name"]) or ""))
    components = _components(str(body.get("main_components", current["main_components"]) or ""))
    description = (body.get("description", current["description"]) or "").strip()
    if len(description) > MAX_DESCRIPTION:
        raise AppError(400, f"Description must be {MAX_DESCRIPTION} characters or fewer.")
    if not description:
        description = inferred_description(project, repo_name, components)
    if _find(project, repo_name, exclude=repo_id) is not None:
        raise AppError(400, f"Repository {repo_name} already exists in {project}.")
    db.exec_sql(
        """
        UPDATE kb_bitbucket_repos
        SET repo_name = ?, description = ?, main_components = ?, last_modified = ?
        WHERE repo_id = ?
        """,
        [repo_name, description, components, _now(), repo_id],
    )
    _embed(repo_id)
    gcs.upload_db()
    return get_repo(project, repo_id)


def delete_repo(user: dict, project_raw: str, repo_id: str) -> None:
    _require_editor(user)
    get_repo(project_raw, repo_id)
    db.exec_sql("DELETE FROM kb_bitbucket_repos WHERE repo_id = ?", [repo_id])
    gcs.upload_db()


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _read_sheet(data: bytes) -> list[list[str]]:
    from openpyxl import load_workbook

    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        for sheet in workbook.worksheets:
            rows = [[_cell(value) for value in row] for row in sheet.iter_rows(values_only=True)]
            if rows and any(cell.strip().upper() == "BITBUCKET_REPO_NAME" for cell in rows[0]):
                return rows
        sheet = workbook.worksheets[0]
        return [[_cell(value) for value in row] for row in sheet.iter_rows(values_only=True)]
    except Exception as exc:
        raise AppError(400, "Could not read the Excel file. Upload an .xlsx file.") from exc


def parse_and_validate(data: bytes, project: str) -> list[dict]:
    rows = _read_sheet(data)
    if not rows:
        raise AppError(400, "The Excel file is empty.")
    header = [value.strip().upper() for value in rows[0]]
    missing = [name for name in REQUIRED if name not in header]
    if missing:
        raise AppError(400, f"Missing column(s): {', '.join(missing)}. Expected: {', '.join(HEADERS)}.")
    index = {name: header.index(name) if name in header else None for name in HEADERS}
    records: list[dict] = []
    errors: list[dict] = []
    seen: dict[str, int] = {}

    def error(row_number: int, field: str, message: str) -> None:
        errors.append({"row": row_number, "field": field, "message": message})

    for offset, row in enumerate(rows[1:], start=2):
        values = {name: row[index[name]] if index[name] is not None and index[name] < len(row) else "" for name in HEADERS}
        if not any(values.values()):
            continue
        stated = values["BITBUCKET_PROJECT"].strip().upper()
        repo_name = values["BITBUCKET_REPO_NAME"].strip().lower()
        description = values["DESCRIPTION"].strip()
        components = values["MAIN_COMPONENTS"].strip()
        if stated and stated != project:
            error(offset, "BITBUCKET_PROJECT", f"BITBUCKET_PROJECT must be {project} for this tab.")
        if not repo_name:
            error(offset, "BITBUCKET_REPO_NAME", "BITBUCKET_REPO_NAME is required.")
        elif len(repo_name) > MAX_NAME:
            error(offset, "BITBUCKET_REPO_NAME", f"BITBUCKET_REPO_NAME must be {MAX_NAME} characters or fewer.")
        if len(description) > MAX_DESCRIPTION:
            error(offset, "DESCRIPTION", f"DESCRIPTION must be {MAX_DESCRIPTION} characters or fewer.")
        if len(components) > MAX_COMPONENTS:
            error(offset, "MAIN_COMPONENTS", f"MAIN_COMPONENTS must be {MAX_COMPONENTS} characters or fewer.")
        if repo_name and repo_name in seen:
            error(offset, "BITBUCKET_REPO_NAME", f"Duplicate repository (first seen on row {seen[repo_name]}).")
        elif repo_name:
            seen[repo_name] = offset
        records.append(
            {
                "repo_name": repo_name,
                "description": description,
                "main_components": components,
            }
        )

    if len(records) > MAX_ROWS:
        raise AppError(400, f"At most {MAX_ROWS} rows can be uploaded at once.")
    if errors:
        raise AppError(400, f"{len(errors)} problem(s) found. Nothing was imported.", errors)
    if not records:
        raise AppError(400, "The Excel file has no data rows.")
    return records


def upload_from_excel(user: dict, project_raw: str, filename: str, data: bytes) -> list[dict]:
    _require_editor(user)
    project = _project(project_raw)
    if not (filename or "").lower().endswith(".xlsx"):
        raise AppError(400, "Upload an Excel file (.xlsx).")
    if len(data) > MAX_BYTES:
        raise AppError(400, "The file is larger than 20 MB.")
    records = parse_and_validate(data, project)
    pending: list[tuple[dict, dict | None]] = []
    needs: list[tuple[str, str, str]] = []
    for rec in records:
        existing = _find(project, rec["repo_name"])
        pending.append((rec, existing))
        if rec["description"]:
            continue
        if existing and (existing.get("description") or "").strip():
            continue
        needs.append((project, rec["repo_name"], rec["main_components"]))
    inferred = infer_descriptions(needs)
    inferred_at = 0
    now = _now()
    for rec, existing in pending:
        if rec["description"]:
            description = rec["description"]
        elif existing and (existing.get("description") or "").strip():
            description = existing["description"]
        else:
            description = inferred[inferred_at]
            inferred_at += 1
        if existing is None:
            repo_id = str(uuid.uuid4())
            db.exec_sql(
                """
                INSERT INTO kb_bitbucket_repos (
                    repo_id, bitbucket_project, repo_name, description, main_components, created_at, last_modified
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [repo_id, project, rec["repo_name"], description, rec["main_components"], now, now],
            )
            _embed(repo_id)
        else:
            db.exec_sql(
                """
                UPDATE kb_bitbucket_repos
                SET description = ?, main_components = ?, last_modified = ?
                WHERE repo_id = ?
                """,
                [description, rec["main_components"], now, existing["repo_id"]],
            )
            _embed(existing["repo_id"])

    from app.services import reindex

    reindex.embed_missing_in_background()
    gcs.upload_db()
    return list_repos(project)
