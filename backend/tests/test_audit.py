import json

from tests.conftest import auth, login


def _log(client, **query):
    admin = login(client, "Admin")
    response = client.get("/api/audit", params=query, headers=auth(admin))
    assert response.status_code == 200, response.text
    return response.json()


def _by_action(entries, action):
    return [entry for entry in entries if entry["action"] == action]


def test_creating_a_project_records_who_what_and_when(client):
    writer = login(client, "Write")
    created = client.post("/api/projects", json={"project_name": "Cards Hub", "description": "d"}, headers=auth(writer)).json()
    (entry,) = _by_action(_log(client), "create_project")
    assert entry["login_id"] == "writer" and entry["role_name"] == "Write" and entry["username"] == "Writer"
    assert entry["entity_type"] == "project" and entry["entity_id"] == created["project_id"]
    assert entry["method"] == "POST" and entry["path"] == "/api/projects"
    assert "Cards Hub" in entry["summary"] and entry["summary"].startswith("Create project")
    assert entry["detail"]["request"]["project_name"] == "Cards Hub"
    assert entry["occurred_at"]


def test_document_changes_are_recorded_without_storing_the_content(client):
    writer = login(client, "Write")
    project_id = client.post("/api/projects", json={"project_name": "Docs"}, headers=auth(writer)).json()["project_id"]
    document = client.get(f"/api/projects/{project_id}/documents", headers=auth(writer)).json()[0]
    base = f"/api/projects/{project_id}/documents/{document['document_id']}"
    secret_text = "CONFIDENTIAL-SETTLEMENT-NUMBERS"
    sections = {item: {**value, "blocks": [{"type": "prose", "markdown": secret_text}]} for item, value in document["content_json"]["sections"].items()}
    assert client.put(base, json={"content_json": {"sections": sections}}, headers=auth(writer)).status_code == 200
    section = client.post(f"{base}/sections", json={"section_name": "Extra"}, headers=auth(writer)).json()["templates"][-1]
    assert client.patch(f"{base}/sections/{section['template_id']}", json={"section_name": "Renamed"}, headers=auth(writer)).status_code == 200
    assert client.delete(f"{base}/sections/{section['template_id']}", headers=auth(writer)).status_code == 200
    assert client.get(f"{base}/export?format=md", headers=auth(writer)).status_code == 200

    entries = _log(client)
    actions = [entry["action"] for entry in entries]
    for expected in ("save_document", "add_section", "update_section", "delete_section", "export_document"):
        assert expected in actions, expected
    saved = _by_action(entries, "save_document")[0]
    assert saved["entity_type"] == "document" and saved["entity_id"] == document["document_id"]
    assert saved["detail"]["project_id"] == project_id
    assert "(project Docs)" in saved["summary"]
    assert secret_text not in json.dumps(entries)
    assert _by_action(entries, "delete_section")[0]["entity_id"] == section["template_id"]
    assert _by_action(entries, "export_document")[0]["detail"]["query"] == "format=md"


def test_reading_and_refused_requests_are_not_recorded(client):
    writer = login(client, "Write")
    reader = login(client, "Read")
    client.get("/api/projects", headers=auth(writer))
    assert client.post("/api/projects", json={"project_name": "No"}, headers=auth(reader)).status_code == 403
    assert client.post("/api/projects", json={"project_name": " "}, headers=auth(writer)).status_code == 400
    actions = {entry["action"] for entry in _log(client)}
    assert "create_project" not in actions and "list_projects" not in actions


def test_secrets_never_reach_the_log(client):
    admin = login(client, "Admin")
    password = "Sup3r-Secret-Pass!"
    created = client.post(
        "/api/users", json={"login_id": "newbie", "username": "Newbie", "password": password, "role_name": "Read"}, headers=auth(admin)
    )
    assert created.status_code == 200, created.text
    provider = client.put("/api/settings/providers/gemini", json={"api_key": "sk-very-secret-key", "chat_model": "gem-x"}, headers=auth(admin))
    assert provider.status_code == 200, provider.text
    client.post("/api/auth/login", json={"login_id": "newbie", "password": password})
    client.post("/api/auth/login", json={"login_id": "newbie", "password": "wrong-password-1"})
    text = json.dumps(_log(client))
    for secret in (password, "sk-very-secret-key", "wrong-password-1"):
        assert secret not in text
    user_entry = _by_action(_log(client), "create_user")[0]
    assert user_entry["detail"]["request"]["password"] == "***"
    assert user_entry["entity_type"] == "user" and user_entry["entity_id"] == created.json()["user_id"]
    assert "Newbie" in user_entry["summary"] or "newbie" in user_entry["summary"]
    assert _by_action(_log(client), "put_provider")


def test_sign_ins_and_failed_sign_ins_are_recorded(client):
    login(client, "Write")
    bad = client.post("/api/auth/login", json={"login_id": "writer", "password": "nope-nope-nope"})
    assert bad.status_code == 401
    unknown = client.post("/api/auth/login", json={"login_id": "ghost", "password": "nope-nope-nope"})
    assert unknown.status_code == 401
    entries = _log(client)
    (ok,) = [entry for entry in _by_action(entries, "login") if entry["login_id"] == "writer"]
    assert ok["login_id"] == "writer" and ok["role_name"] == "Write" and ok["summary"] == "Signed in"
    failed = _by_action(entries, "login_failed")
    assert {entry["login_id"] for entry in failed} == {"writer", "ghost"}
    assert all(entry["user_id"] is None for entry in failed)


def test_uploads_record_the_file_name(client):
    writer = login(client, "Write")
    project_id = client.post("/api/projects", json={"project_name": "Up"}, headers=auth(writer)).json()["project_id"]
    ref = {"file": ("settlement-notes.md", b"Reference text about settlement.", "text/markdown")}
    assert client.post(f"/api/projects/{project_id}/references", files=ref, headers=auth(writer)).status_code == 200
    entry = _by_action(_log(client), "upload_reference")[0]
    assert entry["detail"]["request"]["file"] == "settlement-notes.md"
    assert "settlement-notes.md" in entry["summary"]


def test_admin_changes_are_recorded(client):
    admin = login(client, "Admin")
    client.post("/api/systems", json={"system_code": "SPL", "system_name": "Front door"}, headers=auth(admin))
    client.patch("/api/systems/SPL", json={"description": "d"}, headers=auth(admin))
    client.delete("/api/systems/SPL", headers=auth(admin))
    client.post("/api/layouts", json={"name": "Runbook"}, headers=auth(admin))
    entries = _log(client)
    assert {"create_system", "update_system", "delete_system", "create_layout"} <= {entry["action"] for entry in entries}
    deleted = _by_action(entries, "delete_system")[0]
    assert deleted["entity_type"] == "system" and deleted["entity_id"] == "SPL" and deleted["login_id"] == "admin"


def test_only_admin_can_read_the_log(client):
    for role in ("Write", "Read"):
        token = login(client, role)
        assert client.get("/api/audit", headers=auth(token)).status_code == 403
        assert client.get("/api/audit/actions", headers=auth(token)).status_code == 403
    assert client.get("/api/audit").status_code == 401


def test_the_log_is_newest_first_and_can_be_filtered(client):
    writer = login(client, "Write")
    admin = login(client, "Admin")
    client.post("/api/projects", json={"project_name": "One"}, headers=auth(writer))
    client.post("/api/systems", json={"system_code": "SPL", "system_name": "S"}, headers=auth(admin))
    client.post("/api/projects", json={"project_name": "Two"}, headers=auth(writer))

    everything = _log(client)
    stamps = [entry["occurred_at"] for entry in everything]
    assert stamps == sorted(stamps, reverse=True)
    assert [entry["login_id"] for entry in _log(client, user="writer") if entry["action"] == "create_project"] == ["writer", "writer"]
    assert {entry["login_id"] for entry in _log(client, user="ADMIN")} == {"admin"}
    assert {entry["action"] for entry in _log(client, action="create_system")} == {"create_system"}
    assert {entry["entity_type"] for entry in _log(client, entity_type="project")} == {"project"}
    assert len(_log(client, limit=2)) == 2

    today = everything[0]["occurred_at"][:10]
    assert _log(client, since=today, until=today)
    assert _log(client, since="2999-01-01") == []
    assert _log(client, until="2000-01-01") == []
    admin_token = auth(admin)
    assert client.get("/api/audit?since=yesterday", headers=admin_token).status_code == 400
    assert {"create_project", "create_system", "login"} <= set(client.get("/api/audit/actions", headers=admin_token).json())


def test_a_failing_log_never_breaks_the_request(client, monkeypatch):
    from app import db

    real = db.exec_sql

    def broken(sql, params=None):
        if "audit_log" in sql:
            raise RuntimeError("disk full")
        return real(sql, params)

    monkeypatch.setattr(db, "exec_sql", broken)
    writer = login(client, "Write")
    assert client.post("/api/projects", json={"project_name": "Still works"}, headers=auth(writer)).status_code == 200
