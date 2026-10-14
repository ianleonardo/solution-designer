import pytest
from tests.conftest import auth, login


def test_viewer_cannot_create_and_project_has_one_document_per_layout(client):
    viewer = login(client, "Viewer")
    denied = client.post("/api/projects", json={"project_name": "Hidden"}, headers=auth(viewer))
    assert denied.status_code == 403

    maker = login(client, "Maker")
    created = client.post("/api/projects", json={"project_name": "Trade Settlement"}, headers=auth(maker))
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


def test_approval_returns_to_draft_after_maker_edit(client):
    maker = login(client, "Maker")
    checker = login(client, "Checker")
    created = client.post("/api/projects", json={"project_name": "Cards"}, headers=auth(maker))
    project_id = created.json()["project_id"]
    submitted = client.post(f"/api/projects/{project_id}/submit", headers=auth(maker))
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "pending_approval"
    viewer = login(client, "Viewer")
    denied = client.post(f"/api/projects/{project_id}/approve", headers=auth(viewer))
    assert denied.status_code == 403
    approved = client.post(f"/api/projects/{project_id}/approve", headers=auth(checker))
    assert approved.json()["status"] == "approved"
    workspace = client.get(f"/api/projects/{project_id}/workspace", headers=auth(maker)).json()
    saved = client.put(
        f"/api/projects/{project_id}/sdd",
        json={"content_json": workspace["sdd"]["content_json"]},
        headers=auth(maker),
    )
    assert saved.status_code == 200
    assert saved.json()["status"] == "draft"


def test_admin_cannot_create_edit_or_delete_projects_or_their_documents(client):
    maker = login(client, "Maker")
    project_id = client.post("/api/projects", json={"project_name": "Owned"}, headers=auth(maker)).json()["project_id"]
    document = client.get(f"/api/projects/{project_id}/documents", headers=auth(maker)).json()[0]
    for role in ("Admin", "Viewer"):
        token = auth(login(client, role))
        assert client.post("/api/projects", json={"project_name": "Nope"}, headers=token).status_code == 403
        assert client.patch(f"/api/projects/{project_id}", json={"project_name": "Renamed"}, headers=token).status_code == 403
        assert client.delete(f"/api/projects/{project_id}", headers=token).status_code == 403
        assert client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "interface-spec"}, headers=token).status_code == 403
        assert client.delete(f"/api/projects/{project_id}/documents/{document['document_id']}", headers=token).status_code == 403
        assert client.post(f"/api/projects/{project_id}/approve", headers=token).status_code == 403
    # Admin can still see the project.
    assert client.get(f"/api/projects/{project_id}", headers=auth(login(client, "Admin"))).status_code == 200
