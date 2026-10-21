from app.errors import AppError
from tests.conftest import auth, login


def _create(client, token, login_id="ian", name="Ian", password="Password123!", role="Analyst"):
    return client.post(
        "/api/users",
        json={"login_id": login_id, "username": name, "password": password, "role_name": role},
        headers=auth(token),
    )


def test_admin_creates_user_with_plain_login_id_and_user_can_sign_in(client):
    admin = login(client, "Admin")
    created = _create(client, admin)
    assert created.status_code == 200, created.text
    assert created.json()["login_id"] == "ian"
    signed_in = client.post("/api/auth/login", json={"login_id": "IAN", "password": "Password123!"})
    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["login_id"] == "ian"


def test_login_id_rules_and_duplicates(client):
    admin = login(client, "Admin")
    assert _create(client, admin, login_id="a").status_code == 400
    assert _create(client, admin, login_id="has space").status_code == 400
    for bad in ["ian@bank.com", "ian.chen", "ian_chen", "ian-chen", "ian!", "ián"]:
        assert _create(client, admin, login_id=bad).status_code == 400, bad
    assert _create(client, admin, password="short").status_code == 400
    assert _create(client, admin).status_code == 200
    assert _create(client, admin).status_code == 400
    assert _create(client, admin, login_id="IAN").status_code == 400
    assert _create(client, admin, login_id="Admin").status_code == 400


def test_login_id_keeps_the_case_it_was_typed_in_and_signs_in_any_case(client):
    admin = login(client, "Admin")
    created = _create(client, admin, login_id="IanChen")
    assert created.status_code == 200, created.text
    assert created.json()["login_id"] == "IanChen"
    for variant in ["IanChen", "ianchen", "IANCHEN"]:
        assert client.post("/api/auth/login", json={"login_id": variant, "password": "Password123!"}).status_code == 200
    assert client.post("/api/auth/login", json={"login_id": "ianchen", "password": "wrong-password"}).status_code == 401


def test_seed_users_use_plain_login_ids(client):
    admin = login(client, "Admin")
    ids = {user["login_id"] for user in client.get("/api/users", headers=auth(admin)).json()}
    assert ids == {"admin", "analyst", "viewer"}


def test_edit_changes_name_and_role_only(client):
    admin = login(client, "Admin")
    user_id = _create(client, admin).json()["user_id"]
    updated = client.patch(
        f"/api/users/{user_id}",
        json={"username": "Ian Chen", "role_name": "Analyst", "login_id": "someone-else"},
        headers=auth(admin),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["username"] == "Ian Chen"
    assert updated.json()["role_name"] == "Analyst"
    assert updated.json()["login_id"] == "ian"
    assert client.patch(f"/api/users/{user_id}", json={"username": "", "role_name": "Analyst"}, headers=auth(admin)).status_code == 400
    assert client.patch(f"/api/users/{user_id}", json={"username": "x", "role_name": "Boss"}, headers=auth(admin)).status_code == 400
    assert client.patch("/api/users/missing", json={"username": "x", "role_name": "Analyst"}, headers=auth(admin)).status_code == 404

    replaced = client.patch(
        f"/api/users/{user_id}",
        json={"username": "Ian Chen", "role_name": "Analyst", "password": "NewPassword1"},
        headers=auth(admin),
    )
    assert replaced.status_code == 200, replaced.text
    assert "password" not in replaced.json()
    assert client.post("/api/auth/login", json={"login_id": "ian", "password": "Password123!"}).status_code == 401
    assert client.post("/api/auth/login", json={"login_id": "ian", "password": "NewPassword1"}).status_code == 200
    assert (
        client.patch(
            f"/api/users/{user_id}",
            json={"username": "Ian Chen", "role_name": "Analyst", "password": "short"},
            headers=auth(admin),
        ).status_code
        == 400
    )
    assert client.post("/api/auth/login", json={"login_id": "ian", "password": "NewPassword1"}).status_code == 200


def test_last_admin_cannot_be_demoted_or_deleted(client):  # the last user who can manage settings
    admin = login(client, "Admin")
    users = client.get("/api/users", headers=auth(admin)).json()
    admin_id = next(user["user_id"] for user in users if user["role_id"] == "administrator")
    demoted = client.patch(f"/api/users/{admin_id}", json={"username": "Admin", "role_name": "Viewer"}, headers=auth(admin))
    assert demoted.status_code == 400
    assert client.delete(f"/api/users/{admin_id}", headers=auth(admin)).status_code == 400


def test_active_directory_user_has_no_stored_password(client, monkeypatch):
    monkeypatch.setenv("LDAP_URL", "ldap://directory.example:389")
    seen = {}

    def fake(login_id, password):
        seen["login_id"] = login_id
        seen["password"] = password
        if password != "DirectorySecret1":
            raise AppError(401, "Invalid login ID or password")
        return "Ada Lovelace"

    monkeypatch.setattr("app.services.ldap_auth.authenticate", fake)
    admin = login(client, "Admin")
    rejected = client.post(
        "/api/users",
        json={"login_id": "ada", "username": "Ada", "role_name": "Analyst", "auth_provider": "ldap", "password": "Password123!"},
        headers=auth(admin),
    )
    assert rejected.status_code == 400
    assert "password" in rejected.json()["detail"].lower()
    created = client.post(
        "/api/users",
        json={"login_id": "ada", "username": "Ada", "role_name": "Analyst", "auth_provider": "ldap"},
        headers=auth(admin),
    )
    assert created.status_code == 200, created.text
    assert created.json()["auth_provider"] == "ldap"
    assert "password" not in created.json()
    user_id = created.json()["user_id"]
    assert client.post("/api/auth/login", json={"login_id": "ADA", "password": "nope"}).status_code == 401
    signed_in = client.post("/api/auth/login", json={"login_id": "ada", "password": "DirectorySecret1"})
    assert signed_in.status_code == 200, signed_in.text
    assert seen == {"login_id": "ada", "password": "DirectorySecret1"}
    assert signed_in.json()["user"]["username"] == "Ada Lovelace"
    local_again = client.patch(
        f"/api/users/{user_id}",
        json={"username": "Ada", "role_name": "Analyst", "auth_provider": "local"},
        headers=auth(admin),
    )
    assert local_again.status_code == 400
    local_again = client.patch(
        f"/api/users/{user_id}",
        json={"username": "Ada", "role_name": "Analyst", "auth_provider": "local", "password": "LocalPass1"},
        headers=auth(admin),
    )
    assert local_again.status_code == 200, local_again.text
    assert local_again.json()["auth_provider"] == "local"
    assert client.post("/api/auth/login", json={"login_id": "ada", "password": "LocalPass1"}).status_code == 200


def test_ldap_user_requires_the_directory_to_be_configured(client, monkeypatch):
    monkeypatch.delenv("LDAP_URL", raising=False)
    monkeypatch.delenv("LDAP_HOST", raising=False)
    admin = login(client, "Admin")
    created = client.post(
        "/api/users",
        json={"login_id": "ada", "username": "Ada", "role_name": "Viewer", "auth_provider": "ldap"},
        headers=auth(admin),
    )
    assert created.status_code == 400
    assert "LDAP_HOST" in created.json()["detail"]


def test_non_admin_cannot_manage_users(client):
    analyst = login(client, "Analyst")
    assert _create(client, analyst).status_code == 403
    assert client.patch("/api/users/user-read", json={"username": "x", "role_name": "Admin"}, headers=auth(analyst)).status_code == 403
