import json

from app import db
from tests.conftest import auth, login

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _project(client, token, name="Docs"):
    return client.post("/api/projects", json={"project_name": name}, headers=auth(token)).json()["project_id"]


def _with_intro_header():
    """Give the Interface layout's Introduction a header block again, for tests about header behaviour."""
    db.exec_sql(
        "UPDATE layout_templates SET schema_json = ?, content_kind = 'prose' WHERE template_id = 'interface-spec--introduction'",
        [json.dumps({"blocks": [{"type": "header", "text": "Introduction", "level": 1}, {"type": "prose"}]})],
    )


def _add_interface(client, token, project_id):
    response = client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "interface-spec"}, headers=auth(token))
    assert response.status_code == 200, response.text
    return response.json()


def test_new_project_has_an_sdd_and_can_add_an_interface_document(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    listed = client.get(f"/api/projects/{project_id}/documents", headers=auth(writer)).json()
    assert [item["layout_id"] for item in listed] == ["sdd"]
    created = _add_interface(client, writer, project_id)
    assert created["name"] == "Interface Specifications Document"
    assert any(item["section_name"] == "Message Format" for item in created["templates"])
    assert "interface-spec--message-format" in created["content_json"]["sections"]
    duplicate = client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "fmea"}, headers=auth(writer))
    assert duplicate.status_code == 200
    again = client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "fmea"}, headers=auth(writer))
    assert again.status_code == 400  # FMEA is one per project
    assert "already has that document" in again.text
    unknown = client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "nope"}, headers=auth(writer))
    assert unknown.status_code == 404
    reader = login(client, "Read")
    assert client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "interface-spec"}, headers=auth(reader)).status_code == 403


def test_cannot_add_a_document_for_an_empty_layout(client):
    admin = auth(login(client, "Admin"))
    client.post("/api/layouts", json={"name": "Empty"}, headers=admin)
    writer = login(client, "Write")
    project_id = _project(client, writer)
    response = client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "empty"}, headers=auth(writer))
    assert response.status_code == 400


def test_workspace_lists_documents_layouts_and_legacy_keys(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    interface = _add_interface(client, writer, project_id)
    workspace = client.get(f"/api/projects/{project_id}/workspace", headers=auth(writer)).json()
    assert [item["layout_id"] for item in workspace["documents"]] == ["sdd", "interface-spec"]
    assert workspace["documents"][1]["document_id"] == interface["document_id"]
    assert {item["layout_id"] for item in workspace["layouts"]} >= {"sdd", "interface-spec"}
    assert workspace["sdd"]["layout_id"] == "sdd"
    assert workspace["templates"] == workspace["documents"][0]["templates"]
    assert "references" in workspace


def test_delete_document_keeps_at_least_one(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    interface = _add_interface(client, writer, project_id)
    base = f"/api/projects/{project_id}/documents"
    assert client.delete(f"{base}/{interface['document_id']}", headers=auth(login(client, "Read"))).status_code == 403
    assert client.delete(f"{base}/{interface['document_id']}", headers=auth(writer)).status_code == 200
    only = client.get(base, headers=auth(writer)).json()
    assert len(only) == 1
    assert client.delete(f"{base}/{only[0]['document_id']}", headers=auth(writer)).status_code == 400
    assert client.get(f"{base}/{interface['document_id']}", headers=auth(writer)).status_code == 404


def test_save_is_scoped_to_the_document_and_sanitised(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    interface = _add_interface(client, writer, project_id)
    url = f"/api/projects/{project_id}/documents/{interface['document_id']}"
    sections = interface["content_json"]["sections"]
    sections["interface-spec--purpose"]["blocks"][0]["markdown"] = "Why this exists"
    summary = sections["interface-spec--interface-summary"]["blocks"][0]
    summary["rows"] = [["IF-1", "Payments", "Core", "SWIFT", "MQ", "Daily", "extra cell"]]
    context = sections["interface-spec--context-diagram"]["blocks"]
    image = next(block for block in context if block["type"] == "image")
    image["url"] = "https://evil.example/x.png"
    image["caption"] = "My context"
    saved = client.put(url, json={"content_json": {"sections": sections}}, headers=auth(writer))
    assert saved.status_code == 200, saved.text
    content = saved.json()["content_json"]["sections"]
    assert content["interface-spec--purpose"]["blocks"][0]["markdown"] == "Why this exists"
    assert len(content["interface-spec--interface-summary"]["blocks"][0]["rows"][0]) == 6
    stored_image = next(block for block in content["interface-spec--context-diagram"]["blocks"] if block["type"] == "image")
    assert stored_image["url"] == ""
    assert stored_image["caption"] == "My context"
    sdd = client.get(f"/api/projects/{project_id}/sdd", headers=auth(writer)).json()
    assert "interface-spec--purpose" not in sdd["content_json"]["sections"]
    viewer = login(client, "Read")
    assert client.put(url, json={"content_json": {}}, headers=auth(viewer)).status_code == 403




def test_layout_changes_are_not_applied_to_existing_documents(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    interface = _add_interface(client, writer, project_id)
    admin = auth(login(client, "Admin"))
    added = client.post(
        "/api/layouts/interface-spec/templates",
        json={"section_name": "Appendix", "blocks": [{"type": "prose"}]},
        headers=admin,
    ).json()
    client.delete("/api/templates/interface-spec--security", headers=admin)
    fetched = client.get(f"/api/projects/{project_id}/documents/{interface['document_id']}", headers=auth(writer)).json()
    sections = fetched["content_json"]["sections"]
    assert added["template_id"] not in sections
    assert "interface-spec--security" in sections
    assert not any(item["template_id"] == added["template_id"] for item in fetched["templates"])
    assert any(item["template_id"] == "interface-spec--security" for item in fetched["templates"])


def test_layout_in_use_cannot_be_deleted(client):
    admin = auth(login(client, "Admin"))
    client.post("/api/layouts", json={"name": "Runbook"}, headers=admin)
    client.post("/api/layouts/runbook/templates", json={"section_name": "Intro"}, headers=admin)
    writer = login(client, "Write")
    project_id = _project(client, writer)
    client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "runbook"}, headers=auth(writer))
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
    writer = login(client, "Write")
    project_id = _project(client, writer)
    _with_intro_header()
    interface = _add_interface(client, writer, project_id)
    base = f"/api/projects/{project_id}/documents/{interface['document_id']}"
    sections = interface["content_json"]["sections"]
    sections["interface-spec--introduction"]["blocks"][0]["text"] = "Custom heading"
    client.put(base, json={"content_json": {"sections": sections}}, headers=auth(writer))

    response = client.post(f"{base}/sections/interface-spec--introduction/regenerate", headers=auth(writer))
    assert response.status_code == 200, response.text
    system, user = prompts[-1]
    assert "Interface Specifications Document" in system
    assert '"type": "header"' not in user  # the model never writes header or image blocks
    blocks = response.json()["content_json"]["sections"]["interface-spec--introduction"]["blocks"]
    assert blocks[0] == {"type": "header", "text": "Custom heading", "level": 1}
    assert blocks[1]["markdown"] == "Generated text"
    assert client.post(f"{base}/sections/key-non-functional-requirements/regenerate", headers=auth(writer)).status_code == 404

    with client.stream("POST", f"{base}/generate", headers=auth(writer)) as stream:
        body = stream.read().decode()
    assert "interface-spec--purpose" in body
    assert "key-non-functional-requirements" not in body
    assert '"event": "complete"' in body
    sdd = client.get(f"/api/projects/{project_id}/sdd", headers=auth(writer)).json()
    assert sdd["generated_at"] is None  # the SDD was not touched


def test_export_renders_headers_and_inlines_images(client):
    writer = login(client, "Write")
    project_id = _project(client, writer, "Exports")
    _with_intro_header()
    interface = _add_interface(client, writer, project_id)
    upload = client.post(f"/api/projects/{project_id}/images", files={"file": ("ctx.png", PNG, "image/png")}, headers=auth(writer))
    assert upload.status_code == 200, upload.text
    url = upload.json()["url"]
    base = f"/api/projects/{project_id}/documents/{interface['document_id']}"
    sections = interface["content_json"]["sections"]
    sections["interface-spec--introduction"]["blocks"][0]["text"] = "Welcome"
    for block in sections["interface-spec--context-diagram"]["blocks"]:
        if block["type"] == "image":
            block["url"] = url
    saved = client.put(base, json={"content_json": {"sections": sections}}, headers=auth(writer))
    stored = next(b for b in saved.json()["content_json"]["sections"]["interface-spec--context-diagram"]["blocks"] if b["type"] == "image")
    assert stored["url"] == url
    markdown = client.get(f"{base}/export?format=md", headers=auth(writer))
    assert markdown.text.startswith("# Exports - Interface Specifications Document")
    assert "#### Welcome" in markdown.text
    assert "![Interface context](data:image/png;base64," in markdown.text
    saved_doc = client.get(base, headers=auth(writer)).json()
    from app.services import export

    page = export.render_html("Exports - Interface Specifications Document", saved_doc["templates"], saved_doc["content_json"])
    assert "<h4>Welcome</h4>" in page and "<figure><img src=\"data:image/png;base64," in page
    assert client.get(f"{base}/export?format=html", headers=auth(writer)).status_code == 400
    legacy = client.get(f"/api/projects/{project_id}/export?format=md", headers=auth(writer)).text
    assert legacy.startswith("# Exports\n")


def test_image_upload_rules(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    url = f"/api/projects/{project_id}/images"
    bad = client.post(url, files={"file": ("x.png", b"not an image", "image/png")}, headers=auth(writer))
    assert bad.status_code == 400
    svg = client.post(url, files={"file": ("x.svg", b"<svg onload=alert(1)>", "image/svg+xml")}, headers=auth(writer))
    assert svg.status_code == 400
    for role in ("Read",):
        denied = client.post(url, files={"file": ("x.png", PNG, "image/png")}, headers=auth(login(client, role)))
        assert denied.status_code == 403
    good = client.post(url, files={"file": ("x.png", PNG, "image/png")}, headers=auth(writer)).json()["url"]
    assert client.get(good).status_code == 401
    fetched = client.get(good, headers=auth(login(client, "Read")))
    assert fetched.status_code == 200 and fetched.headers["content-type"] == "image/png" and fetched.content == PNG
    assert client.get(f"{url}/..%2Fsecret.png", headers=auth(writer)).status_code == 404
    assert client.get(f"{url}/missing.png", headers=auth(writer)).status_code == 404


def test_legacy_generated_sdds_rows_are_migrated_once(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
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
    writer = login(client, "Write")
    project_id = _project(client, writer)
    _add_interface(client, writer, project_id)
    client.post(f"/api/projects/{project_id}/images", files={"file": ("x.png", PNG, "image/png")}, headers=auth(writer))
    assert client.delete(f"/api/projects/{project_id}", headers=auth(writer)).status_code == 200
    assert db.fetchone("SELECT count(*) AS c FROM project_documents")["c"] == 0
    from app.services import images

    assert not images._folder(project_id).exists()


def test_interface_documents_can_be_added_several_times_with_distinct_names(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    url = f"/api/projects/{project_id}/documents"
    first = _add_interface(client, writer, project_id)
    assert first["name"] == "Interface Specifications Document"
    second = client.post(url, json={"layout_id": "interface-spec"}, headers=auth(writer)).json()
    assert second["name"] == "Interface Specifications Document 2"  # unnamed copies are numbered
    named = client.post(url, json={"layout_id": "interface-spec", "title": "  Payments   interfaces "}, headers=auth(writer)).json()
    assert named["name"] == "Payments interfaces"
    assert named["layout_name"] == "Interface Specifications Document"
    clash = client.post(url, json={"layout_id": "interface-spec", "title": "payments INTERFACES"}, headers=auth(writer))
    assert clash.status_code == 400
    listed = client.get(url, headers=auth(writer)).json()
    assert [item["name"] for item in listed] == [
        "Solution Design Document",
        "Interface Specifications Document",
        "Interface Specifications Document 2",
        "Payments interfaces",
    ]
    assert len({item["document_id"] for item in listed}) == 4
    # each copy keeps its own content
    sections = second["content_json"]["sections"]
    sections["interface-spec--purpose"]["blocks"][0]["markdown"] = "Only in copy 2"
    client.put(f"{url}/{second['document_id']}", json={"content_json": {"sections": sections}}, headers=auth(writer))
    reloaded = {item["document_id"]: item for item in client.get(url, headers=auth(writer)).json()}
    assert reloaded[first["document_id"]]["content_json"]["sections"]["interface-spec--purpose"]["blocks"][0]["markdown"] == ""


def test_allow_multiple_is_a_layout_setting(client):
    admin = auth(login(client, "Admin"))
    writer = login(client, "Write")
    layouts = {item["layout_id"]: item for item in client.get("/api/layouts", headers=admin).json()}
    assert layouts["interface-spec"]["allow_multiple"] is True
    assert layouts["fmea"]["allow_multiple"] is False
    assert layouts["sdd"]["allow_multiple"] is False
    assert client.put("/api/layouts/sdd", json={"allow_multiple": True}, headers=admin).status_code == 400

    turned_on = client.put("/api/layouts/fmea", json={"allow_multiple": True}, headers=admin)
    assert turned_on.status_code == 200 and turned_on.json()["allow_multiple"] is True
    project_id = _project(client, writer)
    for _ in range(2):
        assert client.post(f"/api/projects/{project_id}/documents", json={"layout_id": "fmea"}, headers=auth(writer)).status_code == 200
    blocked = client.put("/api/layouts/fmea", json={"allow_multiple": False}, headers=admin)
    assert blocked.status_code == 400 and "more than one" in blocked.text

    created = client.post("/api/layouts", json={"name": "Runbook", "allow_multiple": True}, headers=admin).json()
    assert created["allow_multiple"] is True


def test_old_databases_lose_the_one_document_per_layout_constraint(tmp_path, monkeypatch):
    import duckdb

    path = tmp_path / "solutioncrafter.duckdb"
    old = duckdb.connect(str(path))
    old.execute(
        """
        CREATE TABLE project_documents (
            document_id VARCHAR PRIMARY KEY, project_id VARCHAR NOT NULL, layout_id VARCHAR NOT NULL,
            content_json VARCHAR NOT NULL, status VARCHAR NOT NULL, last_modified TIMESTAMP NOT NULL,
            generated_at TIMESTAMP, submitted_by VARCHAR, approved_by VARCHAR, approved_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL, structure_json VARCHAR, UNIQUE (project_id, layout_id)
        )
        """
    )
    old.execute(
        "INSERT INTO project_documents VALUES ('d1', 'p1', 'interface-spec', '{}', 'draft', now(), NULL, NULL, NULL, NULL, now(), '[]')"
    )
    old.close()
    monkeypatch.setattr(db, "_conn", duckdb.connect(str(path)))
    db._migrate()
    db._ensure_project_description()
    db._ensure_columns()
    conn = db._conn
    assert conn.execute(
        "SELECT count(*) FROM duckdb_constraints() WHERE table_name = 'project_documents' AND constraint_type = 'UNIQUE'"
    ).fetchone()[0] == 0
    assert conn.execute("SELECT document_id, title FROM project_documents").fetchall() == [("d1", "")]
    conn.execute(
        "INSERT INTO project_documents (document_id, project_id, layout_id, content_json, status, last_modified, created_at) "
        "VALUES ('d2', 'p1', 'interface-spec', '{}', 'draft', now(), now())"
    )
    conn.close()


def test_test_case_inventory_migration_replaces_sprint_tables(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    document_id = client.get(f"/api/projects/{project_id}/documents", headers=auth(writer)).json()[0]["document_id"]
    old_table = {"type": "table", "columns": ["No", "App Name", "Action", "VAL ID"], "rows": [["1", "SPL", "New", "V1"]]}
    db.exec_sql(
        """
        UPDATE layout_templates
        SET schema_json = ?, hint = ?, system_prompt = ?, content_kind = 'prose'
        WHERE template_id = 'inventory-of-test-cases'
        """,
        [json.dumps({"blocks": [{"type": "prose"}]}), "Group by sprint", "Write sprints"],
    )
    db.insert_template(
        "sdd",
        {
            "template_id": "sprint-1",
            "parent_id": "inventory-of-test-cases",
            "section_name": "Sprint 1",
            "sequence_order": 1401,
            "system_prompt": "Sprint one",
            "temperature": 0.2,
            "max_words": 2000,
            "content_kind": "table",
            "schema_json": {"blocks": [old_table]},
            "hint": "",
        },
    )
    row = db.fetchone("SELECT content_json, structure_json FROM project_documents WHERE document_id = ?", [document_id])
    content = json.loads(row["content_json"])
    content["sections"]["sprint-1"] = {"template_id": "sprint-1", "title": "Sprint 1", "blocks": [old_table], "missing": []}
    structure = json.loads(row["structure_json"])
    structure.append(
        {
            "template_id": "sprint-1",
            "parent_id": "inventory-of-test-cases",
            "section_name": "Sprint 1",
            "schema_json": {"blocks": [old_table]},
            "system_prompt": "Sprint one",
            "hint": "",
            "content_kind": "table",
        }
    )
    db.exec_sql(
        "UPDATE project_documents SET content_json = ?, structure_json = ? WHERE document_id = ?",
        [json.dumps(content), json.dumps(structure), document_id],
    )

    db._migrate_test_case_inventory()

    layout = db.fetchone("SELECT schema_json, system_prompt, hint FROM layout_templates WHERE template_id = 'inventory-of-test-cases'")
    columns = json.loads(layout["schema_json"])["blocks"][0]["columns"]
    assert columns[0] == "SN" and columns[2].startswith("Test Type")
    assert "sprint" not in layout["system_prompt"].lower()
    assert "Progression" in layout["system_prompt"]
    assert db.fetchone("SELECT template_id FROM layout_templates WHERE template_id = 'sprint-1'") is None
    saved = db.fetchone("SELECT content_json, structure_json FROM project_documents WHERE document_id = ?", [document_id])
    saved_content = json.loads(saved["content_json"])
    assert "sprint-1" not in saved_content["sections"]
    assert saved_content["sections"]["inventory-of-test-cases"]["blocks"][0]["columns"] == columns
    saved_structure = json.loads(saved["structure_json"])
    assert all(item["template_id"] != "sprint-1" for item in saved_structure)
    parent = next(item for item in saved_structure if item["template_id"] == "inventory-of-test-cases")
    assert parent["system_prompt"] == layout["system_prompt"]


def test_long_test_type_header_is_shortened_without_clearing_rows(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    document_id = client.get(f"/api/projects/{project_id}/documents", headers=auth(writer)).json()[0]["document_id"]
    long_name = "Test Type (Progression/Regression/Negative testing/Non-functional)"
    columns = ["SN", "Test Case ID", long_name, "Test Case Description", "Acceptance Criteria"]
    row = db.fetchone("SELECT content_json, structure_json FROM project_documents WHERE document_id = ?", [document_id])
    content = json.loads(row["content_json"])
    content["sections"]["inventory-of-test-cases"]["blocks"] = [
        {"type": "table", "columns": columns, "rows": [["1", "TC-1", "Regression", "Checks login", "User is signed in"]]}
    ]
    structure = json.loads(row["structure_json"])
    for entry in structure:
        if entry["template_id"] == "inventory-of-test-cases":
            entry["schema_json"] = {"blocks": [{"type": "table", "columns": columns, "rows": [["1", "", "", "", ""]]}]}
    db.exec_sql(
        "UPDATE layout_templates SET schema_json = ? WHERE template_id = 'inventory-of-test-cases'",
        [json.dumps({"blocks": [{"type": "table", "columns": columns}]})],
    )
    db.exec_sql(
        "UPDATE project_documents SET content_json = ?, structure_json = ? WHERE document_id = ?",
        [json.dumps(content), json.dumps(structure), document_id],
    )

    db._rename_test_type_column()

    layout = json.loads(db.fetchone("SELECT schema_json FROM layout_templates WHERE template_id = 'inventory-of-test-cases'")["schema_json"])
    assert layout["blocks"][0]["columns"][2] == "Test Type"
    saved = json.loads(db.fetchone("SELECT content_json FROM project_documents WHERE document_id = ?", [document_id])["content_json"])
    table = saved["sections"]["inventory-of-test-cases"]["blocks"][0]
    assert table["columns"][2] == "Test Type"
    assert table["rows"][0][2] == "Regression"
