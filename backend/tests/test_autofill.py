import json

from app.content import blank_content, section_is_empty
from tests.conftest import auth, login


def _project(client, token, name="Autofill"):
    return client.post("/api/projects", json={"project_name": name}, headers=auth(token)).json()["project_id"]


def _document(client, token, project_id):
    first = client.get(f"/api/projects/{project_id}/documents", headers=auth(token)).json()[0]
    return client.get(f"/api/projects/{project_id}/documents/{first['document_id']}", headers=auth(token)).json()


def _fake(monkeypatch, prompts):
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    def complete(system, user, temperature):
        prompts.append((system, user))
        return json.dumps({"blocks": [{"type": "prose", "markdown": "Filled by the model"}]})

    monkeypatch.setattr("app.services.llm.complete", complete)
    monkeypatch.setattr("app.services.llm.embed", lambda _text: None)  # no network calls from retrieval


def test_a_blank_section_is_empty_until_something_is_written(client):
    maker = login(client, "Maker")
    document = _document(client, maker, _project(client, maker))
    templates = {item["template_id"]: item for item in document["templates"]}
    sections = document["content_json"]["sections"]
    assert all(section_is_empty(sections[key], templates[key]) for key in sections)
    key = next(key for key, section in sections.items() if any(block["type"] == "prose" for block in section["blocks"]))
    written = json.loads(json.dumps(sections[key]))
    next(block for block in written["blocks"] if block["type"] == "prose")["markdown"] = "  Some text "
    assert not section_is_empty(written, templates[key])
    next(block for block in written["blocks"] if block["type"] == "prose")["markdown"] = "   "
    assert section_is_empty(written, templates[key])


def test_starter_table_rows_and_starter_diagrams_do_not_count_as_content(client):
    maker = login(client, "Maker")
    document = _document(client, maker, _project(client, maker))
    template = next(item for item in document["templates"] if item["template_id"] == "key-non-functional-requirements")
    blank = blank_content([{**template, "schema_json": {"blocks": template["blocks"]}}])["sections"][template["template_id"]]
    assert section_is_empty(blank, template)
    table = next(block for block in blank["blocks"] if block["type"] == "table")
    table["rows"][0][-1] = "10 million a year"
    assert not section_is_empty(blank, template)
    diagrams = [item for item in document["templates"] if any(block.get("sequence") is not None for block in item["blocks"])]
    assert diagrams
    for item in diagrams:
        assert section_is_empty(blank_content([{**item, "schema_json": {"blocks": item["blocks"]}}])["sections"][item["template_id"]], item)
    flow = {"type": "diagram", "sequence": False, "mermaid": "flowchart LR\n  A[Mine] --> B[Yours]", "flow": None}
    assert not section_is_empty({"blocks": [flow]}, None)


def test_checker_can_auto_fill_a_section_with_an_extra_instruction(client, monkeypatch):
    prompts = []
    _fake(monkeypatch, prompts)
    checker = login(client, "Checker")
    project_id = _project(client, checker)
    document = _document(client, checker, project_id)
    section = next(item for item in document["templates"] if item["content_kind"] == "prose")["template_id"]
    base = f"/api/projects/{project_id}/documents/{document['document_id']}/sections/{section}/regenerate"
    plain = client.post(base, headers=auth(checker))
    assert plain.status_code == 200, plain.text
    assert "ADDITIONAL INSTRUCTION" not in prompts[-1][1]
    extra = client.post(base, json={"instruction": "  Focus on   settlement\nrisk  "}, headers=auth(checker))
    assert extra.status_code == 200, extra.text
    assert "ADDITIONAL INSTRUCTION" in prompts[-1][1] and "Focus on settlement risk" in prompts[-1][1]
    blocks = extra.json()["content_json"]["sections"][section]["blocks"]
    assert any(block.get("markdown") == "Filled by the model" for block in blocks)
    long = client.post(base, json={"instruction": "q" * 5000}, headers=auth(checker))
    assert long.status_code == 200
    assert "q" * 1000 in prompts[-1][1] and "q" * 1001 not in prompts[-1][1]


def test_generation_uses_the_prompt_stored_in_the_document(client, monkeypatch):
    prompts = []
    _fake(monkeypatch, prompts)
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    document = _document(client, maker, project_id)
    section = next(item for item in document["templates"] if item["content_kind"] == "prose")["template_id"]
    base = f"/api/projects/{project_id}/documents/{document['document_id']}"
    admin = auth(login(client, "Admin"))
    assert client.patch(f"{base}/sections/{section}", json={"system_prompt": "SNAPSHOT-PROMPT-MARKER"}, headers=admin).status_code == 200
    layout = client.get("/api/layouts/sdd", headers=admin).json()
    original = next(item for item in layout["templates"] if item["template_id"] == section)
    client.put(f"/api/templates/{section}", json={"section_name": original["section_name"], "system_prompt": "LAYOUT-PROMPT-MARKER"}, headers=admin)
    assert client.post(f"{base}/sections/{section}/regenerate", headers=auth(maker)).status_code == 200
    assert "SNAPSHOT-PROMPT-MARKER" in prompts[-1][0] and "LAYOUT-PROMPT-MARKER" not in prompts[-1][0]


def test_generate_all_can_fill_only_the_empty_sections(client, monkeypatch):
    prompts = []
    _fake(monkeypatch, prompts)
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    document = _document(client, maker, project_id)
    base = f"/api/projects/{project_id}/documents/{document['document_id']}"
    prose = [item["template_id"] for item in document["templates"] if item["content_kind"] == "prose"]
    kept = prose[0]
    sections = document["content_json"]["sections"]
    next(block for block in sections[kept]["blocks"] if block["type"] == "prose")["markdown"] = "Written by a person"
    assert client.put(base, json={"content_json": {"sections": sections}}, headers=auth(maker)).status_code == 200

    with client.stream("POST", f"{base}/generate?only_empty=true", headers=auth(maker)) as stream:
        body = stream.read().decode()
    assert f'"event": "section_skipped", "section_id": "{kept}"' in body
    assert f'"event": "section_start", "section_id": "{prose[1]}"' in body
    assert f'"event": "section_start", "section_id": "{kept}"' not in body
    after = client.get(base, headers=auth(maker)).json()["content_json"]["sections"]
    assert next(b for b in after[kept]["blocks"] if b["type"] == "prose")["markdown"] == "Written by a person"
    assert next(b for b in after[prose[1]]["blocks"] if b["type"] == "prose")["markdown"] == "Filled by the model"

    with client.stream("POST", f"{base}/generate", headers=auth(maker)) as stream:
        full = stream.read().decode()
    assert f'"event": "section_start", "section_id": "{kept}"' in full
    assert "section_skipped" not in full


def test_viewers_and_admins_cannot_auto_fill(client, monkeypatch):
    _fake(monkeypatch, [])
    maker = login(client, "Maker")
    project_id = _project(client, maker)
    document = _document(client, maker, project_id)
    section = document["templates"][0]["template_id"]
    base = f"/api/projects/{project_id}/documents/{document['document_id']}"
    for role in ("Viewer", "Admin"):
        token = auth(login(client, role))
        assert client.post(f"{base}/sections/{section}/regenerate", json={"instruction": "x"}, headers=token).status_code == 403
        assert client.post(f"{base}/generate?only_empty=true", headers=token).status_code == 403


def test_a_model_that_renames_the_prose_field_still_fills_the_section(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    prompts = []

    def complete(system, user, temperature):
        prompts.append(user)
        return '```json\n{"blocks": [{"type": "prose", "content": "Purpose written under the wrong key"}]}\n```'

    monkeypatch.setattr("app.services.llm.complete", complete)
    monkeypatch.setattr("app.services.llm.embed", lambda _text: None)
    maker = login(client, "Maker")
    project_id = client.post("/api/projects", json={"project_name": "Atlas", "description": "Card settlement hub"}, headers=auth(maker)).json()["project_id"]
    document = _document(client, maker, project_id)
    section = next(item for item in document["templates"] if item["content_kind"] == "prose")["template_id"]
    response = client.post(f"/api/projects/{project_id}/documents/{document['document_id']}/sections/{section}/regenerate", headers=auth(maker))
    assert response.status_code == 200, response.text
    blocks = response.json()["content_json"]["sections"][section]["blocks"]
    assert any(block.get("markdown") == "Purpose written under the wrong key" for block in blocks)
    assert "PROJECT: Atlas" in prompts[-1] and "Card settlement hub" in prompts[-1]
    assert '"markdown"' in prompts[-1]
