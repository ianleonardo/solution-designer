import json

from app import db
from app.services import guidelines
from tests.conftest import auth, login

TEXT = "Always validate input at the trust boundary.\n\n" + ("Use parameterised queries and least privilege. " * 60)


def _pdf(text: str) -> bytes:
    """A one-page PDF with the text on it, built by hand so no PDF writer is needed."""
    stream = f"BT /F1 12 Tf 72 700 Td ({text}) Tj ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    return out + f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()


def _embedding_on(monkeypatch, model="spirare:embed-v1"):
    calls = []

    def fake_embed(text):
        calls.append(text)
        return [1.0, 0.0, float(len(calls) % 3)]

    monkeypatch.setattr("app.services.llm.embedding_configured", lambda: True)
    monkeypatch.setattr("app.services.llm.embed", fake_embed)
    monkeypatch.setattr("app.services.guidelines.current_embedding_model", lambda: model)
    return calls


def _add(client, token, title="Secure coding", description="Rules for code", name="secure.md", data=TEXT.encode()):
    return client.post(
        "/api/guidelines",
        data={"title": title, "description": description},
        files={"file": (name, data, "text/plain")},
        headers=auth(token),
    )


def test_add_guideline_chunks_and_embeds_every_chunk(client, monkeypatch):
    calls = _embedding_on(monkeypatch)
    admin = login(client, "Admin")
    response = _add(client, admin)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["guideline_id"] == "GL-0001"
    assert body["title"] == "Secure coding" and body["description"] == "Rules for code"
    assert body["chunk_count"] > 1 and body["embedded_count"] == body["chunk_count"]
    assert body["status"] == "embedded" and body["embedding_model"] == "spirare:embed-v1"
    assert body["warning"] == ""
    assert len(calls) == body["chunk_count"]
    # The title and description travel with each chunk so title matches help retrieval.
    assert calls[0].startswith("Secure coding\nRules for code\n")
    stored = db.fetchone("SELECT count(*) AS c FROM guideline_chunks WHERE guideline_id = 'GL-0001'")["c"]
    assert stored == body["chunk_count"]
    assert [item["guideline_id"] for item in client.get("/api/guidelines", headers=auth(admin)).json()] == ["GL-0001"]
    assert _add(client, admin, title="Second").json()["guideline_id"] == "GL-0002"


def test_pdf_text_is_extracted_and_indexed(client):
    admin = login(client, "Admin")
    response = _add(client, admin, title="TLS", name="tls.pdf", data=_pdf("Encrypt data in transit with TLS"))
    assert response.status_code == 200, response.text
    assert response.json()["file_type"] == "pdf"
    assert "TLS" in db.fetchone("SELECT content FROM guideline_chunks")["content"]


def test_supported_types_and_validation(client):
    admin = login(client, "Admin")
    assert _add(client, admin, name="notes.txt").status_code == 200
    assert _add(client, admin, name="notes.md").status_code == 200
    assert _add(client, admin, name="sheet.xlsx").status_code == 400
    assert _add(client, admin, name="page.html").status_code == 400
    assert _add(client, admin, title="  ").status_code == 400
    empty = _add(client, admin, name="empty.txt", data=b"   ")
    assert empty.status_code == 400 and "No text" in empty.json()["detail"]
    bad_pdf = _add(client, admin, name="broken.pdf", data=b"not a pdf")
    assert bad_pdf.status_code == 400 and "PDF" in bad_pdf.json()["detail"]
    listing = client.get("/api/guidelines", headers=auth(admin)).json()
    assert sorted(item["file_type"] for item in listing) == ["md", "txt"]


def test_without_an_embedding_model_the_guideline_is_keyword_only(client):
    admin = login(client, "Admin")
    body = _add(client, admin).json()
    assert body["embedded_count"] == 0 and body["status"] == "keyword_only"
    assert body["chunk_count"] > 1
    assert "embedding model" in body["warning"]


def test_the_per_guideline_reembed_and_retokenize_routes_are_gone(client):
    admin = login(client, "Admin")
    _add(client, admin)
    for path in ("/api/guidelines/GL-0001/reembed", "/api/guidelines/GL-0001/retokenize", "/api/guidelines/reembed-all"):
        assert client.post(path, headers=auth(admin)).status_code in (404, 405)


def test_embedding_failures_do_not_block_saving(client, monkeypatch):
    monkeypatch.setattr("app.services.llm.embedding_configured", lambda: True)
    monkeypatch.setattr("app.services.llm.embed", lambda text: None)
    monkeypatch.setattr("app.services.guidelines.current_embedding_model", lambda: "spirare:embed-v1")
    admin = login(client, "Admin")
    body = _add(client, admin).json()
    assert body["status"] == "keyword_only" and body["embedded_count"] == 0
    assert "embedding" in body["warning"]


def test_delete_removes_chunks_and_file(client):
    admin = login(client, "Admin")
    _add(client, admin)
    stored = db.fetchone("SELECT storage_path FROM guidelines")["storage_path"]
    assert client.delete("/api/guidelines/GL-0001", headers=auth(admin)).status_code == 200
    assert db.fetchone("SELECT count(*) AS c FROM guidelines")["c"] == 0
    assert db.fetchone("SELECT count(*) AS c FROM guideline_chunks")["c"] == 0
    from pathlib import Path

    assert not Path(stored).exists()
    assert client.delete("/api/guidelines/GL-0001", headers=auth(admin)).status_code == 404


def test_only_admin_can_manage_guidelines(client):
    for role in ("Write", "Read"):
        token = login(client, role)
        assert client.get("/api/guidelines", headers=auth(token)).status_code == 403
        assert _add(client, token).status_code == 403
        assert client.delete("/api/guidelines/GL-0001", headers=auth(token)).status_code == 403


def test_generic_knowledge_upload_no_longer_creates_guidelines(client):
    admin = login(client, "Admin")
    response = client.post(
        "/api/rag?inventory_type=Guidelines",
        files={"file": ("g.md", b"# Rules\nBe safe", "text/markdown")},
        headers=auth(admin),
    )
    assert response.status_code == 400 and "Guidelines page" in response.json()["detail"]


def test_guideline_chunks_are_retrieved_for_generation_and_chat(client):
    from app.services.retrieve import retrieve

    admin = login(client, "Admin")
    _add(client, admin, title="Quokka handling", description="", data=b"Quokka scheduler retries failed jobs three times with backoff.")
    hits = retrieve("how does the quokka scheduler retry jobs")
    top = hits[0]
    assert top["inventory_type"] == "Guidelines" and top["system_name"] == "Quokka handling"
    assert top["rag_id"] == "GL-0001#0" and "retries failed jobs" in top["raw_content"]


def test_legacy_guideline_entries_are_converted_once(client):
    admin = login(client, "Admin")
    del admin
    db.exec_sql(
        """
        INSERT INTO rag_inventory (rag_id, inventory_type, system_name, source_name, raw_content, parsed_json, embedding, created_at)
        VALUES ('GL-0007', 'Guidelines', 'Sys', 'old.md', 'Keep secrets out of logs. Rotate keys often.', ?, NULL, CURRENT_TIMESTAMP)
        """,
        [json.dumps({"guideline_name": "Secrets", "purpose": "p"})],
    )
    db.exec_sql(
        """
        INSERT INTO rag_inventory (rag_id, inventory_type, system_name, source_name, raw_content, parsed_json, embedding, created_at)
        VALUES ('CA-0001', 'Capabilities', 'Sys', 'cap.md', 'Payments', '{}', NULL, CURRENT_TIMESTAMP)
        """
    )
    assert guidelines.migrate_legacy() == 1
    row = db.fetchone("SELECT * FROM guidelines WHERE guideline_id = 'GL-0007'")
    assert row["title"] == "Secrets" and row["description"] == "" and row["chunk_count"] == 1 and row["embedded_count"] == 0
    assert db.fetchone("SELECT count(*) AS c FROM guideline_chunks WHERE guideline_id = 'GL-0007'")["c"] == 1
    assert db.fetchone("SELECT count(*) AS c FROM rag_inventory WHERE inventory_type = 'Guidelines'")["c"] == 0
    assert db.fetchone("SELECT count(*) AS c FROM rag_inventory WHERE inventory_type = 'Capabilities'")["c"] == 1
    assert guidelines.migrate_legacy() == 0
    # New ids continue after the migrated ones.
    token = login(client, "Admin")
    assert _add(client, token).json()["guideline_id"] == "GL-0008"


def test_original_file_can_be_downloaded(client):
    admin = login(client, "Admin")
    original = b"# Secure coding\nNever log secrets.\n"
    body = _add(client, admin, name="secure.md", data=original).json()
    assert body["has_file"] is True
    response = client.get("/api/guidelines/GL-0001/download", headers=auth(admin))
    assert response.status_code == 200
    assert response.content == original
    assert "secure.md" in response.headers["content-disposition"]
    assert response.headers["content-type"].startswith("text/markdown")
    assert client.get("/api/guidelines/GL-9999/download", headers=auth(admin)).status_code == 404


def test_pdf_download_keeps_the_original_bytes(client):
    admin = login(client, "Admin")
    data = _pdf("Always encrypt data at rest.")
    _add(client, admin, name="policy.pdf", data=data)
    response = client.get("/api/guidelines/GL-0001/download", headers=auth(admin))
    assert response.content == data and response.headers["content-type"] == "application/pdf"


def test_download_is_admin_only_and_missing_for_converted_entries(client):
    admin = login(client, "Admin")
    _add(client, admin)
    for role in ("Write", "Read"):
        assert client.get("/api/guidelines/GL-0001/download", headers=auth(login(client, role))).status_code == 403
    db.exec_sql("UPDATE guidelines SET storage_path = '' WHERE guideline_id = 'GL-0001'")
    listed = client.get("/api/guidelines", headers=auth(admin)).json()
    assert listed[0]["has_file"] is False
    assert client.get("/api/guidelines/GL-0001/download", headers=auth(admin)).status_code == 404


class _FakeBlob:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def upload_from_filename(self, path):
        from pathlib import Path

        self.store[self.name] = Path(path).read_bytes()

    def exists(self):
        return self.name in self.store

    def download_to_filename(self, path):
        from pathlib import Path

        Path(path).write_bytes(self.store[self.name])

    def delete(self):
        del self.store[self.name]


def _fake_bucket(monkeypatch):
    store: dict[str, bytes] = {}

    class Bucket:
        def blob(self, name):
            return _FakeBlob(store, name)

    class Client:
        def bucket(self, name):
            return Bucket()

    monkeypatch.setenv("GCS_BUCKET", "bucket")
    monkeypatch.setattr("app.services.gcs._client", lambda: Client())
    monkeypatch.setattr("app.services.gcs.upload_db", lambda: None)
    monkeypatch.setattr("app.services.guidelines.gcs.upload_db", lambda: None)
    return store


def test_file_is_stored_in_the_bucket_and_restored_when_the_local_copy_is_gone(client, monkeypatch):
    from pathlib import Path

    store = _fake_bucket(monkeypatch)
    admin = login(client, "Admin")
    original = b"Rotate keys every 90 days."
    _add(client, admin, name="keys.txt", data=original)
    local = Path(db.fetchone("SELECT storage_path FROM guidelines")["storage_path"])
    assert list(store) == [f"uploads/guidelines/{local.name}"]
    local.unlink()
    response = client.get("/api/guidelines/GL-0001/download", headers=auth(admin))
    assert response.status_code == 200 and response.content == original
    assert local.is_file()
    client.delete("/api/guidelines/GL-0001", headers=auth(admin))
    assert store == {}


def test_download_reports_a_missing_file(client):
    from pathlib import Path

    admin = login(client, "Admin")
    _add(client, admin)
    Path(db.fetchone("SELECT storage_path FROM guidelines")["storage_path"]).unlink()
    response = client.get("/api/guidelines/GL-0001/download", headers=auth(admin))
    assert response.status_code == 404 and "storage" in response.json()["detail"]
