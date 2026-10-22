from app.services.llm_adapters.base import ProviderConfig
from app.services.llm_adapters.spirare import (
    CHAT_URL,
    CONTEXT_LIMIT,
    EMBEDDING_URL,
    OUTPUT_TOKENS,
    SpirareAdapter,
    _estimate_tokens,
    fit_chat,
)


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


def test_spirare_keeps_prompt_and_output_inside_the_context_window():
    system, user, max_tokens = fit_chat("You are a helpful assistant.", "Where was it played?")
    assert user == "Where was it played?"
    assert max_tokens == OUTPUT_TOKENS

    question = "\n\nQUESTION:\nWhich system owns payments?"
    long_user = ("context " * 60000) + question
    system, user, max_tokens = fit_chat("system", long_user)
    assert len(user) < len(long_user)
    assert user.endswith("Which system owns payments?")
    assert "omitted" in user
    assert _estimate_tokens(system) + _estimate_tokens(user) + max_tokens + 32 <= CONTEXT_LIMIT
    assert max_tokens >= 256


def test_spirare_retries_when_the_server_still_reports_a_context_overflow(monkeypatch):
    calls = []

    class Response:
        def __init__(self, status, text, body=None):
            self.status_code = status
            self.text = text
            self._body = body or {}

        def json(self):
            return self._body

    def fake_post(url, **kwargs):
        calls.append(kwargs["json"])
        if len(calls) == 1:
            return Response(400, "maximum context length is 32768 but requested output and prompt token exceeded")
        return Response(200, "", {"choices": [{"message": {"content": "short answer"}}]})

    monkeypatch.setattr("httpx.post", fake_post)
    assert _adapter().complete("system", "question", 0.2) == "short answer"
    assert calls[0]["max_tokens"] == OUTPUT_TOKENS
    assert calls[1]["max_tokens"] < calls[0]["max_tokens"]
    assert len(calls[1]["messages"][1]["content"]) <= len(calls[0]["messages"][1]["content"])


def test_chat_uses_the_configured_max_model_length():
    question = "\n\nQUESTION:\nWhich system owns payments?"
    long_user = ("context " * 8000) + question
    _kept_system, kept_user, _kept_tokens = fit_chat("system", long_user, 128000)
    assert kept_user == long_user
    system, clipped, max_tokens = fit_chat("system", long_user, 8000)
    assert len(clipped) < len(long_user)
    assert clipped.endswith("Which system owns payments?")
    assert _estimate_tokens(system) + _estimate_tokens(clipped) + max_tokens + 32 <= 8000
