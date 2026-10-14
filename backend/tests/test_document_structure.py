import json

from app import db
from tests.conftest import auth, login


def _project(client, token, name="Structure"):
    return client.post("/api/projects", json={"project_name": name}, headers=auth(token)).json()["project_id"]


def _document(client, token, project_id):
    return client.get(f"/api/projects/{project_id}/documents", headers=auth(token)).json()[0]


def _admin(client):
    return auth(login(client, "Admin"))


def test_layout_edits_do_not_reach_an_existing_document(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    before = client.get(f"/api/projects/{project_id}/documents/{_document(client, writer, project_id)['document_id']}", headers=auth(writer)).json()
    ids_before = [item["template_id"] for item in before["templates"]]
    assert "key-non-functional-requirements" in ids_before

    admin = _admin(client)
    layout = client.get("/api/layouts/sdd", headers=admin).json()
    victim = next(item for item in layout["templates"] if item["template_id"] == "key-non-functional-requirements")
    assert client.delete(f"/api/templates/{victim['template_id']}", headers=admin).status_code == 200
    renamed = next(item for item in layout["templates"] if item["parent_id"] is not None)
    client.put(f"/api/templates/{renamed['template_id']}", json={"section_name": "Renamed in layout", "system_prompt": "changed"}, headers=admin)
    created = client.post("/api/layouts/sdd/templates", json={"section_name": "Brand new"}, headers=admin)
    assert created.status_code == 200

    after = client.get(f"/api/projects/{project_id}/documents/{before['document_id']}", headers=auth(writer)).json()
    assert [item["template_id"] for item in after["templates"]] == ids_before
    assert after["content_json"] == before["content_json"]
    kept = next(item for item in after["templates"] if item["template_id"] == renamed["template_id"])
    assert kept["section_name"] == renamed["section_name"] and kept["system_prompt"] == renamed["system_prompt"]
    assert "key-non-functional-requirements" in after["content_json"]["sections"]

    # A document created later gets the layout as it is then.
    other = client.post("/api/projects", json={"project_name": "Later"}, headers=auth(writer)).json()["project_id"]
    later = _document(client, writer, other)
    detail = client.get(f"/api/projects/{other}/documents/{later['document_id']}", headers=auth(writer)).json()
    later_ids = [item["template_id"] for item in detail["templates"]]
    assert "key-non-functional-requirements" not in later_ids
    assert any(item["section_name"] == "Brand new" for item in detail["templates"])


def test_document_templates_include_block_layout_and_hint(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    document = _document(client, writer, project_id)
    detail = client.get(f"/api/projects/{project_id}/documents/{document['document_id']}", headers=auth(writer)).json()
    assert all(isinstance(item["blocks"], list) and item["blocks"] for item in detail["templates"])
    assert all("hint" in item for item in detail["templates"])


def test_documents_without_a_snapshot_are_given_one(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    document = _document(client, writer, project_id)
    db.exec_sql("UPDATE project_documents SET structure_json = NULL WHERE document_id = ?", [document["document_id"]])
    db._backfill_structures()
    row = db.fetchone("SELECT structure_json FROM project_documents WHERE document_id = ?", [document["document_id"]])
    snapshot = json.loads(row["structure_json"])
    assert len(snapshot) == len(db.layout_snapshot("sdd"))

    # A row that slips through (for example inserted by hand) is repaired when it is read.
    db.exec_sql("UPDATE project_documents SET structure_json = NULL WHERE document_id = ?", [document["document_id"]])
    detail = client.get(f"/api/projects/{project_id}/documents/{document['document_id']}", headers=auth(writer)).json()
    assert len(detail["templates"]) == len(snapshot)
    assert db.fetchone("SELECT structure_json FROM project_documents WHERE document_id = ?", [document["document_id"]])["structure_json"]


def _setup(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    document = _document(client, writer, project_id)
    base = f"/api/projects/{project_id}/documents/{document['document_id']}"
    return writer, base, document


def _templates(client, token, base):
    return client.get(base, headers=auth(token)).json()["templates"]


def test_add_rename_and_delete_sections(client):
    writer, base, _ = _setup(client)
    count = len(_templates(client, writer, base))
    parent = next(item for item in _templates(client, writer, base) if item["parent_id"] is None)

    added = client.post(
        f"{base}/sections",
        json={"section_name": "Security notes", "parent_id": parent["template_id"], "blocks": [{"type": "header", "text": "Heads up", "level": 2}, {"type": "prose"}]},
        headers=auth(writer),
    )
    assert added.status_code == 200, added.text
    body = added.json()
    new = next(item for item in body["templates"] if item["section_name"] == "Security notes")
    assert new["template_id"].startswith("s-") and new["parent_id"] == parent["template_id"]
    assert new["system_prompt"] and [block["type"] for block in new["blocks"]] == ["header", "prose"]
    assert len(body["templates"]) == count + 1
    section = body["content_json"]["sections"][new["template_id"]]
    assert section["title"] == "Security notes" and section["blocks"][0]["text"] == "Heads up"
    # It sits after the existing sub-sections of its parent.
    siblings = [item for item in body["templates"] if item["parent_id"] == parent["template_id"]]
    assert siblings[-1]["template_id"] == new["template_id"]

    renamed = client.patch(f"{base}/sections/{new['template_id']}", json={"section_name": "Security notes v2"}, headers=auth(writer))
    assert renamed.status_code == 200
    assert renamed.json()["content_json"]["sections"][new["template_id"]]["title"] == "Security notes v2"
    assert client.patch(f"{base}/sections/{new['template_id']}", json={"section_name": " "}, headers=auth(writer)).status_code == 400
    assert client.patch(f"{base}/sections/nope", json={"section_name": "x"}, headers=auth(writer)).status_code == 404

    deleted = client.delete(f"{base}/sections/{new['template_id']}", headers=auth(writer))
    assert deleted.status_code == 200
    assert new["template_id"] not in deleted.json()["content_json"]["sections"]
    assert len(deleted.json()["templates"]) == count


def test_sub_sections_cannot_be_nested_and_the_last_section_stays(client):
    writer, base, _ = _setup(client)
    child = next(item for item in _templates(client, writer, base) if item["parent_id"])
    nested = client.post(f"{base}/sections", json={"section_name": "Deep", "parent_id": child["template_id"]}, headers=auth(writer))
    assert nested.status_code == 400
    missing_parent = client.post(f"{base}/sections", json={"section_name": "Deep", "parent_id": "nope"}, headers=auth(writer))
    assert missing_parent.status_code == 404
    for item in [item for item in _templates(client, writer, base) if item["parent_id"] is None][:-1]:
        assert client.delete(f"{base}/sections/{item['template_id']}", headers=auth(writer)).status_code == 200
    last = _templates(client, writer, base)
    top = [item for item in last if item["parent_id"] is None]
    assert len(top) == 1
    for item in [item for item in last if item["parent_id"]]:
        client.delete(f"{base}/sections/{item['template_id']}", headers=auth(writer))
    only = _templates(client, writer, base)
    assert len(only) == 1
    blocked = client.delete(f"{base}/sections/{only[0]['template_id']}", headers=auth(writer))
    assert blocked.status_code == 400 and "at least one section" in blocked.json()["detail"]


def test_deleting_a_section_removes_its_sub_sections_and_content(client):
    writer, base, _ = _setup(client)
    templates = _templates(client, writer, base)
    parent = next(item for item in templates if item["parent_id"] is None and any(c["parent_id"] == item["template_id"] for c in templates))
    children = [item["template_id"] for item in templates if item["parent_id"] == parent["template_id"]]
    result = client.delete(f"{base}/sections/{parent['template_id']}", headers=auth(writer)).json()
    gone = {parent["template_id"], *children}
    assert gone.isdisjoint({item["template_id"] for item in result["templates"]})
    assert gone.isdisjoint(result["content_json"]["sections"])


def test_reorder_sections_and_move_between_levels(client):
    writer, base, _ = _setup(client)
    templates = _templates(client, writer, base)
    tops = [item for item in templates if item["parent_id"] is None]
    tree = [
        {"template_id": item["template_id"], "children": [c["template_id"] for c in templates if c["parent_id"] == item["template_id"]]}
        for item in tops
    ]
    tree[0], tree[1] = tree[1], tree[0]
    result = client.put(f"{base}/sections-order", json={"sections": tree}, headers=auth(writer))
    assert result.status_code == 200, result.text
    new_tops = [item["template_id"] for item in result.json()["templates"] if item["parent_id"] is None]
    assert new_tops[:2] == [tree[0]["template_id"], tree[1]["template_id"]]
    # Move the first section's child under the second parent.
    moved = tree[0]["children"][0] if tree[0]["children"] else None
    if moved:
        tree[0]["children"].remove(moved)
        tree[1]["children"].append(moved)
        again = client.put(f"{base}/sections-order", json={"sections": tree}, headers=auth(writer)).json()
        assert next(item for item in again["templates"] if item["template_id"] == moved)["parent_id"] == tree[1]["template_id"]
    incomplete = client.put(f"{base}/sections-order", json={"sections": tree[:-1]}, headers=auth(writer))
    assert incomplete.status_code == 400


def test_changing_blocks_keeps_matching_content_and_refits_tables(client):
    writer, base, _ = _setup(client)
    created = client.post(
        f"{base}/sections",
        json={"section_name": "Mixed", "blocks": [{"type": "prose"}, {"type": "table", "columns": ["A", "B"]}]},
        headers=auth(writer),
    ).json()
    sid = next(item["template_id"] for item in created["templates"] if item["section_name"] == "Mixed")
    content = created["content_json"]
    content["sections"][sid]["blocks"][0]["markdown"] = "Keep me"
    content["sections"][sid]["blocks"][1]["rows"] = [["1", "2"]]
    client.put(base, json={"content_json": content}, headers=auth(writer))
    changed = client.patch(
        f"{base}/sections/{sid}",
        json={"blocks": [{"type": "prose"}, {"type": "table", "columns": ["A", "B", "C"]}, {"type": "diagram", "sequence": False}]},
        headers=auth(writer),
    )
    assert changed.status_code == 200, changed.text
    blocks = changed.json()["content_json"]["sections"][sid]["blocks"]
    assert [block["type"] for block in blocks] == ["prose", "table", "diagram"]
    assert blocks[0]["markdown"] == "Keep me"
    assert blocks[1]["columns"] == ["A", "B", "C"] and blocks[1]["rows"] == [["1", "2", ""]]




def test_who_may_change_the_structure(client):
    writer, base, _ = _setup(client)
    first = _templates(client, writer, base)[0]
    for role in ("Read", "Admin"):
        token = login(client, role)
        assert client.post(f"{base}/sections", json={"section_name": "x"}, headers=auth(token)).status_code == 403
        assert client.patch(f"{base}/sections/{first['template_id']}", json={"section_name": "x"}, headers=auth(token)).status_code == 403
        assert client.delete(f"{base}/sections/{first['template_id']}", headers=auth(token)).status_code == 403
        assert client.put(f"{base}/sections-order", json={"sections": []}, headers=auth(token)).status_code in {400, 403}
    reader = login(client, "Read")
    assert client.patch(f"{base}/sections/{first['template_id']}", json={"system_prompt": "x"}, headers=auth(reader)).status_code == 403
    admin = auth(login(client, "Admin"))
    prompt = client.patch(
        f"{base}/sections/{first['template_id']}", json={"system_prompt": "Write it short", "temperature": 0.4, "max_words": 120}, headers=admin
    )
    assert prompt.status_code == 200
    changed = next(item for item in prompt.json()["templates"] if item["template_id"] == first["template_id"])
    assert changed["system_prompt"] == "Write it short" and changed["max_words"] == 120
    # Editing a prompt in the document leaves the layout alone.
    layout = client.get("/api/layouts/sdd", headers=admin).json()
    original = next(item for item in layout["templates"] if item["template_id"] == first["template_id"])
    assert original["system_prompt"] == first["system_prompt"]
