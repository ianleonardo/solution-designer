import importlib

from fastapi.testclient import TestClient


def test_duckdb_path_can_name_any_file(tmp_path, monkeypatch):
    from app import config

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("DUCKDB_PATH", raising=False)
    assert config.db_path() == tmp_path / "data" / "solutioncrafter.duckdb"
    monkeypatch.setenv("DUCKDB_PATH", str(tmp_path / "elsewhere" / "specforge-prod.duckdb"))
    assert config.db_path() == tmp_path / "elsewhere" / "specforge-prod.duckdb"


def test_built_frontend_is_served_next_to_the_api(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>SpecForge</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("no")
    monkeypatch.setenv("FRONTEND_DIR", str(dist))
    import app.main as main

    module = importlib.reload(main)
    try:
        client = TestClient(module.app)
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/assets/app.js").text == "console.log(1)"
        page = client.get("/projects/p1/documents/d1")  # a page of the single-page app
        assert page.status_code == 200 and "SpecForge" in page.text
        assert client.get("/api/nope").status_code == 404
        assert "no" != client.get("/../secret.txt").text
    finally:
        monkeypatch.delenv("FRONTEND_DIR")
        importlib.reload(main)
