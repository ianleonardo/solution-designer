import json

from app import db
from app.services import project_rag
from tests.conftest import auth, login


def _project(client, token, name="RAG"):
    return client.post("/api/projects", json={"project_name": name}, headers=auth(token)).json()["project_id"]


def _upload(client, token, project_id, name, text):
    return client.post(
        f"/api/projects/{project_id}/references",
        files={"file": (name, text.encode(), "text/markdown")},
        headers=auth(token),
    )


def test_chunk_text_splits_with_overlap_and_handles_empty():
    assert project_rag.chunk_text("") == []
    assert project_rag.chunk_text("short") == ["short"]
    text = " ".join(f"word{index}" for index in range(600))
    chunks = project_rag.chunk_text(text, size=300, overlap=50)
    assert len(chunks) > 5
    assert all(len(chunk) <= 300 for chunk in chunks)
    assert "word599" in chunks[-1]


def test_upload_indexes_chunks_and_delete_removes_them(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    uploaded = _upload(client, writer, project_id, "brd.md", "# Settlement\n" + "The platform settles trades nightly. " * 80)
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    assert body["chunk_count"] > 1
    assert body["indexed"] is False  # no embedding model configured, keyword search only
    listed = client.get(f"/api/projects/{project_id}/references", headers=auth(writer)).json()
    assert listed[0]["doc_id"] == body["doc_id"]
    assert client.get(f"/api/projects/{project_id}/baselines", headers=auth(writer)).status_code == 200
    deleted = client.delete(f"/api/projects/{project_id}/references/{body['doc_id']}", headers=auth(writer))
    assert deleted.status_code == 200
    assert db.fetchone("SELECT COUNT(*) AS n FROM project_rag_chunks")["n"] == 0


def test_retrieval_is_scoped_to_the_project(client):
    writer = login(client, "Write")
    first = _project(client, writer, "First")
    second = _project(client, writer, "Second")
    _upload(client, writer, first, "a.md", "Settlement uses the SWIFT gateway for cross border payments.")
    _upload(client, writer, second, "b.md", "Settlement uses the SWIFT gateway at Contoso bank only.")
    hits = project_rag.retrieve(first, "SWIFT gateway settlement")
    assert hits and {hit["file_name"] for hit in hits} == {"a.md"}
    assert project_rag.retrieve(first, "unrelated zebra") == []


def test_role_rules_for_references(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    assert _upload(client, login(client, "Read"), project_id, "x.md", "text").status_code == 403
    uploaded = _upload(client, writer, project_id, "x.md", "text").json()
    assert client.delete(f"/api/projects/{project_id}/references/{uploaded['doc_id']}", headers=auth(login(client, "Read"))).status_code == 403
    assert client.get(f"/api/projects/{project_id}/references", headers=auth(login(client, "Read"))).status_code == 200


def test_reference_download_and_inline_preview(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    uploaded = _upload(client, writer, project_id, "brd.md", "# Scope\n\nSettlement details.").json()
    doc_id = uploaded["doc_id"]
    viewer = login(client, "Read")
    download = client.get(f"/api/projects/{project_id}/references/{doc_id}/download", headers=auth(viewer))
    assert download.status_code == 200, download.text
    assert download.content == b"# Scope\n\nSettlement details."
    assert "attachment" in (download.headers.get("content-disposition") or "").lower()
    inline = client.get(
        f"/api/projects/{project_id}/references/{doc_id}/download",
        params={"inline": True},
        headers=auth(viewer),
    )
    assert inline.status_code == 200
    assert "inline" in (inline.headers.get("content-disposition") or "").lower()
    assert client.get(f"/api/projects/{project_id}/references/missing/download", headers=auth(viewer)).status_code == 404


def test_generation_prompt_uses_project_references_and_inventory(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    prompts = []

    systems = []

    def fake_complete(system, user, temperature):
        del temperature
        systems.append(system)
        prompts.append(user)
        return json.dumps({"blocks": [{"type": "prose", "markdown": "ok"}]})

    monkeypatch.setattr("app.services.llm.complete", fake_complete)
    writer = login(client, "Write")
    project_id = _project(client, writer)
    _upload(client, writer, project_id, "brd.md", "Housekeeping archives ledger data after seven years using the Quokka scheduler.")
    response = client.post(f"/api/projects/{project_id}/sections/housekeeping/regenerate", headers=auth(writer))
    if response.status_code == 404:
        templates = client.get(f"/api/projects/{project_id}/workspace", headers=auth(writer)).json()["templates"]
        slug = next(item["template_id"] for item in templates if "housekeeping" in item["template_id"] or "housekeeping" in item["section_name"].lower())
        response = client.post(f"/api/projects/{project_id}/sections/{slug}/regenerate", headers=auth(writer))
    assert response.status_code == 200, response.text
    assert "PROJECT_REFERENCES" in prompts[-1]
    # The global prompt is format-neutral, so generation adds its own grounding and JSON rules.
    assert systems[-1].endswith("Respond with JSON only.")
    assert "must come from the supplied project references" in systems[-1]
    assert "Quokka scheduler" in prompts[-1]


def test_startup_indexes_documents_that_predate_project_rag(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    uploaded = _upload(client, writer, project_id, "old.md", "Legacy reference about reconciliation jobs.").json()
    db.exec_sql("DELETE FROM project_rag_chunks")
    assert project_rag.index_missing() == 1
    assert project_rag.retrieve(project_id, "reconciliation jobs")[0]["doc_id"] == uploaded["doc_id"]
    assert project_rag.index_missing() == 0


def test_deleting_a_project_removes_its_chunks(client):
    writer = login(client, "Write")
    project_id = _project(client, writer)
    _upload(client, writer, project_id, "x.md", "Some reference text about payments.")
    assert client.delete(f"/api/projects/{project_id}", headers=auth(writer)).status_code == 200
    assert db.fetchone("SELECT COUNT(*) AS n FROM project_rag_chunks")["n"] == 0
