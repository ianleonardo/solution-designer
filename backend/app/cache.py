from app import db

_settings: dict | None = None
_templates: list[dict] | None = None


def get_settings() -> dict:
    global _settings
    if _settings is None:
        _settings = db.fetch_settings()
    return _settings


def get_all_templates() -> list[dict]:
    global _templates
    if _templates is None:
        _templates = db.fetch_templates()
    return _templates


def get_templates(layout_id: str = "sdd") -> list[dict]:
    return [item for item in get_all_templates() if (item.get("layout_id") or "sdd") == layout_id]


def invalidate() -> None:
    global _settings, _templates
    _settings = None
    _templates = None
