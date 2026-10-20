import io

from app import db
from app.services import reindex
from openpyxl import Workbook
from tests.conftest import auth, login

SIX = ["Interface name", "Endpoint", "Description", "Protocol", "Source", "Destination"]


def _excel(rows) -> bytes:
    workbook = Workbook()
    workbook.active.append(SIX)
    for row in rows:
        workbook.active.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _fill(client, admin, writer):
    """One of everything that is embedded."""
    for code in ("SPL", "DGE"):
        client.post("/api/systems", json={"system_code": code, "system_name": f"{code} name"}, headers=auth(admin))
    files = {"file": ("i.xlsx", _excel([["Get", "", "", "API", "SPL", "DGE"]]), "application/octet-stream")}
    client.post("/api/interfaces/SPL/upload", data={"country": "SG"}, files=files, headers=auth(admin))
    db.exec_sql(
        "INSERT INTO rag_inventory (rag_id, inventory_type, system_name, source_name, raw_content, parsed_json, embedding, created_at) "
        "VALUES ('CA-0001', 'Capabilities', 'Pay', 'f.md', 'Payments capability', '{}', NULL, CURRENT_TIMESTAMP)"
    )
    guideline = {"file": ("g.md", b"Always validate input.\n\n" + b"Use least privilege. " * 80, "text/markdown")}
    client.post("/api/guidelines", data={"title": "Secure", "description": "d"}, files=guideline, headers=auth(admin))
    project_id = client.post("/api/projects", json={"project_name": "P"}, headers=auth(writer)).json()["project_id"]
    ref = {"file": ("r.md", b"Reference text about settlement.", "text/markdown")}
    assert client.post(f"/api/projects/{project_id}/references", files=ref, headers=auth(writer)).status_code == 200


def _vectors():
    out = {}
    for table in ("rag_inventory", "guideline_chunks", "project_rag_chunks", "systems", "interfaces"):
        out[table] = db.fetchone(f"SELECT COUNT(*) AS total, SUM(CASE WHEN embedding IS NULL THEN 0 ELSE 1 END) AS embedded FROM {table}")
    return out


def _embedding_on(monkeypatch, tag, model="m1"):
    calls = []

    def fake(text):
        calls.append(text)
        return [float(tag), 1.0]

    monkeypatch.setattr("app.services.llm.embedding_configured", lambda: True)
    monkeypatch.setattr("app.services.llm.embed", fake)
    monkeypatch.setattr(reindex, "signature", lambda: f"sig-{model}")
    monkeypatch.setattr("app.services.guidelines.current_embedding_model", lambda: model)
    return calls


def test_a_changed_embedding_setup_re_embeds_everything(client, monkeypatch):
    monkeypatch.setattr(reindex, "_spawn", lambda job: job())
    admin, writer = login(client, "Admin"), login(client, "Write")
    _fill(client, admin, writer)
    assert all(not item["embedded"] for item in _vectors().values())

    calls = _embedding_on(monkeypatch, 1, "m1")
    assert reindex.start_if_needed() is True
    done = reindex.status()
    assert done["running"] is False and done["failed"] == 0 and done["total"] == len(calls) > 5
    assert "Re-indexed" in done["message"]
    for table, item in _vectors().items():
        assert item["total"] >= 1 and item["embedded"] == item["total"], table
    assert db.fetchone("SELECT embedding_model AS m, chunk_count AS c, embedded_count AS e FROM guidelines") == {"m": "m1", "c": db.fetchone("SELECT chunk_count AS c FROM guidelines")["c"], "e": db.fetchone("SELECT chunk_count AS c FROM guidelines")["c"]}

    assert reindex.start_if_needed() is False  # nothing changed

    _embedding_on(monkeypatch, 2, "m2")
    assert reindex.start_if_needed() is True
    assert db.fetchone("SELECT embedding[1] AS first FROM systems LIMIT 1")["first"] == 2.0
    assert db.fetchone("SELECT embedding_model AS m FROM guidelines")["m"] == "m2"


def test_without_an_embedding_model_the_vectors_are_cleared(client, monkeypatch):
    monkeypatch.setattr(reindex, "_spawn", lambda job: job())
    admin, writer = login(client, "Admin"), login(client, "Write")
    _fill(client, admin, writer)
    _embedding_on(monkeypatch, 1, "m1")
    reindex.start_if_needed()
    monkeypatch.setattr("app.services.llm.embedding_configured", lambda: False)
    monkeypatch.setattr(reindex, "signature", lambda: "")
    assert reindex.start_if_needed() is True
    assert all(not item["embedded"] for item in _vectors().values())
    assert "No embedding model" in reindex.status()["message"]
    assert db.fetchone("SELECT embedding_model AS m, embedded_count AS e FROM guidelines") == {"m": "", "e": 0}


def test_failed_embeddings_are_counted_and_do_not_stop_the_run(client, monkeypatch):
    monkeypatch.setattr(reindex, "_spawn", lambda job: job())
    admin, writer = login(client, "Admin"), login(client, "Write")
    _fill(client, admin, writer)
    _embedding_on(monkeypatch, 1, "m1")
    seen = []

    def flaky(text):
        seen.append(text)
        return None if len(seen) % 2 else [1.0]

    monkeypatch.setattr("app.services.llm.embed", flaky)
    reindex.start_if_needed()
    state = reindex.status()
    assert state["done"] == state["total"] and state["failed"] > 0
    assert "could not be embedded" in state["message"]


def test_saving_llm_settings_starts_a_reindex_only_when_the_setup_changed(client, monkeypatch):
    started = []
    monkeypatch.setattr(reindex, "_spawn", lambda job: started.append(job))
    admin = auth(login(client, "Admin"))
    sig = {"value": ""}
    monkeypatch.setattr(reindex, "signature", lambda: sig["value"])

    client.put("/api/settings", json={"active_provider": "spirare", "global_system_prompt": "x"}, headers=admin)
    assert started == []  # nothing changed

    sig["value"] = "spirare|new-model||k"
    assert client.put("/api/settings/providers/spirare", json={"embedding_model": "new-model"}, headers=admin).status_code == 200
    assert len(started) == 1
    assert client.get("/api/reindex/status", headers=admin).json()["running"] is True

    client.put("/api/settings/providers/gemini", json={"chat_model": "other"}, headers=admin)
    assert len(started) == 1  # still the same running re-index


def test_changing_the_setup_during_a_run_queues_one_more_run(client, monkeypatch):
    jobs = []
    monkeypatch.setattr(reindex, "_spawn", lambda job: jobs.append(job))
    monkeypatch.setattr("app.services.llm.embedding_configured", lambda: True)
    monkeypatch.setattr("app.services.llm.embed", lambda text: [1.0])
    sig = {"value": "a"}
    monkeypatch.setattr(reindex, "signature", lambda: sig["value"])
    reindex.start_if_needed()
    sig["value"] = "b"
    reindex.start_if_needed()
    assert len(jobs) == 1
    jobs.pop(0)()  # the first run ends and starts the queued one
    assert len(jobs) == 1
    jobs.pop(0)()
    assert reindex.status()["running"] is False
    assert db.fetchone("SELECT indexed_embedding_signature AS s FROM app_settings")["s"] == "b"


def test_interface_upload_embeds_new_rows_in_the_background(client, monkeypatch):
    jobs = []
    monkeypatch.setattr(reindex, "_spawn", lambda job: jobs.append(job))
    admin = auth(login(client, "Admin"))
    for code in ("SPL", "DGE"):
        client.post("/api/systems", json={"system_code": code, "system_name": code}, headers=admin)
    _embedding_on(monkeypatch, 3)
    files = {"file": ("i.xlsx", _excel([["Get", "", "", "API", "SPL", "DGE"]]), "application/octet-stream")}
    assert client.post("/api/interfaces/SPL/upload", data={"country": "SG"}, files=files, headers=admin).status_code == 200
    assert len(jobs) == 1 and _vectors()["interfaces"]["embedded"] == 0
    jobs.pop(0)()
    assert _vectors()["interfaces"]["embedded"] == 1


def test_only_admin_can_read_the_reindex_status(client):
    assert client.get("/api/reindex/status", headers=auth(login(client, "Admin"))).status_code == 200
    for role in ("Write", "Read"):
        assert client.get("/api/reindex/status", headers=auth(login(client, role))).status_code == 403
