import httpx

from app.services.llm_adapters.base import LLMAdapter

CHAT_URL = "https://is-egp.sg.uobnet.com/wip/v1/chat/completions"
EMBEDDING_URL = "https://is-egp.sg.uobnet.com/embedding/v1/embeddings"


def _endpoint(url: str, suffix: str) -> str:
    """Use a full endpoint as given, or append the OpenAI-style path to a base URL."""
    cleaned = (url or "").strip().rstrip("/")
    if not cleaned:
        return ""
    if cleaned.endswith(suffix):
        return cleaned
    return f"{cleaned}/{suffix}"


class SpirareAdapter(LLMAdapter):
    """Spirare chat completions and embeddings, including the extra embedding fields it requires."""

    provider = "spirare"

    def _post(self, url: str, payload: dict, api_key: str) -> dict:
        if not url:
            raise RuntimeError("Spirare URL is not configured.")
        response = httpx.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=120,
            verify=self.config.verify_ssl,
        )
        if response.status_code >= 400:
            detail = " ".join(response.text.split())
            if len(detail) > 300:
                detail = detail[:297] + "..."
            raise RuntimeError(f"Spirare returned HTTP {response.status_code}: {detail or 'request failed'}")
        return response.json()

    def complete(self, system: str, user: str, temperature: float) -> str:
        url = _endpoint(self.config.chat_base_url, "chat/completions")
        body = self._post(
            url,
            {
                "model": self.config.chat_model,
                "temperature": temperature,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
            self.config.api_key,
        )
        message = ((body.get("choices") or [{}])[0].get("message") or {})
        return str(message.get("content") or "")

    def embed(self, text: str) -> list[float] | None:
        if not self.embedding_configured():
            return None
        url = _endpoint(self.config.embedding_base_url or self.config.chat_base_url, "embeddings")
        body = self._post(
            url,
            {
                "input": text[:2000],
                "model": self.config.embedding_model,
                "encoding_format": "float",
                "input_type": "passage",
            },
            self.embedding_key,
        )
        data = body.get("data") or []
        if not data:
            return None
        return [float(value) for value in data[0].get("embedding") or []]
