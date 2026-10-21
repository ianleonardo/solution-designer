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
