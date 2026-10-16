import pytest
from app.config import DEFAULT_USERS
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-with-32-bytes-min")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("EMBEDDING_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GCS_BUCKET", raising=False)
    from app import cache, db
    from app.main import app
    from app.services import reindex

    # Re-index runs in a background thread in production; tests start it themselves when they need it.
    monkeypatch.setattr(reindex, "_spawn", lambda job: None)
    reindex.reset()
    db.reset()
    cache.invalidate()
    with TestClient(app) as test_client:
        yield test_client
    db.reset()
    cache.invalidate()


def _user(role: str) -> dict:
    alias = {"Write": "Analyst", "Read": "Viewer"}.get(role, role)
    return next(user for user in DEFAULT_USERS if user["role"] == alias)


def login(client: TestClient, role: str) -> str:
    user = _user(role)
    response = client.post("/api/auth/login", json={"login_id": user["login_id"], "password": user["password"]})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
