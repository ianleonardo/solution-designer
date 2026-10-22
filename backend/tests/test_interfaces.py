import io

from openpyxl import Workbook
from tests.conftest import auth, login

HEADER = ["Interface name", "Endpoint", "Description", "Protocol", "Source", "Destination"]


def _excel(rows, header=HEADER) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _upload(client, token, channel, data, name="interfaces.xlsx", country="SG"):
    files = {"file": (name, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    return client.post(f"/api/interfaces/{channel}/upload", data={"country": country}, files=files, headers=auth(token))


def _systems(client, admin):
    for code in ("SPL", "DGE", "PIB"):
        assert client.post("/api/systems", json={"system_code": code, "system_name": code}, headers=auth(admin)).status_code == 200


def test_valid_upload_replaces_only_that_channel(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    first = _upload(client, admin, "SPL", _excel([["Get balance", "/balance", "Reads it", "api", "spl", "DGE"], ["Notify", "", "", "Kafka", "DGE, PIB", "PIB"]]), country="SG,VN")
    assert first.status_code == 200, first.text
    rows = first.json()
    assert [(r["country"], r["endpoint"], r["protocol"], r["source"], r["destination"]) for r in rows] == [
        ("SG,VN", "/balance", "API", "SPL", "DGE"),
        ("SG,VN", "", "Kafka", "DGE, PIB", "PIB"),
    ]
    _upload(client, admin, "DGE", _excel([["Other", "", "", "MQ", "DGE", "PIB"]]), country="MY")
    kept = _upload(client, admin, "SPL", _excel([["Stay", "", "", "API", "SPL", "DGE"]]), country="MY")
    assert kept.status_code == 200 and len(kept.json()) == 3
    replaced = _upload(client, admin, "SPL", _excel([["Only one", "/one", "", "gRPC", "PIB", "SPL"], [None, None, None, None, None, None]]), country="SG,VN")
    assert replaced.status_code == 200 and len(replaced.json()) == 2
    names = {row["interface_name"] for row in client.get("/api/interfaces/SPL", headers=auth(admin)).json()}
    assert names == {"Only one", "Stay"}
    assert client.get("/api/interfaces/DGE", headers=auth(admin)).json()[0]["interface_name"] == "Other"


def test_every_rule_is_checked_and_nothing_is_imported_on_error(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    assert _upload(client, admin, "EAI", _excel([["Keep me", "", "", "API", "SPL", "DGE"]])).status_code == 200
    bad = _upload(
        client,
        admin,
        "EAI",
        _excel(
            [
                ["B", "", "", "SOAP", "SPL", "DGE"],
                ["C", "", "", "API", "NOPE", "DGE"],
                ["D", "", "", "API", "SPL", "GHOST"],
                ["", "", "", "API", "SPL", "DGE"],
            ]
        ),
    )
    assert bad.status_code == 400
    problems = {(item["row"], item["field"]) for item in bad.json()["errors"]}
    assert problems == {(2, "Protocol"), (3, "Source"), (4, "Destination"), (5, "Interface name")}
    kept = client.get("/api/interfaces/EAI", headers=auth(admin)).json()
    assert [item["interface_name"] for item in kept] == ["Keep me"]


def test_bad_files_and_channels(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    wrong_header = _upload(client, admin, "SPL", _excel([["x", "", "", "API", "SPL", "DGE"]], header=["Name", "Endpoint", "Description", "Protocol", "Source", "Destination"]))
    assert wrong_header.status_code == 400 and "Interface name" in wrong_header.json()["detail"]
    assert _upload(client, admin, "SPL", b"not excel").status_code == 400
    assert _upload(client, admin, "SPL", _excel([]), name="x.csv").status_code == 400
    assert _upload(client, admin, "SPL", _excel([])).status_code == 400
    assert _upload(client, admin, "XYZ", _excel([["x", "", "", "API", "SPL", "DGE"]])).status_code == 404
    assert client.get("/api/interfaces/XYZ", headers=auth(admin)).status_code == 404


def test_deleting_a_system_keeps_the_interfaces_that_use_it(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    _upload(client, admin, "PIB", _excel([["x", "", "", "API", "SPL, DGE", "DGE"]]))
    impact = client.get("/api/systems/SPL/delete-impact", headers=auth(admin)).json()
    assert [row["interface_name"] for row in impact["interfaces_kept"]] == ["x"]
    deleted = client.delete("/api/systems/SPL?confirm=SPL", headers=auth(admin))
    assert deleted.status_code == 200 and deleted.json()["interfaces_kept"] == 1
    kept = client.get("/api/interfaces/PIB", headers=auth(admin)).json()
    assert [row["interface_name"] for row in kept] == ["x"]


def test_analyst_can_upload_and_viewer_can_only_view_interfaces(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    analyst = login(client, "SuperAnalyst")
    assert client.get("/api/interfaces/SPL", headers=auth(analyst)).status_code == 200
    assert _upload(client, analyst, "SPL", _excel([["x", "", "", "API", "SPL", "DGE"]])).status_code == 200
    viewer = login(client, "Viewer")
    assert client.get("/api/interfaces/SPL", headers=auth(viewer)).status_code == 200
    assert _upload(client, viewer, "SPL", _excel([["x", "", "", "API", "SPL", "DGE"]])).status_code == 403


def test_manual_interface_crud(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    analyst = login(client, "SuperAnalyst")
    viewer = login(client, "Viewer")

    created = client.post(
        "/api/interfaces/SPL",
        json={
            "country": "SG,MY",
            "interface_name": "Balance API",
            "endpoint": "/balance",
            "description": "Get balance",
            "protocol": "API",
            "source": "SPL, DGE",
            "destination": "DGE",
        },
        headers=auth(analyst),
    )
    assert created.status_code == 200, created.text
    row = created.json()
    assert row["channel"] == "SPL" and row["country"] == "SG,MY" and row["endpoint"] == "/balance" and row["source"] == "SPL, DGE"
    interface_id = row["interface_id"]

    assert (
        client.post(
            "/api/interfaces/SPL",
            json={"country": "SG", "interface_name": "X", "protocol": "API", "source": "SPL", "destination": "DGE"},
            headers=auth(viewer),
        ).status_code
        == 403
    )

    updated = client.patch(
        f"/api/interfaces/SPL/{interface_id}",
        json={
            "country": "",
            "interface_name": "Balance API v2",
            "endpoint": "/v2",
            "description": "Updated",
            "protocol": "MQ",
            "source": "DGE",
            "destination": "PIB, SPL",
        },
        headers=auth(analyst),
    )
    assert updated.status_code == 200
    assert updated.json()["interface_name"] == "Balance API v2"
    assert updated.json()["protocol"] == "MQ"

    assert client.delete(f"/api/interfaces/SPL/{interface_id}", headers=auth(viewer)).status_code == 403
    assert client.delete(f"/api/interfaces/SPL/{interface_id}", headers=auth(analyst)).status_code == 200
    assert client.get("/api/interfaces/SPL", headers=auth(admin)).json() == []


def _field(direction, path, field_type="string", required="Y", **extra):
    return {"direction": direction, "field_path": path, "field_type": field_type, "required": required, **extra}


def test_specification_is_stored_on_the_detail_and_kept_when_excel_replaces_the_header(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    created = client.post(
        "/api/interfaces/SPL",
        json={
            "country": "SG",
            "interface_name": "Balance API",
            "endpoint": "/balance",
            "description": "Get balance",
            "protocol": "API",
            "source": "SPL",
            "destination": "DGE",
            "processing_rules": "Return the ledger balance.",
            "validation_rules": "Amount is required when type is TRANSFER.",
            "fields": [
                _field("request", "account.currency", "string", "Y", length="3", validation="ISO currency", description="Currency", example="SGD"),
                _field("request", "amount", "number", "C"),
                _field("response", "amount", "number", "Y", description="Posted amount"),
            ],
        },
        headers=auth(admin),
    )
    assert created.status_code == 200, created.text
    detail = created.json()
    interface_id = detail["interface_id"]
    assert detail["processing_rules"] == "Return the ledger balance."
    assert [field["field_path"] for field in detail["fields"] if field["direction"] == "request"] == ["account.currency", "amount"]
    assert detail["fields"][0]["position"] == 0
    assert detail["fields"][2]["field_path"] == "amount" and detail["fields"][2]["direction"] == "response"

    listed = client.get("/api/interfaces/SPL", headers=auth(admin)).json()
    assert "fields" not in listed[0]
    assert "processing_rules" not in listed[0]

    loaded = client.get(f"/api/interfaces/SPL/{interface_id}", headers=auth(admin))
    assert loaded.status_code == 200
    assert loaded.json()["validation_rules"] == "Amount is required when type is TRANSFER."

    replaced = _upload(client, admin, "SPL", _excel([["Balance API", "/v2", "Updated", "MQ", "DGE", "SPL"]]))
    assert replaced.status_code == 200, replaced.text
    kept = client.get(f"/api/interfaces/SPL/{interface_id}", headers=auth(admin)).json()
    assert kept["endpoint"] == "/v2" and kept["protocol"] == "MQ" and kept["description"] == "Updated"
    assert kept["processing_rules"] == "Return the ledger balance."
    assert [field["field_path"] for field in kept["fields"]] == ["account.currency", "amount", "amount"]

    removed = _upload(client, admin, "SPL", _excel([["Other", "", "", "API", "SPL", "DGE"]]))
    assert removed.status_code == 200
    assert client.get(f"/api/interfaces/SPL/{interface_id}", headers=auth(admin)).status_code == 404
    names = [row["interface_name"] for row in client.get("/api/interfaces/SPL", headers=auth(admin)).json()]
    assert names == ["Other"]
    fresh = client.get(f"/api/interfaces/SPL/{removed.json()[0]['interface_id']}", headers=auth(admin)).json()
    assert fresh["fields"] == [] and fresh["processing_rules"] == ""


def test_specification_rejects_bad_fields_and_overlong_rules(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    base = {"country": "SG", "interface_name": "Balance API", "protocol": "API", "source": "SPL", "destination": "DGE"}
    duplicate = client.post(
        "/api/interfaces/SPL",
        json={**base, "fields": [_field("request", "amount"), _field("request", "amount", "number")]},
        headers=auth(admin),
    )
    assert duplicate.status_code == 400 and "listed more than once" in duplicate.json()["detail"]
    bad_type = client.post("/api/interfaces/SPL", json={**base, "fields": [_field("request", "amount", "money")]}, headers=auth(admin))
    assert bad_type.status_code == 400 and "Field type" in bad_type.json()["detail"]
    long_rules = client.post("/api/interfaces/SPL", json={**base, "processing_rules": "x" * 20001}, headers=auth(admin))
    assert long_rules.status_code == 400 and "20000" in long_rules.json()["detail"]
    assert client.get("/api/interfaces/SPL", headers=auth(admin)).json() == []


def test_text_for_puts_fields_before_the_rules():
    from app.services.interfaces import text_for

    text = text_for(
        {
            "interface_name": "Balance API",
            "channel": "SPL",
            "country": "SG",
            "description": "Get balance",
            "endpoint": "/balance",
            "protocol": "API",
            "source": "SPL",
            "destination": "DGE",
            "processing_rules": "Return the ledger balance.",
            "validation_rules": "Currency must be open.",
            "fields": [
                {"direction": "request", "field_path": "amount", "field_type": "number", "required": "Y", "validation": "Greater than zero", "description": "Transfer amount"},
            ],
        }
    )
    assert text.index("request amount (number, required): Greater than zero. Transfer amount") < text.index("Processing rules:")
    assert text.index("Processing rules:") < text.index("Validation rules:")


FIELD_HEADER = ["Direction", "Field path", "Type", "Required", "Length", "Validation", "Description", "Example"]


def _upload_fields(client, token, channel, data, name="fields.xlsx"):
    files = {"file": (name, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    return client.post(f"/api/interfaces/{channel}/fields/upload", files=files, headers=auth(token))


def test_field_workbook_returns_request_then_response_and_does_not_save(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    created = client.post(
        "/api/interfaces/SPL",
        json={"country": "SG", "interface_name": "Balance API", "protocol": "API", "source": "SPL", "destination": "DGE", "processing_rules": "Keep me."},
        headers=auth(admin),
    )
    assert created.status_code == 200, created.text
    interface_id = created.json()["interface_id"]
    uploaded = _upload_fields(
        client,
        admin,
        "SPL",
        _excel(
            [
                ["response", "balance", "number", "Y", "", "", "Posted balance", "10.00"],
                ["request", "account.currency", "string", "Y", "3", "ISO currency", "Currency", "SGD"],
                ["request", "amount", "number", "C", "", "", "", ""],
                [None, None, None, None, None, None, None, None],
            ],
            header=FIELD_HEADER,
        ),
    )
    assert uploaded.status_code == 200, uploaded.text
    assert [(field["direction"], field["field_path"], field["position"]) for field in uploaded.json()["fields"]] == [
        ("request", "account.currency", 0),
        ("request", "amount", 1),
        ("response", "balance", 0),
    ]
    assert uploaded.json()["fields"][0]["length"] == "3"
    stored = client.get(f"/api/interfaces/SPL/{interface_id}", headers=auth(admin)).json()
    assert stored["fields"] == [] and stored["processing_rules"] == "Keep me."


def test_field_workbook_names_each_problem_and_blocks_viewers(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    bad_type = _upload_fields(client, admin, "SPL", _excel([["request", "amount", "money", "Y", "", "", "", ""]], header=FIELD_HEADER))
    assert bad_type.status_code == 400
    assert bad_type.json()["errors"] == [{"row": 2, "field": "Type", "message": "Field type must be one of: string, number, integer, boolean, date, datetime, object, array, enum."}]
    duplicate = _upload_fields(
        client,
        admin,
        "SPL",
        _excel([["request", "amount", "number", "Y", "", "", "", ""], ["request", "amount", "string", "N", "", "", "", ""]], header=FIELD_HEADER),
    )
    assert duplicate.status_code == 400 and duplicate.json()["errors"][0]["field"] == "Field path" and "listed more than once" in duplicate.json()["errors"][0]["message"]
    missing = _upload_fields(client, admin, "SPL", _excel([["request", "amount", "string", "Y"]], header=["Direction", "Type", "Required", "Length"]))
    assert missing.status_code == 400 and "Field path" in missing.json()["detail"]
    viewer = login(client, "Viewer")
    assert _upload_fields(client, viewer, "SPL", _excel([["request", "amount", "string", "Y", "", "", "", ""]], header=FIELD_HEADER)).status_code == 403
