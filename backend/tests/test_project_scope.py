from tests.conftest import auth, login


def test_project_scope_lists_countries_and_systems(client):
    admin = auth(login(client, "Admin"))
    client.post("/api/systems", json={"system_code": "SPL", "system_name": "SPL"}, headers=admin)
    client.post("/api/systems", json={"system_code": "DGE", "system_name": "DGE"}, headers=admin)
    writer = auth(login(client, "Write"))

    open_scope = client.post("/api/projects", json={"project_name": "Everywhere"}, headers=writer).json()
    assert open_scope["countries"] == [] and open_scope["systems"] == []  # empty = all

    created = client.post(
        "/api/projects",
        json={"project_name": "Cards", "countries": ["sg", "MY", "SG"], "systems": ["SPL"]},
        headers=writer,
    )
    assert created.status_code == 200, created.text
    project = created.json()
    assert project["countries"] == ["SG", "MY"]
    assert project["systems"] == ["SPL"]

    bad = client.post("/api/projects", json={"project_name": "Bad", "countries": ["XX"]}, headers=writer)
    assert bad.status_code == 400 and "country" in bad.text
    bad_system = client.patch(f"/api/projects/{project['project_id']}", json={"systems": ["NOPE"]}, headers=writer)
    assert bad_system.status_code == 400

    updated = client.patch(f"/api/projects/{project['project_id']}", json={"systems": ["DGE", "SPL"]}, headers=writer).json()
    assert updated["systems"] == ["DGE", "SPL"]
    assert updated["countries"] == ["SG", "MY"]  # untouched when not sent
    cleared = client.patch(f"/api/projects/{project['project_id']}", json={"countries": []}, headers=writer).json()
    assert cleared["countries"] == []
    listed = {item["project_id"]: item for item in client.get("/api/projects", headers=writer).json()}
    assert listed[project["project_id"]]["systems"] == ["DGE", "SPL"]
