"""Active Directory sign-in. The directory address and search settings come from the environment."""

import os
from urllib.parse import urlparse

from app.errors import AppError


class _BindFailed(Exception):
    def __init__(self, description: str) -> None:
        super().__init__(description)
        self.description = description


def configured() -> bool:
    return bool(os.environ.get("LDAP_URL", "").strip())


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _flag(name: str) -> bool:
    return _env(name).lower() in {"1", "true", "yes", "y", "on"}


def escape_filter(value: str) -> str:
    """RFC 4515 escaping so a login ID cannot change the search filter."""
    return (
        value.replace("\\", r"\5c")
        .replace("*", r"\2a")
        .replace("(", r"\28")
        .replace(")", r"\29")
        .replace("\x00", r"\00")
    )


def authenticate(login_id: str, password: str) -> None:
    """Confirm this password with the directory. Raises 401 or 503; a success returns nothing."""
    if not configured():
        raise AppError(503, "LDAP is not configured.")
    if not password:
        raise AppError(401, "Invalid login ID or password")
    try:
        _bind_user(login_id.strip(), password)
    except AppError:
        raise
    except _BindFailed as exc:
        raise AppError(401, "Invalid login ID or password") from exc
    except Exception as exc:
        raise AppError(503, "The directory server could not be reached.") from exc


def _bind_user(login_id: str, password: str) -> None:
    from ldap3 import NONE, SUBTREE, Connection, Server
    from ldap3.core.exceptions import LDAPException

    parsed = urlparse(_env("LDAP_URL"))
    host = parsed.hostname
    if not host:
        raise AppError(503, "LDAP_URL is not a valid directory address.")
    use_ssl = parsed.scheme == "ldaps"
    port = parsed.port or (636 if use_ssl else 389)
    timeout = int(_env("LDAP_TIMEOUT_SECONDS") or "10")
    server = Server(host, port=port, use_ssl=use_ssl, get_info=NONE, connect_timeout=timeout)
    start_tls = _flag("LDAP_STARTTLS") and not use_ssl
    template = _env("LDAP_USER_DN")
    try:
        if template:
            _open(Connection, server, template.replace("{login_id}", login_id), password, timeout, start_tls).unbind()
            return
        base = _env("LDAP_BASE_DN")
        if not base:
            raise AppError(503, "Set LDAP_BASE_DN or LDAP_USER_DN so Active Directory users can be found.")
        try:
            service = _open(Connection, server, _env("LDAP_BIND_DN"), os.environ.get("LDAP_BIND_PASSWORD", ""), timeout, start_tls)
        except _BindFailed as exc:
            raise AppError(503, "The directory service account could not sign in.") from exc
        try:
            filt = _env("LDAP_USER_FILTER") or "(sAMAccountName={login_id})"
            service.search(
                base,
                filt.replace("{login_id}", escape_filter(login_id)),
                search_scope=SUBTREE,
                attributes=["distinguishedName"],
                size_limit=2,
            )
            entries = list(service.entries)
        finally:
            service.unbind()
        if len(entries) != 1:
            raise AppError(401, "Invalid login ID or password")
        _open(Connection, server, entries[0].entry_dn, password, timeout, start_tls).unbind()
    except _BindFailed:
        raise
    except AppError:
        raise
    except LDAPException as exc:
        raise AppError(503, "The directory server could not be reached.") from exc


def _open(connection_cls, server, user: str, password: str, timeout: int, start_tls: bool):
    conn = connection_cls(server, user=user or None, password=password, receive_timeout=timeout, auto_bind=False)
    if not conn.open():
        raise AppError(503, "The directory server could not be reached.")
    if start_tls and not conn.start_tls():
        conn.unbind()
        raise AppError(503, "The directory server could not start TLS.")
    if not conn.bind():
        description = str((conn.result or {}).get("description") or "bind failed")
        conn.unbind()
        raise _BindFailed(description)
    return conn
