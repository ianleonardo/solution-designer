import pytest
from tests.conftest import auth, login


def test_reader_cannot_create_and_project_has_one_document_per_layout(client):
    reader = login(client, "Read")
    denied = client.post("/api/projects", json={"project_name": "Hidden"}, headers=auth(reader))
    assert denied.status_code == 403

    writer = login(client, "Write")
    created = client.post("/api/projects", json={"project_name": "Trade Settlement"}, headers=auth(writer))
    assert created.status_code == 200, created.text
    project_id = created.json()["project_id"]

    from app import db

    rows = db.fetchall("SELECT document_id FROM project_documents WHERE project_id = ?", [project_id])
    assert len(rows) == 1
    with pytest.raises(Exception):
        db.exec_sql(
            """
            INSERT INTO project_documents (document_id, project_id, layout_id, content_json, status, last_modified, created_at)
            VALUES ('second', ?, 'sdd', '{}', 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            [project_id],
        )
    rows = db.fetchall("SELECT document_id FROM project_documents WHERE project_id = ?", [project_id])
    assert len(rows) == 1




def test_admin_cannot_create_edit_or_delete_projects_or_their_documents(client):
    writer = login(client, "Write")
    project_id = client.post("/api/projects", json={"project_name": "Owned"}, headers=auth(writer)).json()["project_id"]
    document = client.get(f"/api/projects/{project_id}/documents", headers=auth(writer)).json()[0]
    for role in ("Admin", "Read"):
        token = auth(login(client, role))
        assert client.post("/api/projects", json={"project_name": "Nope"}, headers=token).status_code == 403
        assert client.patch(f"/api/projects/{project_id}", json={"project_name": "Renamed"}, headers=token).status_code == 403
        assert client.delete(f"/api/projects/{project_id}", headers=token).status_code == 403
        assert client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "interface-spec"}, headers=token).status_code == 403
        assert client.delete(f"/api/projects/{project_id}/documents/{document['document_id']}", headers=token).status_code == 403
    # Admin can still see the project.
    assert client.get(f"/api/projects/{project_id}", headers=auth(login(client, "Admin"))).status_code == 200


def test_there_is_no_approval_workflow_or_status(client):
    writer = login(client, "Write")
    created = client.post("/api/projects", json={"project_name": "Plain"}, headers=auth(writer)).json()
    project_id = created["project_id"]
    assert "status" not in created
    document = client.get(f"/api/projects/{project_id}/documents", headers=auth(writer)).json()[0]
    assert "status" not in document and "approved_by" not in document and "submitted_by" not in document
    for action in ("submit", "approve"):
        assert client.post(f"/api/projects/{project_id}/{action}", headers=auth(writer)).status_code in {404, 405}
        assert client.post(f"/api/projects/{project_id}/documents/{document['document_id']}/{action}", headers=auth(writer)).status_code in {404, 405}
    assert "pending_approvals" not in client.get("/api/dashboard", headers=auth(writer)).json()


def test_only_admin_analyst_and_viewer_roles_exist(client):
    admin = login(client, "Admin")
    for role in ("Maker", "Checker", "Write", "Read"):
        response = client.post(
            "/api/users", json={"login_id": "someone", "username": "S", "password": "Password123!", "role_name": role}, headers=auth(admin)
        )
        assert response.status_code == 400


def test_legacy_roles_are_migrated_to_analyst_and_viewer(client):
    from app import db

    db.exec_sql("UPDATE users SET role_name = 'Maker' WHERE user_id = 'user-write'")
    db.exec_sql("UPDATE users SET role_name = 'Write' WHERE user_id = 'user-admin'")
    db.exec_sql("UPDATE users SET role_name = 'Read' WHERE user_id = 'user-read'")
    db._migrate_roles()
    roles = {row["user_id"]: row["role_name"] for row in db.fetchall("SELECT user_id, role_name FROM users")}
    assert roles == {"user-write": "Analyst", "user-admin": "Analyst", "user-read": "Viewer"}
