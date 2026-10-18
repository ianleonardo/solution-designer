from app.services.llm_adapters.base import ProviderConfig
from app.services.llm_adapters.spirare import CHAT_URL, EMBEDDING_URL, SpirareAdapter


def _adapter(**overrides) -> SpirareAdapter:
    config = {
        "provider": "spirare",
        "chat_model": "default",
        "chat_base_url": CHAT_URL,
        "embedding_model": "/data/genai/models/bge-m3",
        "embedding_base_url": EMBEDDING_URL,
        "api_key": "chat-token",
        "embedding_api_key": "embed-token",
        "verify_ssl": False,
    }
    config.update(overrides)
    return SpirareAdapter(ProviderConfig(**config))


def test_spirare_posts_chat_and_embeddings(monkeypatch):
    calls = []

    class Response:
        status_code = 200
        text = ""

        def json(self):
            if calls[-1]["url"].endswith("/embeddings"):
                return {"data": [{"embedding": [0.1, 0.2]}]}
            return {"choices": [{"message": {"content": "Arlington, Texas"}}]}

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return Response()

    monkeypatch.setattr("httpx.post", fake_post)
    adapter = _adapter()

    assert adapter.complete("You are a helpful assistant.", "Where was it played?", 0.2) == "Arlington, Texas"
    chat = calls[0]
    assert chat["url"] == CHAT_URL
    assert chat["verify"] is False
    assert chat["headers"]["Authorization"] == "Bearer chat-token"
    assert chat["json"]["model"] == "default"
    assert chat["json"]["messages"][0] == {"role": "system", "content": "You are a helpful assistant."}
    assert chat["json"]["messages"][1]["role"] == "user"

    assert adapter.embed("what is apache") == [0.1, 0.2]
    embed = calls[1]
    assert embed["url"] == EMBEDDING_URL
    assert embed["verify"] is False
    assert embed["headers"]["Authorization"] == "Bearer embed-token"
    assert embed["json"] == {
        "input": "what is apache",
        "model": "/data/genai/models/bge-m3",
        "encoding_format": "float",
        "input_type": "passage",
    }


def test_spirare_appends_paths_to_a_base_url(monkeypatch):
    seen = {}

    class Response:
        status_code = 200
        text = ""

        def json(self):
            return {"choices": [{"message": {"content": "ok"}}]}

    def fake_post(url, **kwargs):
        seen["url"] = url
        seen["verify"] = kwargs["verify"]
        return Response()

    monkeypatch.setattr("httpx.post", fake_post)
    adapter = _adapter(chat_base_url="https://example.test/wip/v1", verify_ssl=True)
    adapter.complete("s", "u", 0)
    assert seen["url"] == "https://example.test/wip/v1/chat/completions"
    assert seen["verify"] is True
