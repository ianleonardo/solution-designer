import json

from app import db
from tests.conftest import auth, login

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _project(client, token, name="Docs"):
    return client.post("/api/projects", json={"project_name": name}, headers=auth(token)).json()["project_id"]


def _add_interface(client, token, project_id):
    response = client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "interface-spec"}, headers=auth(token))
    assert response.status_code == 200, response.text
    return response.json()


def test_new_project_has_an_sdd_and_can_add_an_interface_document(client):
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    listed = client.get(f"/api/projects/{project_id}/documents", headers=auth(maker)).json()
    assert [item["layout_id"] for item in listed] == ["sdd"]
    created = _add_interface(client, maker, project_id)
    assert created["name"] == "Interface Specifications Document"
    assert created["status"] == "draft"
    assert any(item["section_name"] == "Message Format" for item in created["templates"])
    assert "interface-spec--message-format" in created["content_json"]["sections"]
    duplicate = client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "interface-spec"}, headers=auth(maker))
    assert duplicate.status_code == 400
    unknown = client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "nope"}, headers=auth(maker))
    assert unknown.status_code == 404
    viewer = login(client, "Viewer")
    assert client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "interface-spec"}, headers=auth(viewer)).status_code == 403


def test_cannot_add_a_document_for_an_empty_layout(client):
    admin = auth(login(client, "Admin"))
    client.post("/api/layouts", json={"name": "Empty"}, headers=admin)
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    response = client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "empty"}, headers=auth(maker))
    assert response.status_code == 400


def test_workspace_lists_documents_layouts_and_legacy_keys(client):
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    interface = _add_interface(client, maker, project_id)
    workspace = client.get(f"/api/projects/{project_id}/workspace", headers=auth(maker)).json()
    assert [item["layout_id"] for item in workspace["documents"]] == ["sdd", "interface-spec"]
    assert workspace["documents"][1]["document_id"] == interface["document_id"]
    assert {item["layout_id"] for item in workspace["layouts"]} >= {"sdd", "interface-spec"}
    assert workspace["sdd"]["layout_id"] == "sdd"
    assert workspace["templates"] == workspace["documents"][0]["templates"]
    assert "references" in workspace


def test_delete_document_keeps_at_least_one(client):
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    interface = _add_interface(client, maker, project_id)
    base = f"/api/projects/{project_id}/documents"
    assert client.delete(f"{base}/{interface['document_id']}", headers=auth(login(client, "Viewer"))).status_code == 403
    assert client.delete(f"{base}/{interface['document_id']}", headers=auth(maker)).status_code == 200
    only = client.get(base, headers=auth(maker)).json()
    assert len(only) == 1
    assert client.delete(f"{base}/{only[0]['document_id']}", headers=auth(maker)).status_code == 400
    assert client.get(f"{base}/{interface['document_id']}", headers=auth(maker)).status_code == 404


def test_save_is_scoped_to_the_document_and_sanitised(client):
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    interface = _add_interface(client, maker, project_id)
    url = f"/api/projects/{project_id}/documents/{interface['document_id']}"
    sections = interface["content_json"]["sections"]
    sections["interface-spec--purpose"]["blocks"][0]["markdown"] = "Why this exists"
    summary = sections["interface-spec--interface-summary"]["blocks"][0]
    summary["rows"] = [["IF-1", "Payments", "Core", "SWIFT", "MQ", "Daily", "extra cell"]]
    context = sections["interface-spec--context-diagram"]["blocks"]
    image = next(block for block in context if block["type"] == "image")
    image["url"] = "https://evil.example/x.png"
    image["caption"] = "My context"
    saved = client.put(url, json={"content_json": {"sections": sections}}, headers=auth(maker))
    assert saved.status_code == 200, saved.text
    content = saved.json()["content_json"]["sections"]
    assert content["interface-spec--purpose"]["blocks"][0]["markdown"] == "Why this exists"
    assert len(content["interface-spec--interface-summary"]["blocks"][0]["rows"][0]) == 6
    stored_image = next(block for block in content["interface-spec--context-diagram"]["blocks"] if block["type"] == "image")
    assert stored_image["url"] == ""
    assert stored_image["caption"] == "My context"
    sdd = client.get(f"/api/projects/{project_id}/sdd", headers=auth(maker)).json()
    assert "interface-spec--purpose" not in sdd["content_json"]["sections"]
    admin = login(client, "Admin")
    assert client.put(url, json={"content_json": {}}, headers=auth(admin)).status_code == 403


def test_workflow_is_per_document_and_project_status_aggregates(client):
    maker = login(client, "Maker")
    checker = login(client, "Checker")
    project_id = _project(client, maker)
    interface = _add_interface(client, maker, project_id)
    base = f"/api/projects/{project_id}"
    sdd_id = client.get(f"{base}/documents", headers=auth(maker)).json()[0]["document_id"]

    submitted = client.post(f"{base}/documents/{interface['document_id']}/submit", headers=auth(maker))
    assert submitted.json()["status"] == "pending_approval"
    docs = {item["layout_id"]: item["status"] for item in client.get(f"{base}/documents", headers=auth(maker)).json()}
    assert docs == {"sdd": "draft", "interface-spec": "pending_approval"}
    project = client.get(f"{base}/workspace", headers=auth(maker)).json()["project"]
    assert project["status"] == "pending_approval"

    assert client.post(f"{base}/documents/{interface['document_id']}/approve", headers=auth(maker)).status_code == 403
    assert client.post(f"{base}/documents/{sdd_id}/approve", headers=auth(checker)).status_code == 400
    approved = client.post(f"{base}/documents/{interface['document_id']}/approve", headers=auth(checker))
    assert approved.json()["status"] == "approved"
    assert client.get(f"{base}/workspace", headers=auth(maker)).json()["project"]["status"] == "draft"

    client.post(f"{base}/documents/{sdd_id}/submit", headers=auth(maker))
    client.post(f"{base}/documents/{sdd_id}/approve", headers=auth(checker))
    assert client.get(f"{base}/workspace", headers=auth(maker)).json()["project"]["status"] == "approved"

    # A maker edit sends only that document back to draft.
    saved = client.put(f"{base}/documents/{interface['document_id']}", json={"content_json": approved.json()["content_json"]}, headers=auth(maker))
    assert saved.json()["status"] == "draft"
    statuses = {item["layout_id"]: item["status"] for item in client.get(f"{base}/documents", headers=auth(maker)).json()}
    assert statuses == {"sdd": "approved", "interface-spec": "draft"}


def test_layout_changes_are_not_applied_to_existing_documents(client):
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    interface = _add_interface(client, maker, project_id)
    admin = auth(login(client, "Admin"))
    added = client.post(
        "/api/layouts/interface-spec/templates",
        json={"section_name": "Appendix", "blocks": [{"type": "prose"}]},
        headers=admin,
    ).json()
    client.delete("/api/templates/interface-spec--security", headers=admin)
    fetched = client.get(f"/api/projects/{project_id}/documents/{interface['document_id']}", headers=auth(maker)).json()
    sections = fetched["content_json"]["sections"]
    assert added["template_id"] not in sections
    assert "interface-spec--security" in sections
    assert not any(item["template_id"] == added["template_id"] for item in fetched["templates"])
    assert any(item["template_id"] == "interface-spec--security" for item in fetched["templates"])


def test_layout_in_use_cannot_be_deleted(client):
    admin = auth(login(client, "Admin"))
    client.post("/api/layouts", json={"name": "Runbook"}, headers=admin)
    client.post("/api/layouts/runbook/templates", json={"section_name": "Intro"}, headers=admin)
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "runbook"}, headers=auth(maker))
    blocked = client.delete("/api/layouts/runbook", headers=admin)
    assert blocked.status_code == 400
    assert "1 project document" in blocked.json()["detail"]


def test_generation_for_a_document_uses_its_layout_and_keeps_static_blocks(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    prompts = []

    def fake_complete(system, user, temperature):
        prompts.append((system, user))
        return json.dumps({"blocks": [{"type": "prose", "markdown": "Generated text"}]})

    monkeypatch.setattr("app.services.llm.complete", fake_complete)
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    interface = _add_interface(client, maker, project_id)
    base = f"/api/projects/{project_id}/documents/{interface['document_id']}"
    sections = interface["content_json"]["sections"]
    sections["interface-spec--introduction"]["blocks"][0]["text"] = "Custom heading"
    client.put(base, json={"content_json": {"sections": sections}}, headers=auth(maker))

    response = client.post(f"{base}/sections/interface-spec--introduction/regenerate", headers=auth(maker))
    assert response.status_code == 200, response.text
    system, user = prompts[-1]
    assert "Interface Specifications Document" in system
    assert '"type": "header"' not in user  # the model never writes header or image blocks
    blocks = response.json()["content_json"]["sections"]["interface-spec--introduction"]["blocks"]
    assert blocks[0] == {"type": "header", "text": "Custom heading", "level": 1}
    assert blocks[1]["markdown"] == "Generated text"
    assert client.post(f"{base}/sections/key-non-functional-requirements/regenerate", headers=auth(maker)).status_code == 404

    with client.stream("POST", f"{base}/generate", headers=auth(maker)) as stream:
        body = stream.read().decode()
    assert "interface-spec--purpose" in body
    assert "key-non-functional-requirements" not in body
    assert '"event": "complete"' in body
    sdd = client.get(f"/api/projects/{project_id}/sdd", headers=auth(maker)).json()
    assert sdd["generated_at"] is None  # the SDD was not touched


def test_export_renders_headers_and_inlines_images(client):
    maker = login(client, "Maker")
    project_id = _project(client, maker, "Exports")
    interface = _add_interface(client, maker, project_id)
    upload = client.post(f"/api/projects/{project_id}/images", files={"file": ("ctx.png", PNG, "image/png")}, headers=auth(maker))
    assert upload.status_code == 200, upload.text
    url = upload.json()["url"]
    base = f"/api/projects/{project_id}/documents/{interface['document_id']}"
    sections = interface["content_json"]["sections"]
    sections["interface-spec--introduction"]["blocks"][0]["text"] = "Welcome"
    for block in sections["interface-spec--context-diagram"]["blocks"]:
        if block["type"] == "image":
            block["url"] = url
    saved = client.put(base, json={"content_json": {"sections": sections}}, headers=auth(maker))
    stored = next(b for b in saved.json()["content_json"]["sections"]["interface-spec--context-diagram"]["blocks"] if b["type"] == "image")
    assert stored["url"] == url
    markdown = client.get(f"{base}/export?format=md", headers=auth(maker))
    assert markdown.text.startswith("# Exports - Interface Specifications Document")
    assert "#### Welcome" in markdown.text
    assert "![Interface context](data:image/png;base64," in markdown.text
    html = client.get(f"{base}/export?format=html", headers=auth(maker)).text
    assert "<h4>Welcome</h4>" in html and "<figure><img src=\"data:image/png;base64," in html
    legacy = client.get(f"/api/projects/{project_id}/export?format=md", headers=auth(maker)).text
    assert legacy.startswith("# Exports\n")


def test_image_upload_rules(client):
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    url = f"/api/projects/{project_id}/images"
    bad = client.post(url, files={"file": ("x.png", b"not an image", "image/png")}, headers=auth(maker))
    assert bad.status_code == 400
    svg = client.post(url, files={"file": ("x.svg", b"<svg onload=alert(1)>", "image/svg+xml")}, headers=auth(maker))
    assert svg.status_code == 400
    for role in ("Viewer", "Admin"):
        denied = client.post(url, files={"file": ("x.png", PNG, "image/png")}, headers=auth(login(client, role)))
        assert denied.status_code == 403
    good = client.post(url, files={"file": ("x.png", PNG, "image/png")}, headers=auth(maker)).json()["url"]
    assert client.get(good).status_code == 401
    fetched = client.get(good, headers=auth(login(client, "Viewer")))
    assert fetched.status_code == 200 and fetched.headers["content-type"] == "image/png" and fetched.content == PNG
    assert client.get(f"{url}/..%2Fsecret.png", headers=auth(maker)).status_code == 404
    assert client.get(f"{url}/missing.png", headers=auth(maker)).status_code == 404


def test_legacy_generated_sdds_rows_are_migrated_once(client):
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    original = db.fetchone("SELECT * FROM project_documents WHERE project_id = ?", [project_id])
    db.exec_sql("DELETE FROM project_documents WHERE project_id = ?", [project_id])
    db.exec_sql(
        """
        INSERT INTO generated_sdds (sdd_id, project_id, content_json, status, last_modified)
        VALUES ('legacy-sdd', ?, ?, 'approved', CURRENT_TIMESTAMP)
        """,
        [project_id, original["content_json"]],
    )
    db._migrate_documents()
    moved = db.fetchone("SELECT * FROM project_documents WHERE project_id = ?", [project_id])
    assert moved["document_id"] == "legacy-sdd"
    assert moved["layout_id"] == "sdd" and moved["status"] == "approved"
    assert db.fetchone("SELECT count(*) AS c FROM generated_sdds")["c"] == 0
    # A document removed on purpose is not resurrected by a restart.
    db.exec_sql("DELETE FROM project_documents WHERE project_id = ?", [project_id])
    db._migrate_documents()
    assert db.fetchone("SELECT count(*) AS c FROM project_documents WHERE project_id = ?", [project_id])["c"] == 0


def test_deleting_a_project_removes_documents_and_images(client):
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    _add_interface(client, maker, project_id)
    client.post(f"/api/projects/{project_id}/images", files={"file": ("x.png", PNG, "image/png")}, headers=auth(maker))
    assert client.delete(f"/api/projects/{project_id}", headers=auth(maker)).status_code == 200
    assert db.fetchone("SELECT count(*) AS c FROM project_documents")["c"] == 0
    from app.services import images

    assert not images._folder(project_id).exists()
