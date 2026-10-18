"""Integration interfaces per channel, loaded from Excel or managed by hand, checked against the systems catalogue."""

import io
import uuid
from datetime import datetime, timezone

from app import db
from app.config import KB_EDITORS, kb_countries, kb_interface_channels
from app.errors import AppError
from app.services import gcs, systems

PROTOCOLS = ("API", "MQ", "Kafka", "gRPC", "FTP", "SMTP", "SMPP")
HEADERS = ("Country", "Interface name", "Description", "Protocol", "Source", "Destination")
MAX_ROWS = 5000
MAX_BYTES = 20 * 1024 * 1024
MAX_NAME = 200
MAX_DESCRIPTION = 2000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_editor(user: dict) -> None:
    if user["role_name"] not in KB_EDITORS:
        raise AppError(403, "Forbidden")


def _channel(value: str) -> str:
    channels = kb_interface_channels()
    channel = (value or "").strip().upper()
    if channel not in channels:
        raise AppError(404, "Unknown interface channel")
    return channel


def _canonical(value: str, allowed: tuple[str, ...]) -> str | None:
    lookup = {item.lower(): item for item in allowed}
    return lookup.get((value or "").strip().lower())


def _country(value: str) -> str:
    countries = kb_countries()
    canonical = _canonical(value, countries)
    if canonical is None:
        raise AppError(400, f"Country must be one of: {', '.join(countries)}.")
    return canonical


def _protocol(value: str) -> str:
    canonical = _canonical(value, PROTOCOLS)
    if canonical is None:
        raise AppError(400, f"Protocol must be one of: {', '.join(PROTOCOLS)}.")
    return canonical


def _system_code(value: str, label: str) -> str:
    code = (value or "").strip().upper()
    if not code:
        raise AppError(400, f"{label} is required.")
    if code not in systems.existing_codes():
        raise AppError(400, f"{label} '{value}' is not a known system code.")
    return code


def text_for(row: dict) -> str:
    """The interface as one readable sentence: what is embedded, searched and shown to the chat model."""
    description = f" {row['description']}" if row.get("description") else ""
    return (
        f"Interface {row['interface_name']} ({row['channel']} channel, country {row['country']}).{description} "
        f"Protocol {row['protocol']}. Source {row['source']} -> Destination {row['destination']}."
    )


def list_interfaces(channel: str) -> list[dict]:
    rows = db.fetchall(
        """
        SELECT interface_id, channel, country, interface_name, description, protocol, source, destination
        FROM interfaces WHERE channel = ? ORDER BY created_at, interface_name
        """,
        [_channel(channel)],
    )
    return rows


def get_interface(channel: str, interface_id: str) -> dict:
    row = db.fetchone(
        """
        SELECT interface_id, channel, country, interface_name, description, protocol, source, destination
        FROM interfaces WHERE channel = ? AND interface_id = ?
        """,
        [_channel(channel), interface_id],
    )
    if row is None:
        raise AppError(404, "Interface not found")
    return row


def create_interface(user: dict, channel: str, body: dict) -> dict:
    _require_editor(user)
    channel = _channel(channel)
    country = _country(str(body.get("country") or ""))
    name = (body.get("interface_name") or "").strip()
    if not name:
        raise AppError(400, "Interface name is required.")
    if len(name) > MAX_NAME:
        raise AppError(400, f"Interface name must be {MAX_NAME} characters or fewer.")
    description = (body.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION:
        raise AppError(400, f"Description must be {MAX_DESCRIPTION} characters or fewer.")
    protocol = _protocol(str(body.get("protocol") or ""))
    source = _system_code(str(body.get("source") or ""), "Source")
    destination = _system_code(str(body.get("destination") or ""), "Destination")
    interface_id = str(uuid.uuid4())
    db.exec_sql(
        """
        INSERT INTO interfaces (
            interface_id, channel, country, interface_name, description, protocol, source, destination, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [interface_id, channel, country, name, description, protocol, source, destination, _now()],
    )
    from app.services import reindex

    reindex.embed_missing_in_background()
    gcs.upload_db()
    return get_interface(channel, interface_id)


def update_interface(user: dict, channel: str, interface_id: str, body: dict) -> dict:
    _require_editor(user)
    current = get_interface(channel, interface_id)
    country = _country(str(body.get("country", current["country"]) or ""))
    name = (body.get("interface_name", current["interface_name"]) or "").strip()
    if not name:
        raise AppError(400, "Interface name is required.")
    if len(name) > MAX_NAME:
        raise AppError(400, f"Interface name must be {MAX_NAME} characters or fewer.")
    description = (body.get("description", current["description"]) or "").strip()
    if len(description) > MAX_DESCRIPTION:
        raise AppError(400, f"Description must be {MAX_DESCRIPTION} characters or fewer.")
    protocol = _protocol(str(body.get("protocol", current["protocol"]) or ""))
    source = _system_code(str(body.get("source", current["source"]) or ""), "Source")
    destination = _system_code(str(body.get("destination", current["destination"]) or ""), "Destination")
    db.exec_sql(
        """
        UPDATE interfaces
        SET country = ?, interface_name = ?, description = ?, protocol = ?, source = ?, destination = ?
        WHERE interface_id = ?
        """,
        [country, name, description, protocol, source, destination, interface_id],
    )
    from app.services import reindex

    reindex.embed_missing_in_background()
    gcs.upload_db()
    return get_interface(channel, interface_id)


def delete_interface(user: dict, channel: str, interface_id: str) -> None:
    _require_editor(user)
    get_interface(channel, interface_id)
    db.exec_sql("DELETE FROM interfaces WHERE interface_id = ?", [interface_id])
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
        sheet = workbook.worksheets[0]
        return [[_cell(value) for value in row] for row in sheet.iter_rows(values_only=True)]
    except Exception as exc:
        raise AppError(400, "Could not read the Excel file. Upload an .xlsx file.") from exc


def parse_and_validate(data: bytes) -> list[dict]:
    rows = _read_sheet(data)
    if not rows:
        raise AppError(400, "The Excel file is empty.")
    header = [value.strip().lower() for value in rows[0]]
    missing = [name for name in HEADERS if name.lower() not in header]
    if missing:
        raise AppError(400, f"Missing column(s): {', '.join(missing)}. Expected: {', '.join(HEADERS)}.")
    index = {name: header.index(name.lower()) for name in HEADERS}
    known = systems.existing_codes()
    countries = kb_countries()
    records: list[dict] = []
    errors: list[dict] = []

    def error(row_number: int, field: str, message: str) -> None:
        errors.append({"row": row_number, "field": field, "message": message})

    for offset, row in enumerate(rows[1:], start=2):
        values = {name: row[index[name]] if index[name] < len(row) else "" for name in HEADERS}
        if not any(values.values()):
            continue
        record = {"description": values["Description"]}
        country = _canonical(values["Country"], countries)
        if country is None:
            error(offset, "Country", f"'{values['Country']}' is not allowed. Use one of: {', '.join(countries)}.")
        record["country"] = country or ""
        if not values["Interface name"]:
            error(offset, "Interface name", "Interface name is required.")
        record["interface_name"] = values["Interface name"]
        protocol = _canonical(values["Protocol"], PROTOCOLS)
        if protocol is None:
            error(offset, "Protocol", f"'{values['Protocol']}' is not allowed. Use one of: {', '.join(PROTOCOLS)}.")
        record["protocol"] = protocol or ""
        for field, key in (("Source", "source"), ("Destination", "destination")):
            code = values[field].upper()
            if not code or code not in known:
                error(offset, field, f"'{values[field]}' is not a known system code.")
            record[key] = code
        records.append(record)
    if len(records) > MAX_ROWS:
        raise AppError(400, f"At most {MAX_ROWS} rows can be uploaded at once.")
    if errors:
        raise AppError(400, f"{len(errors)} problem(s) found. Nothing was imported.", errors)
    if not records:
        raise AppError(400, "The Excel file has no data rows.")
    return records


def replace_from_excel(user: dict, channel: str, filename: str, data: bytes) -> list[dict]:
    _require_editor(user)
    channel = _channel(channel)
    if not (filename or "").lower().endswith(".xlsx"):
        raise AppError(400, "Upload an Excel file (.xlsx).")
    if len(data) > MAX_BYTES:
        raise AppError(400, "The file is larger than 20 MB.")
    records = parse_and_validate(data)
    now = _now()
    db.exec_sql("DELETE FROM interfaces WHERE channel = ?", [channel])
    for record in records:
        db.exec_sql(
            """
            INSERT INTO interfaces (
                interface_id, channel, country, interface_name, description, protocol, source, destination, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                str(uuid.uuid4()),
                channel,
                record["country"],
                record["interface_name"],
                record["description"],
                record["protocol"],
                record["source"],
                record["destination"],
                now,
            ],
        )
    from app.services import reindex

    reindex.embed_missing_in_background()
    gcs.upload_db()
    return list_interfaces(channel)
