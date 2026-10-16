import io

from openpyxl import Workbook
from tests.conftest import auth, login

HEADER = ["TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "IS_NULL", "PRIMARY_KEY", "FOREIGN_KEY"]


def _excel(rows, header=HEADER) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _upload(client, token, country="Singapore", database="PIB", schema="", rows=None, name="tables.xlsx"):
    data = _excel(rows or [])
    files = {"file": (name, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    form = {"country": country, "database": database, "schema": schema}
    return client.post("/api/tables/upload", data=form, files=files, headers=auth(token))


def test_upload_defaults_schema_to_database_defaults_is_null_and_infers_descriptions(client):
    analyst = login(client, "Analyst")
    res = _upload(
        client,
        analyst,
        country="Singapore",
        database="PIB",
        schema="",
        rows=[
            ["CUSTOMER_ACCOUNT", "ACCOUNT_ID", "VARCHAR(36)", "", "Y", ""],
            ["CUSTOMER_ACCOUNT", "CUSTOMER_ID", "VARCHAR(36)", "Y", "", "CUSTOMER.ID"],
        ],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["uploaded_tables"] == 1
    assert body["uploaded_columns"] == 2
    assert body["missing_columns"] == []
    assert len(body["tables"]) == 1

    table = body["tables"][0]
    assert table["country"] == "Singapore"
    assert table["database_name"] == "PIB"
    assert table["schema_name"] == "PIB"
    assert table["table_name"] == "CUSTOMER_ACCOUNT"
    assert table["description"]
    assert table["column_count"] == 2

    detail = client.get(f"/api/tables/{table['table_id']}", headers=auth(analyst)).json()
    cols = {col["column_name"]: col for col in detail["columns"]}
    assert cols["ACCOUNT_ID"]["is_null"] == "N"
    assert cols["ACCOUNT_ID"]["primary_key"] == "Y"
    assert cols["ACCOUNT_ID"]["description"]
    assert cols["CUSTOMER_ID"]["is_null"] == "Y"
    assert cols["CUSTOMER_ID"]["foreign_key"] == "CUSTOMER.ID"


def test_upload_upserts_existing_columns_and_detects_missing_db_columns(client):
    admin = login(client, "Admin")
    first = _upload(
        client,
        admin,
        country="Malaysia",
        database="MBK",
        schema="CORE",
        rows=[
            ["TXN_LOG", "TXN_ID", "VARCHAR(20)", "N", "Y", ""],
            ["TXN_LOG", "AMOUNT", "NUMBER(12,2)", "N", "", ""],
            ["TXN_LOG", "LEGACY_CODE", "VARCHAR(10)", "Y", "", ""],
        ],
    )
    assert first.status_code == 200, first.text
    table_id = first.json()["tables"][0]["table_id"]

    # Re-upload without LEGACY_CODE and with updated AMOUNT data_type
    second = _upload(
        client,
        admin,
        country="Malaysia",
        database="MBK",
        schema="CORE",
        rows=[
            ["TXN_LOG", "TXN_ID", "VARCHAR(20)", "N", "Y", ""],
            ["TXN_LOG", "AMOUNT", "NUMBER(18,4)", "Y", "", ""],
        ],
    )
    assert second.status_code == 200, second.text
    missing = second.json()["missing_columns"]
    assert len(missing) == 1
    assert missing[0]["table_name"] == "TXN_LOG"
    assert missing[0]["column_name"] == "LEGACY_CODE"

    detail = client.get(f"/api/tables/{table_id}", headers=auth(admin)).json()
    cols = {col["column_name"]: col for col in detail["columns"]}
    assert cols["AMOUNT"]["data_type"] == "NUMBER(18,4)"
    assert cols["AMOUNT"]["is_null"] == "Y"
    assert "LEGACY_CODE" in cols  # Kept until user chooses to delete

    # User chooses to delete the missing column
    del_res = client.post(
        "/api/tables/columns/delete-batch",
        json={"column_ids": [missing[0]["column_id"]]},
        headers=auth(admin),
    )
    assert del_res.status_code == 200
    assert del_res.json()["deleted"] == 1

    after = client.get(f"/api/tables/{table_id}", headers=auth(admin)).json()
    assert {col["column_name"] for col in after["columns"]} == {"TXN_ID", "AMOUNT"}


def test_upload_rejects_duplicate_table_column_and_missing_required_fields(client):
    admin = login(client, "Admin")
    dup = _upload(
        client,
        admin,
        rows=[
            ["USERS", "USER_ID", "VARCHAR(36)", "N", "Y", ""],
            ["users", "user_id", "NUMBER", "N", "Y", ""],
        ],
    )
    assert dup.status_code == 400
    assert any("Duplicate column" in err["message"] for err in dup.json()["errors"])

    missing_req = _upload(
        client,
        admin,
        rows=[
            ["", "USER_ID", "VARCHAR(36)", "", "", ""],
            ["USERS", "", "VARCHAR(36)", "", "", ""],
            ["USERS", "STATUS", "", "", "", ""],
        ],
    )
    assert missing_req.status_code == 400
    fields = {(err["row"], err["field"]) for err in missing_req.json()["errors"]}
    assert fields == {(2, "TABLE_NAME"), (3, "COLUMN_NAME"), (4, "DATA_TYPE")}


def test_manual_crud_and_role_permissions_for_tables_and_columns(client):
    analyst = login(client, "Analyst")
    viewer = login(client, "Viewer")

    # Viewer cannot create
    assert (
        client.post(
            "/api/tables",
            json={"country": "Thailand", "database_name": "SMS", "table_name": "OTP_LOG"},
            headers=auth(viewer),
        ).status_code
        == 403
    )

    # Analyst creates table (schema defaults to SMS)
    created = client.post(
        "/api/tables",
        json={"country": "Thailand", "database_name": "SMS", "table_name": "OTP_LOG", "description": "OTP audit"},
        headers=auth(analyst),
    )
    assert created.status_code == 200, created.text
    table = created.json()
    table_id = table["table_id"]
    assert table["schema_name"] == "SMS"

    # Duplicate table in same country/db/schema rejected
    assert (
        client.post(
            "/api/tables",
            json={"country": "Thailand", "database_name": "SMS", "table_name": "otp_log"},
            headers=auth(analyst),
        ).status_code
        == 400
    )

    # Add column manually
    col_res = client.post(
        f"/api/tables/{table_id}/columns",
        json={"column_name": "OTP_ID", "data_type": "VARCHAR(32)", "is_null": "", "primary_key": "Y"},
        headers=auth(analyst),
    )
    assert col_res.status_code == 200, col_res.text
    col = col_res.json()
    assert col["is_null"] == "N"
    assert col["description"]

    # Duplicate column rejected
    assert (
        client.post(
            f"/api/tables/{table_id}/columns",
            json={"column_name": "otp_id", "data_type": "NUMBER"},
            headers=auth(analyst),
        ).status_code
        == 400
    )

    # Viewer can list and get table details, but cannot edit or delete
    assert client.get("/api/tables", headers=auth(viewer)).status_code == 200
    assert client.get(f"/api/tables/{table_id}", headers=auth(viewer)).status_code == 200
    assert client.patch(f"/api/tables/{table_id}", json={"description": "x"}, headers=auth(viewer)).status_code == 403
    assert client.delete(f"/api/tables/{table_id}/columns/{col['column_id']}", headers=auth(viewer)).status_code == 403

    # Analyst edits table and column, then deletes
    updated_table = client.patch(
        f"/api/tables/{table_id}",
        json={"table_name": "OTP_AUDIT_LOG", "description": "Updated purpose"},
        headers=auth(analyst),
    )
    assert updated_table.status_code == 200
    assert updated_table.json()["table_name"] == "OTP_AUDIT_LOG"

    updated_col = client.patch(
        f"/api/tables/{table_id}/columns/{col['column_id']}",
        json={"data_type": "VARCHAR(64)", "is_null": "Y", "description": "Primary identifier"},
        headers=auth(analyst),
    )
    assert updated_col.status_code == 200
    assert updated_col.json()["data_type"] == "VARCHAR(64)"
    assert updated_col.json()["is_null"] == "Y"

    assert client.delete(f"/api/tables/{table_id}/columns/{col['column_id']}", headers=auth(analyst)).status_code == 200
    assert client.delete(f"/api/tables/{table_id}", headers=auth(analyst)).status_code == 200
    assert client.get("/api/tables", headers=auth(viewer)).json() == []
