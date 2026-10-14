import json

from app.services.retrieve import retrieve
from tests.conftest import auth, login


def test_rag_upload_and_keyword_retrieval(client):
    reader = login(client, "Read")
    denied = client.post(
        "/api/rag",
        files={"file": ("notes.md", b"# Interfaces\n| System | Protocol |\n| --- | --- |\n| Payments | HTTPS |\n", "text/markdown")},
        headers=auth(reader),
    )
    assert denied.status_code == 403
    admin = login(client, "Admin")
    uploaded = client.post(
        "/api/rag",
        files={
            "file": (
                "interfaces.md",
                b"# Interfaces\n| System | Country | Protocol | Purpose |\n| --- | --- | --- | --- |\n| Payments | SG | HTTPS | Post a transfer |\n",
                "text/markdown",
            )
        },
        headers=auth(admin),
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    assert body[0]["inventory_type"] == "Interfaces"
    assert body[0]["rag_id"].startswith("IF-")
    assert body[0]["parsed"]["protocol"] == "HTTPS"
    hits = retrieve("HTTPS transfer", limit=3)
    assert hits
    assert hits[0]["inventory_type"] == "Interfaces"


def test_baseline_markdown_is_stored(client):
    writer = login(client, "Write")
    created = client.post("/api/projects", json={"project_name": "Baseline"}, headers=auth(writer))
    project_id = created.json()["project_id"]
    uploaded = client.post(
        f"/api/projects/{project_id}/baselines",
        files={"file": ("brd.md", b"# Payments\nThe system shall settle trades.", "text/markdown")},
        headers=auth(writer),
    )
    assert uploaded.status_code == 200, uploaded.text
    assert "settle trades" in uploaded.json()["extracted_text"]
    reader = login(client, "Read")
    denied = client.post(
        f"/api/projects/{project_id}/baselines",
        files={"file": ("other.md", b"no", "text/markdown")},
        headers=auth(reader),
    )
    assert denied.status_code == 403


def test_generation_without_a_key_keeps_the_draft(client):
    writer = login(client, "Write")
    created = client.post("/api/projects", json={"project_name": "Draft"}, headers=auth(writer))
    project_id = created.json()["project_id"]
    response = client.post(f"/api/projects/{project_id}/generate", headers=auth(writer))
    assert response.status_code == 503
    assert "LLM_API_KEY" in response.json()["detail"]
    workspace = client.get(f"/api/projects/{project_id}/workspace", headers=auth(writer))
    sections = workspace.json()["sdd"]["content_json"]["sections"]
    assert "key-non-functional-requirements" in sections
    assert sections["key-non-functional-requirements"]["missing"]


def test_generation_stream_clears_known_gaps(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    def fake_complete(system, user, temperature):
        del system, temperature
        if "SECTION: Key Non-Functional Requirements" in user:
            rows = [
                ["1", "Volumetric Projections (next 3 to 5 years)", "10 million payments a year"],
                ["2", "Maximum Load/Users", "5000"],
                ["3", "Peak Load/Users", "800"],
                ["4", "Concurrent Users (TPS)", "120"],
                ["5", "Response Time (for key use cases)", "300 ms"],
            ]
            return json.dumps({"blocks": [{"type": "table", "columns": ["SN", "NFR", "Requirements"], "rows": rows}]})
        if "SECTION: Expected DB Size Growth" in user:
            return json.dumps({"blocks": [{"type": "prose", "markdown": "About 20 GB over five years."}]})
        return json.dumps({"blocks": [{"type": "prose", "markdown": "Generated from the baseline."}]})

    monkeypatch.setattr("app.services.llm.complete", fake_complete)
    writer = login(client, "Write")
    created = client.post("/api/projects", json={"project_name": "Generated"}, headers=auth(writer))
    project_id = created.json()["project_id"]
    with client.stream("POST", f"/api/projects/{project_id}/generate", headers=auth(writer)) as response:
        assert response.status_code == 200
        body = response.read().decode()
    assert "section_done" in body
    assert "complete" in body
    workspace = client.get(f"/api/projects/{project_id}/workspace", headers=auth(writer)).json()
    sections = workspace["sdd"]["content_json"]["sections"]
    assert sections["key-non-functional-requirements"]["missing"] == []
    assert sections["expected-db-size-growth"]["missing"] == []
    assert workspace["sdd"]["generated_at"] is not None
