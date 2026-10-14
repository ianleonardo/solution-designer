from app.services.llm_adapters.anthropic import AnthropicAdapter
from app.services.llm_adapters.base import LLMAdapter, ProviderConfig
from app.services.llm_adapters.gemini import GeminiAdapter
from app.services.llm_adapters.spirare import SpirareAdapter

ADAPTERS: dict[str, type[LLMAdapter]] = {
    "gemini": GeminiAdapter,
    "anthropic": AnthropicAdapter,
    "spirare": SpirareAdapter,
}


def build_adapter(config: ProviderConfig) -> LLMAdapter:
    try:
        return ADAPTERS[config.provider](config)
    except KeyError as exc:
        raise ValueError(f"Unknown LLM provider: {config.provider}") from exc


__all__ = ["ADAPTERS", "AnthropicAdapter", "GeminiAdapter", "LLMAdapter", "ProviderConfig", "SpirareAdapter", "build_adapter"]
