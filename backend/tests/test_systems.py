from tests.conftest import auth, login


def _create(client, token, code, **extra):
    body = {"system_code": code, "system_name": f"{code} name", **extra}
    return client.post("/api/systems", json=body, headers=auth(token))


def test_admin_adds_edits_lists_and_deletes_systems(client):
    admin = login(client, "Admin")
    created = _create(client, admin, " spl ", description="Front door")
    assert created.status_code == 200, created.text
    assert created.json()["system_code"] == "SPL"
    assert _create(client, admin, "DGE", upstreams="spl").json()["upstreams"] == "SPL"
    assert _create(client, admin, "PIB", upstreams="SPL, DGE,spl", downstreams="").json()["upstreams"] == "SPL, DGE"

    edited = client.patch("/api/systems/dge", json={"system_name": "Digital gateway", "downstreams": "PIB", "upstreams": ""}, headers=auth(admin))
    assert edited.status_code == 200, edited.text
    assert edited.json()["system_name"] == "Digital gateway"
    assert edited.json()["downstreams"] == "PIB" and edited.json()["upstreams"] == ""

    listed = client.get("/api/systems", headers=auth(admin)).json()
    assert [item["system_code"] for item in listed] == ["DGE", "PIB", "SPL"]

    assert client.delete("/api/systems/PIB", headers=auth(admin)).status_code == 409  # DGE still points at it
    client.patch("/api/systems/DGE", json={"downstreams": ""}, headers=auth(admin))
    assert client.delete("/api/systems/PIB", headers=auth(admin)).status_code == 200
    assert [item["system_code"] for item in client.get("/api/systems", headers=auth(admin)).json()] == ["DGE", "SPL"]


def test_upstreams_and_downstreams_must_exist_but_may_be_empty(client):
    admin = login(client, "Admin")
    assert _create(client, admin, "SPL", upstreams="", downstreams="").status_code == 200
    unknown = _create(client, admin, "DGE", upstreams="SPL, NOPE, ALSO")
    assert unknown.status_code == 400
    assert "NOPE" in unknown.json()["detail"] and "ALSO" in unknown.json()["detail"]
    bad_down = client.patch("/api/systems/SPL", json={"downstreams": "GHOST"}, headers=auth(admin))
    assert bad_down.status_code == 400 and "GHOST" in bad_down.json()["detail"]
    assert client.patch("/api/systems/SPL", json={"downstreams": "SPL"}, headers=auth(admin)).status_code == 400


def test_system_code_and_name_rules(client):
    admin = login(client, "Admin")
    assert client.post("/api/systems", json={"system_code": "", "system_name": "x"}, headers=auth(admin)).status_code == 400
    assert client.post("/api/systems", json={"system_code": "A B", "system_name": "x"}, headers=auth(admin)).status_code == 400
    assert client.post("/api/systems", json={"system_code": "A", "system_name": " "}, headers=auth(admin)).status_code == 400
    assert _create(client, admin, "A").status_code == 200
    assert _create(client, admin, "a").status_code == 400
    assert client.patch("/api/systems/NOPE", json={"system_name": "x"}, headers=auth(admin)).status_code == 404
    assert client.delete("/api/systems/NOPE", headers=auth(admin)).status_code == 404


def test_system_cannot_be_deleted_while_another_system_lists_it(client):
    admin = login(client, "Admin")
    _create(client, admin, "SPL")
    _create(client, admin, "DGE", upstreams="SPL")
    blocked = client.delete("/api/systems/SPL", headers=auth(admin))
    assert blocked.status_code == 409 and "DGE" in blocked.json()["detail"]
    client.patch("/api/systems/DGE", json={"upstreams": ""}, headers=auth(admin))
    assert client.delete("/api/systems/SPL", headers=auth(admin)).status_code == 200


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
