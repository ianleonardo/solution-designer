import io

from openpyxl import Workbook
from tests.conftest import auth, login

HEADER = ["BATCH_NAME", "BATCH_TYPE", "TO_FROM_SYSTEMS", "DESCRIPTION", "FREQUENCY", "BATCH_FILENAME", "FILE_LAYOUT"]


def _excel(rows, header=HEADER) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _system(client, token, code="SPL"):
    assert (
        client.post(
            "/api/systems",
            json={"system_code": code, "system_name": code, "has_batch": True},
            headers=auth(token),
        ).status_code
        == 200
    )


def test_batches_upload_list_and_detail(client):
    admin = login(client, "Admin")
    _system(client, admin)
    _system(client, admin, "DGE")
    analyst = login(client, "SuperAnalyst")
    viewer = login(client, "Viewer")

    data = _excel(
        [
            ["Nightly Settlement", "incoming", "DGE", "Settle cards", "adhoc, quarterly", "settle.in", "Col A | Col B"],
            ["Outbound Feed", "OUTGOING", "DGE, SPL", "Push to partner", "Other: Biweekly", "feed.out", "Layout text"],
        ]
    )
    files = {"file": ("batches.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    upload = client.post(
        "/api/batches/upload",
        data={"country": "SG", "system": "SPL"},
        files=files,
        headers=auth(analyst),
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    assert body["uploaded"] == 2
    assert len(body["batches"]) == 2

    listed = client.get("/api/batches", headers=auth(viewer))
    assert listed.status_code == 200
    rows = listed.json()
    by_name = {row["batch_name"]: row for row in rows}
    assert set(by_name) == {"Nightly Settlement", "Outbound Feed"}
    assert by_name["Nightly Settlement"]["batch_type"] == "incoming"
    assert by_name["Nightly Settlement"]["to_from_systems"] == "DGE"
    assert by_name["Outbound Feed"]["batch_type"] == "outgoing"
    assert by_name["Outbound Feed"]["to_from_systems"] == "DGE, SPL"
    assert by_name["Nightly Settlement"]["frequency"] == "Adhoc, Quarterly"
    assert by_name["Outbound Feed"]["frequency"] == "Other"
    assert by_name["Outbound Feed"]["frequency_other"] == "Biweekly"

    first = rows[0]
    detail = client.get(f"/api/batches/{first['batch_id']}", headers=auth(viewer))
    assert detail.status_code == 200
    assert detail.json()["batch_filename"]
    assert detail.json()["file_layout"]

    assert (
        client.post(
            "/api/batches/upload",
            data={"country": "SG", "system": "SPL"},
            files=files,
            headers=auth(viewer),
        ).status_code
        == 403
    )

    blocked = client.post(
        "/api/rag",
        params={"inventory_type": "Batches"},
        files={"file": ("b.md", b"# batch", "text/markdown")},
        headers=auth(admin),
    )
    assert blocked.status_code == 400
    assert "batches" in blocked.json()["detail"].lower()

    created = client.post(
        "/api/batches",
        json={
            "country": "MY",
            "system_code": "SPL",
            "batch_name": "Manual Job",
            "batch_type": "incoming",
            "to_from_systems": "DGE",
            "description": "Hand entered",
            "batch_filename": "manual.dat",
            "file_layout": "A|B|C",
        },
        headers=auth(analyst),
    )
    assert created.status_code == 200, created.text
    assert created.json()["batch_name"] == "Manual Job"

    posted = client.post(
        "/api/batches",
        json={"country": "SG", "system_code": "SPL", "batch_name": "Txn Feed", "batch_type": "Transaction"},
        headers=auth(analyst),
    )
    assert posted.status_code == 200, posted.text
    assert posted.json()["batch_type"] == "transaction"
    assert created.json()["to_from_systems"] == "DGE"

    assert client.delete(f"/api/batches/{first['batch_id']}", headers=auth(analyst)).status_code == 200
    assert len(client.get("/api/batches", headers=auth(viewer)).json()) == 3


def test_batches_reject_invalid_type(client):
    admin = login(client, "Admin")
    _system(client, admin)
    analyst = login(client, "SuperAnalyst")
    data = _excel([["Bad Job", "sideways", "", "Nope", "", "x.dat", "layout"]])
    files = {"file": ("batches.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    upload = client.post(
        "/api/batches/upload",
        data={"country": "SG", "system": "SPL"},
        files=files,
        headers=auth(analyst),
    )
    assert upload.status_code == 400
    body = upload.json()
    assert "problem" in body["detail"].lower()
    assert client.get("/api/batches", headers=auth(analyst)).json() == []


def test_batches_reject_unknown_to_from_systems(client):
    admin = login(client, "Admin")
    _system(client, admin)
    analyst = login(client, "SuperAnalyst")
    data = _excel([["Peer Job", "incoming", "NOPE", "x", "Yearly", "x.dat", "layout"]])
    files = {"file": ("batches.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    upload = client.post(
        "/api/batches/upload",
        data={"country": "SG", "system": "SPL"},
        files=files,
        headers=auth(analyst),
    )
    assert upload.status_code == 400
    body = upload.json()
    assert "problem" in body["detail"].lower()
    assert any("TO_FROM_SYSTEMS" in (err.get("field") or "") for err in body.get("errors") or [])
    assert any(err.get("field") == "FREQUENCY" for err in body["errors"])

    bad = client.post(
        "/api/batches",
        json={
            "country": "SG",
            "system_code": "SPL",
            "batch_name": "Manual Peer",
            "batch_type": "incoming",
            "to_from_systems": "MISSING",
            "description": "",
            "batch_filename": "",
            "file_layout": "",
        },
        headers=auth(analyst),
    )
    assert bad.status_code == 400
    assert "unknown" in bad.json()["detail"].lower()



def test_batches_edit_country_system_and_reject_duplicate_name(client):
    admin = login(client, "Admin")
    _system(client, admin, "SPL")
    _system(client, admin, "DGE")
    analyst = login(client, "SuperAnalyst")
    first = client.post(
        "/api/batches",
        json={
            "country": "SG",
            "system_code": "SPL",
            "batch_name": "Night Job",
            "batch_type": "incoming",
            "description": "a",
            "batch_filename": "a.dat",
            "file_layout": "A",
        },
        headers=auth(analyst),
    )
    assert first.status_code == 200, first.text
    second = client.post(
        "/api/batches",
        json={
            "country": "MY",
            "system_code": "DGE",
            "batch_name": "Other Job",
            "batch_type": "outgoing",
            "description": "b",
            "batch_filename": "b.dat",
            "file_layout": "B",
        },
        headers=auth(analyst),
    )
    assert second.status_code == 200, second.text

    moved = client.patch(
        f"/api/batches/{first.json()['batch_id']}",
        json={"country": "MY", "system_code": "DGE", "batch_name": "Night Job"},
        headers=auth(analyst),
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["country"] == "MY"
    assert moved.json()["system_code"] == "DGE"

    dup = client.patch(
        f"/api/batches/{first.json()['batch_id']}",
        json={"country": "MY", "system_code": "DGE", "batch_name": "other job"},
        headers=auth(analyst),
    )
    assert dup.status_code == 400
    assert "already exists" in dup.json()["detail"].lower()
