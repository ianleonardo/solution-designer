import io

from openpyxl import Workbook
from tests.conftest import auth, login


def _create(client, token, code, **extra):
    body = {"system_code": code, "system_name": f"{code} name", **extra}
    return client.post("/api/systems", json=body, headers=auth(token))


def test_admin_adds_edits_lists_and_deletes_systems(client):
    admin = login(client, "Admin")
    created = _create(client, admin, " spl ", description="Front door")
    assert created.status_code == 200, created.text
    assert created.json()["system_code"] == "SPL"
    assert created.json()["upstreams"] == "" and created.json()["downstreams"] == ""
    assert _create(client, admin, "DGE").status_code == 200
    assert _create(client, admin, "PIB").status_code == 200

    edited = client.patch("/api/systems/dge", json={"system_name": "Digital gateway"}, headers=auth(admin))
    assert edited.status_code == 200, edited.text
    assert edited.json()["system_name"] == "Digital gateway"
    assert edited.json()["upstreams"] == "" and edited.json()["downstreams"] == ""

    listed = client.get("/api/systems", headers=auth(admin)).json()
    assert [item["system_code"] for item in listed] == ["DGE", "PIB", "SPL"]

    assert client.delete("/api/systems/PIB", headers=auth(admin)).status_code == 200
    assert [item["system_code"] for item in client.get("/api/systems", headers=auth(admin)).json()] == ["DGE", "SPL"]


def test_system_code_and_name_rules(client):
    admin = login(client, "Admin")
    assert client.post("/api/systems", json={"system_code": "", "system_name": "x"}, headers=auth(admin)).status_code == 400
    assert client.post("/api/systems", json={"system_code": "A B", "system_name": "x"}, headers=auth(admin)).status_code == 400
    assert client.post("/api/systems", json={"system_code": "A", "system_name": " "}, headers=auth(admin)).status_code == 400
    assert _create(client, admin, "A").status_code == 200
    assert _create(client, admin, "a").status_code == 400
    assert client.patch("/api/systems/NOPE", json={"system_name": "x"}, headers=auth(admin)).status_code == 404
    assert client.delete("/api/systems/NOPE", headers=auth(admin)).status_code == 404


def test_analyst_can_edit_and_viewer_can_only_view_systems(client):
    admin = login(client, "Admin")
    _create(client, admin, "SPL")
    analyst = auth(login(client, "Analyst"))
    assert client.get("/api/systems", headers=analyst).status_code == 200
    assert client.post("/api/systems", json={"system_code": "DGE", "system_name": "Digital"}, headers=analyst).status_code == 200
    assert client.patch("/api/systems/SPL", json={"system_name": "Updated"}, headers=analyst).status_code == 200

    viewer = auth(login(client, "Viewer"))
    assert client.get("/api/systems", headers=viewer).status_code == 200
    assert client.post("/api/systems", json={"system_code": "X", "system_name": "x"}, headers=viewer).status_code == 403
    assert client.patch("/api/systems/SPL", json={"system_name": "x"}, headers=viewer).status_code == 403
    assert client.delete("/api/systems/SPL", headers=viewer).status_code == 403


def test_has_batch_and_has_report_flags(client):
    admin = login(client, "Admin")
    created = _create(client, admin, "SPL", has_batch=True, has_report=False, has_capability=True)
    assert created.status_code == 200, created.text
    assert created.json()["has_batch"] is True
    assert created.json()["has_report"] is False
    assert created.json()["has_capability"] is True
    edited = client.patch(
        "/api/systems/SPL",
        json={"has_report": True, "has_batch": False, "has_capability": False},
        headers=auth(admin),
    )
    assert edited.status_code == 200
    assert edited.json()["has_batch"] is False
    assert edited.json()["has_report"] is True
    assert edited.json()["has_capability"] is False
    listed = client.get("/api/systems", headers=auth(admin)).json()
    assert listed[0]["has_report"] is True


def _workbook(rows: list[list], headers=("SYSTEM_CODE", "SYSTEM_NAME", "DESCRIPTION")) -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.append(list(headers))
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def test_excel_upload_adds_and_updates_systems(client):
    admin = login(client, "Admin")
    _create(client, admin, "SPL", description="Keep me")
    _create(client, admin, "DGE")
    data = _workbook(
        [
            ["spl", "SPL Core", ""],
            ["pib", "PIB", "Payments"],
            ["", "", ""],
        ]
    )
    uploaded = client.post(
        "/api/systems/upload",
        files={"file": ("systems.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth(admin),
    )
    assert uploaded.status_code == 200, uploaded.text
    by_code = {item["system_code"]: item for item in uploaded.json()}
    assert by_code["SPL"]["system_name"] == "SPL Core"
    assert by_code["SPL"]["description"] == "Keep me"
    assert by_code["PIB"]["description"] == "Payments"
    assert by_code["PIB"]["upstreams"] == "" and by_code["PIB"]["has_batch"] is False
    assert by_code["DGE"]["upstreams"] == ""

    missing = client.post(
        "/api/systems/upload",
        files={"file": ("systems.xlsx", _workbook([["NTN", "NTN"]], headers=("SYSTEM_CODE", "SYSTEM_NAME")), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth(admin),
    )
    assert missing.status_code == 200, missing.text
    assert any(item["system_code"] == "NTN" and item["description"] == "" for item in missing.json())

    rejected = client.post(
        "/api/systems/upload",
        files={"file": ("systems.xlsx", _workbook([["BAD CODE", "Bad", ""], ["OK", "", ""]]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth(admin),
    )
    assert rejected.status_code == 400
    assert rejected.json()["errors"]
    assert all(item["system_code"] != "OK" for item in client.get("/api/systems", headers=auth(admin)).json())

    viewer = auth(login(client, "Viewer"))
    assert client.post(
        "/api/systems/upload",
        files={"file": ("systems.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=viewer,
    ).status_code == 403
