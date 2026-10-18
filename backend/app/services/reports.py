"""Structured knowledge-base reports organized by country and system."""

import io
import uuid
from datetime import datetime, timezone

from app import db
from app.config import KB_EDITORS, kb_countries
from app.errors import AppError
from app.services import gcs, llm, systems

HEADERS = ("REPORT_NAME", "REPORT_DESCRIPTION", "REPORT_LAYOUT")
MAX_ROWS = 5000
MAX_BYTES = 20 * 1024 * 1024
MAX_NAME = 200
MAX_DESCRIPTION = 4000
MAX_LAYOUT = 50000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_editor(user: dict) -> None:
    if user["role_name"] not in KB_EDITORS:
        raise AppError(403, "Forbidden")


def _canonical(value: str, allowed: tuple[str, ...]) -> str | None:
    lookup = {item.lower(): item for item in allowed}
    return lookup.get((value or "").strip().lower())


def _country(value: str) -> str:
    countries = kb_countries()
    canonical = _canonical(value, countries)
    if canonical is None:
        raise AppError(400, f"Country must be one of: {', '.join(countries)}.")
    return canonical


def _system_code(value: str, *, allow: str | None = None) -> str:
    code = (value or "").strip().upper()
    if not code:
        raise AppError(400, "System is required.")
    if code not in systems.existing_codes():
        raise AppError(400, f"System '{value}' is not a known system code.")
    allowed = (allow or "").strip().upper()
    if code != allowed and code not in systems.codes_with_report():
        raise AppError(400, f"System '{code}' is not marked as having reports. Enable Has report on the Systems page.")
    return code


FREQUENCIES = ("Daily", "Weekly", "Monthly", "Other")
MAX_FREQUENCY_OTHER = 100


def _frequency(body: dict, current: dict | None = None) -> tuple[str, str]:
    if "frequency" in body:
        raw = body.get("frequency")
    elif current is not None:
        raw = current.get("frequency") or ""
    else:
        raw = ""
    parts = [str(item).strip() for item in raw] if isinstance(raw, list) else [item.strip() for item in str(raw or "").split(",")]
    selected: list[str] = []
    for item in parts:
        if not item:
            continue
        canonical = next((name for name in FREQUENCIES if name.lower() == item.lower()), None)
        if canonical is None:
            raise AppError(400, "Frequency must be Daily, Weekly, Monthly, or Other.")
        if canonical not in selected:
            selected.append(canonical)
    if "frequency_other" in body:
        other = str(body.get("frequency_other") or "").strip()
    elif current is not None:
        other = str(current.get("frequency_other") or "").strip()
    else:
        other = ""
    if "Other" in selected:
        if not other:
            raise AppError(400, "Enter a frequency for Other.")
        if len(other) > MAX_FREQUENCY_OTHER:
            raise AppError(400, f"Other frequency must be {MAX_FREQUENCY_OTHER} characters or fewer.")
    else:
        other = ""
    ordered = [name for name in FREQUENCIES if name in selected]
    return ", ".join(ordered), other


def text_for(row: dict) -> str:
    layout = (row.get("layout") or "")[:1500]
    desc = f" {row['description']}" if row.get("description") else ""
    return (
        f"Report {row['report_name']} (country {row['country']}, system {row['system_code']}).{desc} "
        f"Frequency: {row.get('frequency') or 'unspecified'}"
        f"{' (' + row['frequency_other'] + ')' if row.get('frequency_other') else ''}. Layout: {layout}"
    )


def _embed(report_id: str) -> None:
    row = db.fetchone("SELECT * FROM kb_reports WHERE report_id = ?", [report_id])
    if row is None:
        return
    vector = llm.embed(text_for(row)[:2000]) if llm.embedding_configured() else None
    db.exec_sql("UPDATE kb_reports SET embedding = ? WHERE report_id = ?", [vector, report_id])


def _payload(row: dict) -> dict:
    return {
        "report_id": row["report_id"],
        "country": row["country"],
        "system_code": row["system_code"],
        "report_name": row["report_name"],
        "frequency": row.get("frequency") or "",
        "frequency_other": row.get("frequency_other") or "",
        "description": row["description"],
        "layout": row["layout"],
        "created_at": row["created_at"],
        "last_modified": row["last_modified"],
    }


def list_reports() -> list[dict]:
    rows = db.fetchall(
        """
        SELECT * FROM kb_reports
        ORDER BY country, system_code, report_name
        """
    )
    return [_payload(row) for row in rows]


def get_report(report_id: str) -> dict:
    row = db.fetchone("SELECT * FROM kb_reports WHERE report_id = ?", [report_id])
    if row is None:
        raise AppError(404, "Report not found")
    return _payload(row)


def create_report(user: dict, body: dict) -> dict:
    _require_editor(user)
    country = _country(str(body.get("country") or ""))
    system_code = _system_code(str(body.get("system_code") or body.get("system") or ""))
    name = (body.get("report_name") or "").strip()
    if not name:
        raise AppError(400, "Report name is required.")
    if len(name) > MAX_NAME:
        raise AppError(400, f"Report name must be {MAX_NAME} characters or fewer.")
    description = (body.get("description") or "").strip()
    layout = (body.get("layout") or "").strip()
    if len(description) > MAX_DESCRIPTION:
        raise AppError(400, f"Description must be {MAX_DESCRIPTION} characters or fewer.")
    if len(layout) > MAX_LAYOUT:
        raise AppError(400, f"Layout must be {MAX_LAYOUT} characters or fewer.")
    frequency, frequency_other = _frequency(body)
    existing = db.fetchone(
        """
        SELECT report_id FROM kb_reports
        WHERE country = ? AND system_code = ? AND lower(report_name) = lower(?)
        """,
        [country, system_code, name],
    )
    if existing is not None:
        raise AppError(400, f"Report {name} already exists for {country} / {system_code}.")
    report_id = str(uuid.uuid4())
    now = _now()
    db.exec_sql(
        """
        INSERT INTO kb_reports (
            report_id, country, system_code, report_name, frequency, frequency_other, description, layout, created_at, last_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [report_id, country, system_code, name, frequency, frequency_other, description, layout, now, now],
    )
    _embed(report_id)
    gcs.upload_db()
    return get_report(report_id)


def update_report(user: dict, report_id: str, body: dict) -> dict:
    _require_editor(user)
    current = db.fetchone("SELECT * FROM kb_reports WHERE report_id = ?", [report_id])
    if current is None:
        raise AppError(404, "Report not found")
    country = _country(str(body.get("country", current["country"]) or ""))
    system_code = _system_code(
        str(body.get("system_code", body.get("system", current["system_code"])) or ""),
        allow=current["system_code"],
    )
    name = (body.get("report_name", current["report_name"]) or "").strip()
    if not name:
        raise AppError(400, "Report name is required.")
    if len(name) > MAX_NAME:
        raise AppError(400, f"Report name must be {MAX_NAME} characters or fewer.")
    description = (body.get("description", current["description"]) or "").strip()
    layout = (body.get("layout", current["layout"]) or "").strip()
    if len(description) > MAX_DESCRIPTION:
        raise AppError(400, f"Description must be {MAX_DESCRIPTION} characters or fewer.")
    if len(layout) > MAX_LAYOUT:
        raise AppError(400, f"Layout must be {MAX_LAYOUT} characters or fewer.")
    frequency, frequency_other = _frequency(body, current)
    conflict = db.fetchone(
        """
        SELECT report_id FROM kb_reports
        WHERE country = ? AND system_code = ? AND lower(report_name) = lower(?) AND report_id <> ?
        """,
        [country, system_code, name, report_id],
    )
    if conflict is not None:
        raise AppError(400, f"Report {name} already exists for {country} / {system_code}.")
    db.exec_sql(
        """
        UPDATE kb_reports
        SET country = ?, system_code = ?, report_name = ?, frequency = ?, frequency_other = ?, description = ?, layout = ?, last_modified = ?
        WHERE report_id = ?
        """,
        [country, system_code, name, frequency, frequency_other, description, layout, _now(), report_id],
    )
    _embed(report_id)
    gcs.upload_db()
    return get_report(report_id)


def delete_report(user: dict, report_id: str) -> None:
    _require_editor(user)
    get_report(report_id)
    db.exec_sql("DELETE FROM kb_reports WHERE report_id = ?", [report_id])
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
            if rows and any(h.strip().upper() == "REPORT_NAME" for h in rows[0]):
                return rows
        sheet = workbook.worksheets[0]
        return [[_cell(value) for value in row] for row in sheet.iter_rows(values_only=True)]
    except Exception as exc:
        raise AppError(400, "Could not read the Excel file. Upload an .xlsx file.") from exc


def parse_and_validate(data: bytes) -> list[dict]:
    rows = _read_sheet(data)
    if not rows:
        raise AppError(400, "The Excel file is empty.")
    header = [value.strip().upper() for value in rows[0]]
    missing = [name for name in HEADERS if name not in header]
    if missing:
        raise AppError(400, f"Missing column(s): {', '.join(missing)}. Expected: {', '.join(HEADERS)}.")
    index = {name: header.index(name) for name in HEADERS}
    records: list[dict] = []
    errors: list[dict] = []
    seen: dict[str, int] = {}

    def error(row_number: int, field: str, message: str) -> None:
        errors.append({"row": row_number, "field": field, "message": message})

    for offset, row in enumerate(rows[1:], start=2):
        values = {name: row[index[name]] if index[name] < len(row) else "" for name in HEADERS}
        if not any(values.values()):
            continue
        name = values["REPORT_NAME"].strip()
        description = values["REPORT_DESCRIPTION"].strip()
        layout = values["REPORT_LAYOUT"].strip()
        if not name:
            error(offset, "REPORT_NAME", "REPORT_NAME is required.")
        key = name.upper()
        if name and key in seen:
            error(offset, "REPORT_NAME", f"Duplicate report name '{name}' (first seen on row {seen[key]}).")
        elif name:
            seen[key] = offset
        records.append({"report_name": name, "description": description, "layout": layout})

    if len(records) > MAX_ROWS:
        raise AppError(400, f"At most {MAX_ROWS} rows can be uploaded at once.")
    if errors:
        raise AppError(400, f"{len(errors)} problem(s) found. Nothing was imported.", errors)
    if not records:
        raise AppError(400, "The Excel file has no data rows.")
    return records


def upload_from_excel(user: dict, country_raw: str, system_raw: str, filename: str, data: bytes) -> dict:
    _require_editor(user)
    country = _country(country_raw)
    system_code = _system_code(system_raw)
    if not (filename or "").lower().endswith(".xlsx"):
        raise AppError(400, "Upload an Excel file (.xlsx).")
    if len(data) > MAX_BYTES:
        raise AppError(400, "The file is larger than 20 MB.")
    records = parse_and_validate(data)
    now = _now()
    for rec in records:
        existing = db.fetchone(
            """
            SELECT report_id, description, layout FROM kb_reports
            WHERE country = ? AND system_code = ? AND lower(report_name) = lower(?)
            """,
            [country, system_code, rec["report_name"]],
        )
        if existing is None:
            report_id = str(uuid.uuid4())
            db.exec_sql(
                """
                INSERT INTO kb_reports (
                    report_id, country, system_code, report_name, description, layout, created_at, last_modified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    report_id,
                    country,
                    system_code,
                    rec["report_name"],
                    rec["description"],
                    rec["layout"],
                    now,
                    now,
                ],
            )
            _embed(report_id)
        else:
            description = rec["description"] or existing["description"]
            layout = rec["layout"] or existing["layout"]
            db.exec_sql(
                """
                UPDATE kb_reports
                SET report_name = ?, description = ?, layout = ?, last_modified = ?
                WHERE report_id = ?
                """,
                [rec["report_name"], description, layout, now, existing["report_id"]],
            )
            _embed(existing["report_id"])

    from app.services import reindex

    reindex.embed_missing_in_background()
    gcs.upload_db()
    return {"reports": list_reports(), "uploaded": len(records)}
