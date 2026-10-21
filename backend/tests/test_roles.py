from tests.conftest import auth, login


def _user_with(client, admin, role_id, login_id="custom1"):
    created = client.post(
        "/api/users", json={"login_id": login_id, "username": login_id, "password": "Password123!", "role_id": role_id}, headers=admin
    )
    assert created.status_code == 200, created.text
    token = client.post("/api/auth/login", json={"login_id": login_id, "password": "Password123!"}).json()["access_token"]
    return auth(token)


def test_predefined_roles_and_what_each_may_do(client):
    admin = auth(login(client, "Admin"))
    roles = {row["role_id"]: row for row in client.get("/api/roles", headers=admin).json()}
    levels = {key: (row["projects"], row["knowledge"], row["settings"]) for key, row in roles.items()}
    assert levels == {
        "viewer": ("read", "read", "none"),
        "analyst": ("write", "read", "none"),
        "super-analyst": ("write", "write", "none"),
        "administrator": ("write", "write", "write"),
    }
    assert [row["name"] for row in client.get("/api/roles", headers=admin).json()] == ["Viewer", "Analyst", "Super-analyst", "Administrator"]

    me = client.get("/api/auth/me", headers=auth(login(client, "Analyst"))).json()
    assert me["role_name"] == "Analyst" and me["permissions"] == {"projects": "write", "knowledge": "read", "settings": "none"}

    system = {"system_code": "SPL", "system_name": "SPL"}
    analyst = auth(login(client, "Analyst"))
    assert client.post("/api/systems", json=system, headers=analyst).status_code == 403  # knowledge read only
    assert client.get("/api/capabilities", headers=analyst).status_code == 200
    assert client.post("/api/projects", json={"project_name": "Mine"}, headers=analyst).status_code == 200
    assert client.get("/api/users", headers=analyst).status_code == 403  # no settings

    super_analyst = auth(login(client, "SuperAnalyst"))
    assert client.post("/api/systems", json=system, headers=super_analyst).status_code == 200
    viewer = auth(login(client, "Viewer"))
    assert client.post("/api/projects", json={"project_name": "No"}, headers=viewer).status_code == 403
    assert client.get("/api/projects", headers=viewer).status_code == 200
    assert client.post("/api/systems", json={"system_code": "DGE", "system_name": "DGE"}, headers=admin).status_code == 200


def test_custom_role_with_no_access_hides_the_area_and_read_only_settings(client):
    admin = auth(login(client, "Admin"))
    role = client.post(
        "/api/roles",
        json={"name": "Auditor", "description": "Reads settings only", "projects": "none", "knowledge": "none", "settings": "read"},
        headers=admin,
    )
    assert role.status_code == 200, role.text
    assert role.json()["role_id"] == "auditor"
    auditor = _user_with(client, admin, "auditor")
    assert client.get("/api/projects", headers=auditor).status_code == 403
    assert client.get("/api/capabilities", headers=auditor).status_code == 403
    assert client.get("/api/users", headers=auditor).status_code == 200
    assert client.get("/api/audit", headers=auditor).status_code == 200
    assert client.post("/api/roles", json={"name": "X"}, headers=auditor).status_code == 403
    assert client.post("/api/layouts", json={"name": "Runbook"}, headers=auditor).status_code == 403
    assert client.get("/api/dashboard", headers=auditor).status_code == 200  # everyone has a home page
    assert client.get("/api/systems", headers=auditor).status_code == 200  # a list of codes, used by project scope


def test_role_rules(client):
    admin = auth(login(client, "Admin"))
    assert client.post("/api/roles", json={"name": "viewer"}, headers=admin).status_code == 400  # names are unique
    assert client.post("/api/roles", json={"name": "Odd", "projects": "admin"}, headers=admin).status_code == 400
    assert client.patch("/api/roles/administrator", json={"settings": "read"}, headers=admin).status_code == 400
    assert client.delete("/api/roles/analyst", headers=admin).status_code == 400  # predefined
    edited = client.patch("/api/roles/viewer", json={"knowledge": "none"}, headers=admin)
    assert edited.status_code == 200 and edited.json()["knowledge"] == "none"
    assert client.get("/api/capabilities", headers=auth(login(client, "Viewer"))).status_code == 403

    client.post("/api/roles", json={"name": "Lead", "projects": "write", "knowledge": "write", "settings": "write"}, headers=admin)
    lead = _user_with(client, admin, "lead", "lead1")
    assert client.delete("/api/roles/lead", headers=admin).status_code == 400  # in use
    # the seeded administrator is not the only settings manager any more, so Lead may lose settings
    assert client.patch("/api/roles/lead", json={"settings": "read"}, headers=admin).status_code == 200
    assert client.post("/api/roles", json={"name": "Z"}, headers=lead).status_code == 403
    users = {row["login_id"]: row for row in client.get("/api/users", headers=admin).json()}
    assert users["lead1"]["role_name"] == "Lead" and users["lead1"]["role_id"] == "lead"
    client.patch(f"/api/users/{users['lead1']['user_id']}", json={"username": "lead1", "role_id": "viewer"}, headers=admin)
    assert client.delete("/api/roles/lead", headers=admin).status_code == 200
