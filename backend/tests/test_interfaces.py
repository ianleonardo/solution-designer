import io

from openpyxl import Workbook
from tests.conftest import auth, login

HEADER = ["Country", "Interface name", "Description", "Protocol", "Source", "Destination"]


def _excel(rows, header=HEADER) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _upload(client, token, channel, data, name="interfaces.xlsx"):
    files = {"file": (name, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    return client.post(f"/api/interfaces/{channel}/upload", files=files, headers=auth(token))


def _systems(client, admin):
    for code in ("SPL", "DGE", "PIB"):
        assert client.post("/api/systems", json={"system_code": code, "system_name": code}, headers=auth(admin)).status_code == 200


def test_valid_upload_replaces_only_that_channel(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    first = _upload(client, admin, "SPL", _excel([["sg", "Get balance", "Reads it", "api", "spl", "DGE"], ["All", "Notify", "", "Kafka", "DGE", "PIB"]]))
    assert first.status_code == 200, first.text
    rows = first.json()
    assert [(r["country"], r["protocol"], r["source"], r["destination"]) for r in rows] == [("SG", "API", "SPL", "DGE"), ("All", "Kafka", "DGE", "PIB")]
    _upload(client, admin, "DGE", _excel([["MY", "Other", "", "MQ", "DGE", "PIB"]]))
    replaced = _upload(client, admin, "SPL", _excel([["TH", "Only one", "", "gRPC", "PIB", "SPL"], [None, None, None, None, None, None]]))
    assert replaced.status_code == 200 and len(replaced.json()) == 1
    assert len(client.get("/api/interfaces/SPL", headers=auth(admin)).json()) == 1
    assert client.get("/api/interfaces/DGE", headers=auth(admin)).json()[0]["interface_name"] == "Other"


def test_every_rule_is_checked_and_nothing_is_imported_on_error(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    assert _upload(client, admin, "EAI", _excel([["SG", "Keep me", "", "API", "SPL", "DGE"]])).status_code == 200
    bad = _upload(
        client,
        admin,
        "EAI",
        _excel(
            [
                ["JP", "A", "", "API", "SPL", "DGE"],
                ["SG", "B", "", "SOAP", "SPL", "DGE"],
                ["SG", "C", "", "API", "NOPE", "DGE"],
                ["SG", "D", "", "API", "SPL", "GHOST"],
                ["SG", "", "", "API", "SPL", "DGE"],
            ]
        ),
    )
    assert bad.status_code == 400
    problems = {(item["row"], item["field"]) for item in bad.json()["errors"]}
    assert problems == {(2, "Country"), (3, "Protocol"), (4, "Source"), (5, "Destination"), (6, "Interface name")}
    kept = client.get("/api/interfaces/EAI", headers=auth(admin)).json()
    assert [item["interface_name"] for item in kept] == ["Keep me"]


def test_bad_files_and_channels(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    wrong_header = _upload(client, admin, "SPL", _excel([["SG", "x", "", "API", "SPL", "DGE"]], header=["Country", "Name", "Description", "Protocol", "Source", "Destination"]))
    assert wrong_header.status_code == 400 and "Interface name" in wrong_header.json()["detail"]
    assert _upload(client, admin, "SPL", b"not excel").status_code == 400
    assert _upload(client, admin, "SPL", _excel([]), name="x.csv").status_code == 400
    assert _upload(client, admin, "SPL", _excel([])).status_code == 400
    assert _upload(client, admin, "XYZ", _excel([["SG", "x", "", "API", "SPL", "DGE"]])).status_code == 404
    assert client.get("/api/interfaces/XYZ", headers=auth(admin)).status_code == 404


def test_system_used_by_an_interface_cannot_be_deleted(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    _upload(client, admin, "PIB", _excel([["SG", "x", "", "API", "SPL", "DGE"]]))
    blocked = client.delete("/api/systems/SPL", headers=auth(admin))
    assert blocked.status_code == 409 and "PIB" in blocked.json()["detail"]
    assert client.delete("/api/systems/PIB", headers=auth(admin)).status_code == 200


def test_only_admin_can_use_interfaces(client):
    admin = login(client, "Admin")
    _systems(client, admin)
    for role in ("Maker", "Checker", "Viewer"):
        token = login(client, role)
        assert client.get("/api/interfaces/SPL", headers=auth(token)).status_code == 403
        assert _upload(client, token, "SPL", _excel([["SG", "x", "", "API", "SPL", "DGE"]])).status_code == 403
