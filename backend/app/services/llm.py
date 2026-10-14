"""Public LLM facade. Everything else calls these functions; the active provider's adapter does the work."""

import logging

from app.errors import AppError, LLMNotConfigured

logger = logging.getLogger(__name__)


def _summary(exc: Exception) -> str:
    text = " ".join(str(exc).split()) or exc.__class__.__name__
    return text if len(text) <= 400 else text[:397] + "..."


def _adapter():
    from app.services.llm_settings import active_adapter

    return active_adapter()


def configured() -> bool:
    return _adapter().chat_configured()


def embedding_configured() -> bool:
    return _adapter().embedding_configured()


def complete(system: str, user: str, temperature: float) -> str:
    adapter = _adapter()
    if not adapter.chat_configured():
        raise LLMNotConfigured()
    try:
        return adapter.complete(system, user, temperature)
    except AppError:
        raise
    except Exception as exc:
        # Provider failures (billing, quota, bad key, outage) must reach the user as a readable message, not a bare 500.
        logger.exception("LLM request failed")
        raise AppError(502, f"The {adapter.provider or 'LLM'} provider rejected the request: {_summary(exc)}") from exc


def embed(text: str) -> list[float] | None:
    adapter = _adapter()
    if not adapter.embedding_configured():
        return None
    try:
        return adapter.embed(text)
    except Exception:
        logger.exception("Embedding request failed")
        return None
