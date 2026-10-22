"""LLM provider configuration: storage, encrypted API keys and the active-provider choice."""

import os

from app import cache, db
from app.crypto import decrypt, encrypt
from app.errors import AppError
from app.permissions import require
from app.services import gcs
from app.services.llm_adapters import ADAPTERS, LLMAdapter, ProviderConfig, build_adapter

PROVIDERS = tuple(ADAPTERS)
_URL_FIELDS = ("chat_base_url", "embedding_base_url")
_TEXT_FIELDS = ("chat_model", "chat_base_url", "embedding_model", "embedding_base_url")


def _stored_length(value) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 128000
    return number if number > 0 else 128000


def _max_model_length(value) -> int:
    text = str(value if value is not None else "").strip().replace(",", "")
    if not text.isdigit():
        raise AppError(400, "Max model length must be a whole number.")
    number = int(text)
    if number < 1024:
        raise AppError(400, "Max model length must be at least 1024.")
    if number > 2_000_000:
        raise AppError(400, "Max model length must be 2000000 or fewer.")
    return number


def _row(provider: str) -> dict:
    row = db.fetchone("SELECT * FROM llm_providers WHERE provider = ?", [provider])
    if row is None:
        raise AppError(404, "Unknown LLM provider")
    return row


def runtime_config(provider: str) -> ProviderConfig:
    """Decrypted settings for one provider. Never returned by the API."""
    row = _row(provider)
    api_key = decrypt(row["api_key_enc"])
    embedding_key = decrypt(row["embedding_api_key_enc"])
    if provider == "spirare":
        # Environment keys keep earlier single-provider setups working.
        api_key = api_key or os.environ.get("LLM_API_KEY", "")
        embedding_key = embedding_key or os.environ.get("EMBEDDING_API_KEY", "")
    verify_raw = row.get("verify_ssl")
    return ProviderConfig(
        provider=provider,
        chat_model=row["chat_model"],
        chat_base_url=row["chat_base_url"],
        embedding_model=row["embedding_model"],
        embedding_base_url=row["embedding_base_url"],
        api_key=api_key,
        embedding_api_key=embedding_key,
        verify_ssl=True if verify_raw is None else bool(verify_raw),
        max_model_length=_stored_length(row.get("max_model_length")),
    )


def active_provider() -> str:
    value = cache.get_settings().get("active_provider") or "spirare"
    return value if value in PROVIDERS else "spirare"


def active_adapter() -> LLMAdapter:
    return build_adapter(runtime_config(active_provider()))


def provider_payload(row: dict) -> dict:
    config = runtime_config(row["provider"])
    return {
        "provider": row["provider"],
        "label": row["label"],
        "chat_model": row["chat_model"],
        "chat_base_url": row["chat_base_url"],
        "embedding_model": row["embedding_model"],
        "embedding_base_url": row["embedding_base_url"],
        # The key itself is write-only; the API only says whether one exists.
        "api_key_configured": bool(config.api_key),
        "embedding_api_key_configured": bool(config.embedding_api_key),
        "verify_ssl": config.verify_ssl,
        "max_model_length": config.max_model_length,
        "updated_at": row["updated_at"],
    }


def settings_payload() -> dict:
    settings = cache.get_settings()
    rows = db.fetchall("SELECT * FROM llm_providers")
    order = {name: index for index, name in enumerate(PROVIDERS)}
    rows.sort(key=lambda item: order.get(item["provider"], 99))
    return {
        "active_provider": active_provider(),
        "global_system_prompt": settings["global_system_prompt"],
        "updated_at": settings["updated_at"],
        "providers": [provider_payload(row) for row in rows],
    }


def update_settings(user: dict, active: str, global_system_prompt: str) -> dict:
    _require_admin(user)
    if active not in PROVIDERS:
        raise AppError(400, "Unknown LLM provider")
    if not global_system_prompt.strip():
        raise AppError(400, "Global prompt is required")
    db.exec_sql(
        """
        UPDATE app_settings
        SET active_provider = ?, global_system_prompt = ?, updated_at = ?
        WHERE settings_id = 'default'
        """,
        [active, global_system_prompt, db._now()],
    )
    cache.invalidate()
    gcs.upload_db()
    _reindex_if_needed()
    return settings_payload()


def update_provider(user: dict, provider: str, body: dict) -> dict:
    _require_admin(user)
    _row(provider)
    assignments: list[str] = []
    params: list = []
    for field in _TEXT_FIELDS:
        if field not in body:
            continue
        value = str(body.get(field) or "").strip()
        if field in _URL_FIELDS and value and not value.startswith(("http://", "https://")):
            raise AppError(400, "URLs must start with http:// or https://")
        assignments.append(f"{field} = ?")
        params.append(value)
    # A blank key keeps the stored one; clear_* removes it.
    for field, column in (("api_key", "api_key_enc"), ("embedding_api_key", "embedding_api_key_enc")):
        incoming = str(body.get(field) or "").strip()
        if body.get(f"clear_{field}"):
            assignments.append(f"{column} = ?")
            params.append("")
        elif incoming:
            assignments.append(f"{column} = ?")
            params.append(encrypt(incoming))
    if provider == "spirare" and "verify_ssl" in body:
        assignments.append("verify_ssl = ?")
        params.append(bool(body.get("verify_ssl")))
    if provider == "spirare" and "max_model_length" in body:
        assignments.append("max_model_length = ?")
        params.append(_max_model_length(body.get("max_model_length")))
    if assignments:
        assignments.append("updated_at = ?")
        params.append(db._now())
        params.append(provider)
        db.exec_sql(f"UPDATE llm_providers SET {', '.join(assignments)} WHERE provider = ?", params)
        gcs.upload_db()
        _reindex_if_needed()
    return provider_payload(_row(provider))


def _reindex_if_needed() -> None:
    """Stored vectors belong to one embedding setup; re-make them when the active setup changes."""
    from app.services import reindex

    reindex.start_if_needed()


def _require_admin(user: dict) -> None:
    require(user, "settings", "write")
