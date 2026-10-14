import pytest
from app import db
from app.crypto import decrypt, encrypt
from app.errors import LLMNotConfigured
from app.services import llm
from app.services.llm_adapters import ADAPTERS, LLMAdapter
from tests.conftest import auth, login

SECRET = "sk-super-secret-value-123"


def _provider(body, name):
    return next(item for item in body["providers"] if item["provider"] == name)


def test_settings_list_three_providers_without_secrets(client):
    admin = login(client, "Admin")
    body = client.get("/api/settings", headers=auth(admin)).json()
    assert [item["provider"] for item in body["providers"]] == ["gemini", "anthropic", "spirare"]
    assert body["active_provider"] == "spirare"
    for item in body["providers"]:
        assert item["api_key_configured"] is False
        assert "api_key" not in item
        assert "api_key_enc" not in item


def test_api_key_is_encrypted_at_rest_and_never_returned(client):
    admin = login(client, "Admin")
    saved = client.put(
        "/api/settings/providers/gemini",
        json={"api_key": SECRET, "chat_model": "gemini-2.5-pro", "embedding_api_key": "embed-secret-456"},
        headers=auth(admin),
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["api_key_configured"] is True
    assert saved.json()["embedding_api_key_configured"] is True
    assert saved.json()["chat_model"] == "gemini-2.5-pro"
    assert SECRET not in saved.text
    listing = client.get("/api/settings", headers=auth(admin))
    assert SECRET not in listing.text
    assert "embed-secret-456" not in listing.text
    stored = db.fetchone("SELECT api_key_enc, embedding_api_key_enc FROM llm_providers WHERE provider = 'gemini'")
    assert stored["api_key_enc"] and SECRET not in stored["api_key_enc"]
    assert decrypt(stored["api_key_enc"]) == SECRET


def test_blank_key_keeps_existing_and_clear_removes_it(client):
    admin = login(client, "Admin")
    headers = auth(admin)
    client.put("/api/settings/providers/anthropic", json={"api_key": SECRET}, headers=headers)
    kept = client.put("/api/settings/providers/anthropic", json={"api_key": "", "chat_model": "claude-x"}, headers=headers)
    assert kept.json()["api_key_configured"] is True
    cleared = client.put("/api/settings/providers/anthropic", json={"clear_api_key": True}, headers=headers)
    assert cleared.json()["api_key_configured"] is False


def test_provider_validation_and_permissions(client):
    admin = login(client, "Admin")
    writer = login(client, "Write")
    assert client.put("/api/settings/providers/nope", json={}, headers=auth(admin)).status_code == 404
    bad_url = client.put("/api/settings/providers/spirare", json={"chat_base_url": "ftp://x"}, headers=auth(admin))
    assert bad_url.status_code == 400
    assert client.put("/api/settings/providers/spirare", json={"api_key": "x"}, headers=auth(writer)).status_code == 403
    assert client.get("/api/settings", headers=auth(writer)).status_code == 403
    prompt = client.get("/api/settings", headers=auth(admin)).json()["global_system_prompt"]
    assert client.put("/api/settings", json={"active_provider": "bogus", "global_system_prompt": prompt}, headers=auth(admin)).status_code == 400
    assert client.put("/api/settings", json={"active_provider": "gemini", "global_system_prompt": " "}, headers=auth(admin)).status_code == 400


def test_encryption_round_trip():
    token = encrypt("hello")
    assert token != "hello"
    assert decrypt(token) == "hello"
    assert encrypt("") == ""
    assert decrypt("not-a-token") == ""


class FakeAdapter(LLMAdapter):
    seen: list = []

    def complete(self, system, user, temperature):
        FakeAdapter.seen.append((self.provider, self.config, system, user, temperature))
        return f"reply from {self.provider}"

    def embed(self, text):
        return [1.0, 0.0]


def _fake_adapters(monkeypatch):
    FakeAdapter.seen = []
    for name in ADAPTERS:
        monkeypatch.setitem(ADAPTERS, name, type(f"Fake_{name}", (FakeAdapter,), {"provider": name}))


def test_facade_routes_to_the_active_provider_adapter(client, monkeypatch):
    _fake_adapters(monkeypatch)
    admin = login(client, "Admin")
    headers = auth(admin)
    prompt = client.get("/api/settings", headers=headers).json()["global_system_prompt"]
    assert llm.configured() is False
    with pytest.raises(LLMNotConfigured):
        llm.complete("s", "u", 0)

    client.put("/api/settings/providers/anthropic", json={"api_key": SECRET, "chat_model": "claude-test"}, headers=headers)
    client.put("/api/settings", json={"active_provider": "anthropic", "global_system_prompt": prompt}, headers=headers)
    assert llm.configured() is True
    assert llm.complete("sys", "usr", 0.3) == "reply from anthropic"
    provider, config, *_ = FakeAdapter.seen[-1]
    assert provider == "anthropic"
    assert config.api_key == SECRET
    assert config.chat_model == "claude-test"

    client.put("/api/settings/providers/gemini", json={"api_key": "g-key"}, headers=headers)
    client.put("/api/settings", json={"active_provider": "gemini", "global_system_prompt": prompt}, headers=headers)
    assert llm.complete("sys", "usr", 0) == "reply from gemini"
    assert FakeAdapter.seen[-1][1].api_key == "g-key"


def test_spirare_falls_back_to_the_environment_key(client, monkeypatch):
    _fake_adapters(monkeypatch)
    login(client, "Admin")
    assert llm.configured() is False
    monkeypatch.setenv("LLM_API_KEY", "env-key")
    assert llm.configured() is True
    llm.complete("s", "u", 0)
    assert FakeAdapter.seen[-1][1].api_key == "env-key"


def test_embeddings_need_a_model_and_key(client, monkeypatch):
    _fake_adapters(monkeypatch)
    admin = login(client, "Admin")
    assert llm.embedding_configured() is False
    assert llm.embed("text") is None
    client.put("/api/settings/providers/spirare", json={"api_key": SECRET}, headers=auth(admin))
    assert llm.embedding_configured() is True
    assert llm.embed("text") == [1.0, 0.0]


def test_anthropic_embeddings_use_the_configured_voyage_style_endpoint(client, monkeypatch):
    admin = login(client, "Admin")
    headers = auth(admin)
    prompt = client.get("/api/settings", headers=headers).json()["global_system_prompt"]
    client.put(
        "/api/settings/providers/anthropic",
        json={
            "api_key": "chat-key",
            "embedding_api_key": "voyage-key",
            "embedding_model": "voyage-3.5",
            "embedding_base_url": "https://api.voyageai.com/v1",
        },
        headers=headers,
    )
    client.put("/api/settings", json={"active_provider": "anthropic", "global_system_prompt": prompt}, headers=headers)
    calls = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"data": [{"embedding": [0.1, 0.2, 0.3]}]}

    def fake_post(url, headers, json, timeout):
        calls.update(url=url, headers=headers, json=json)
        return FakeResponse()

    monkeypatch.setattr("httpx.post", fake_post)
    assert llm.embedding_configured() is True
    assert llm.embed("hello") == [0.1, 0.2, 0.3]
    assert calls["url"] == "https://api.voyageai.com/v1/embeddings"
    assert calls["headers"]["Authorization"] == "Bearer voyage-key"
    assert calls["json"] == {"model": "voyage-3.5", "input": ["hello"]}


def test_anthropic_without_an_embedding_endpoint_is_lexical_only(client):
    admin = login(client, "Admin")
    headers = auth(admin)
    prompt = client.get("/api/settings", headers=headers).json()["global_system_prompt"]
    client.put("/api/settings/providers/anthropic", json={"api_key": "chat-key"}, headers=headers)
    client.put("/api/settings", json={"active_provider": "anthropic", "global_system_prompt": prompt}, headers=headers)
    assert llm.configured() is True
    assert llm.embedding_configured() is False


def test_untouched_legacy_global_prompt_is_upgraded_but_edits_are_kept(client):
    from app import cache, db
    from app.config import GLOBAL_PROMPT, LEGACY_GLOBAL_PROMPT

    def stored():
        return db.fetchone("SELECT global_system_prompt FROM app_settings WHERE settings_id = 'default'")["global_system_prompt"]

    db.exec_sql("UPDATE app_settings SET global_system_prompt = ?", [LEGACY_GLOBAL_PROMPT])
    db._seed()
    cache.invalidate()
    assert stored() == GLOBAL_PROMPT
    assert "JSON" not in stored()

    db.exec_sql("UPDATE app_settings SET global_system_prompt = ?", ["Our own house rules"])
    db._seed()
    assert stored() == "Our own house rules"
