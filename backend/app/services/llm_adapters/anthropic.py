from app.services.llm_adapters.base import LLMAdapter, message_text


class AnthropicAdapter(LLMAdapter):
    """Anthropic Claude for chat.

    Anthropic has no embeddings API, so embeddings use a Voyage-style
    `POST {embedding_base_url}/embeddings` endpoint with its own key.
    """

    provider = "anthropic"

    def complete(self, system: str, user: str, temperature: float) -> str:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import HumanMessage, SystemMessage

        kwargs = {
            "model": self.config.chat_model,
            "temperature": temperature,
            "api_key": self.config.api_key,
            "max_tokens": 4096,
        }
        if self.config.chat_base_url:
            kwargs["base_url"] = self.config.chat_base_url
        model = ChatAnthropic(**kwargs)
        result = model.invoke([SystemMessage(content=system), HumanMessage(content=user)])
        return message_text(result.content)

    def embedding_configured(self) -> bool:
        return bool(self.embedding_key and self.config.embedding_model and self.config.embedding_base_url)

    def embed(self, text: str) -> list[float] | None:
        if not self.embedding_configured():
            return None
        import httpx

        response = httpx.post(
            f"{self.config.embedding_base_url.rstrip('/')}/embeddings",
            headers={"Authorization": f"Bearer {self.embedding_key}", "Content-Type": "application/json"},
            json={"model": self.config.embedding_model, "input": [text[:2000]]},
            timeout=30,
        )
        response.raise_for_status()
        return list(response.json()["data"][0]["embedding"])
