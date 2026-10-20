from ldap3.core.exceptions import LDAPBindError, LDAPSocketOpenError

from app.errors import AppError
from app.services import ldap_auth


def test_login_id_is_escaped_inside_the_search_filter():
    assert ldap_auth.escape_filter("a*(b)\\c") == r"a\2a\28b\29\5cc"


def _directory(monkeypatch):
    monkeypatch.setenv("LDAP_HOST", "ad.example")
    monkeypatch.setenv("LDAP_PORT", "389")
    monkeypatch.setenv("LDAP_DOMAIN", "NTSGPDOM")
    monkeypatch.setenv("LDAP_BASE_DN", "DC=SG,DC=UOBNET,DC=COM")
    monkeypatch.delenv("LDAP_URL", raising=False)


def test_domain_bind_returns_the_directory_display_name(monkeypatch):
    _directory(monkeypatch)
    binds = []

    class Value:
        def __init__(self, value):
            self.value = value

    class Entry:
        def __getitem__(self, key):
            return Value({"displayName": "Ian Chen", "sAMAccountName": "ian"}[key])

    class FakeConnection:
        def __init__(self, server, user, password, receive_timeout, auto_bind):
            del server, receive_timeout, auto_bind
            binds.append((user, password))
            self.entries = []

        def search(self, base, search_filter, search_scope, attributes):
            assert base == "DC=SG,DC=UOBNET,DC=COM"
            assert search_filter == r"(&(objectClass=person)(sAMAccountName=ian\2a))"
            assert "displayName" in attributes
            self.entries = [Entry()]
            return True

        def unbind(self):
            return None

    monkeypatch.setattr("ldap3.Server", lambda *args, **kwargs: object())
    monkeypatch.setattr("ldap3.Connection", FakeConnection)
    assert ldap_auth.authenticate("ian*", "directory-secret") == "Ian Chen"
    assert binds == [(r"NTSGPDOM\ian*", "directory-secret")]


def test_a_rejected_bind_is_an_invalid_login(monkeypatch):
    _directory(monkeypatch)

    class FakeConnection:
        def __init__(self, server, user, password, receive_timeout, auto_bind):
            del server, user, password, receive_timeout, auto_bind
            raise LDAPBindError("invalidCredentials")

    monkeypatch.setattr("ldap3.Server", lambda *args, **kwargs: object())
    monkeypatch.setattr("ldap3.Connection", FakeConnection)
    try:
        ldap_auth.authenticate("ian", "wrong")
    except AppError as exc:
        assert exc.status == 401
    else:
        raise AssertionError("expected a 401")


def test_a_closed_directory_port_is_unavailable(monkeypatch):
    _directory(monkeypatch)

    class FakeConnection:
        def __init__(self, server, user, password, receive_timeout, auto_bind):
            del server, user, password, receive_timeout, auto_bind
            raise LDAPSocketOpenError("socket closed")

    monkeypatch.setattr("ldap3.Server", lambda *args, **kwargs: object())
    monkeypatch.setattr("ldap3.Connection", FakeConnection)
    try:
        ldap_auth.authenticate("ian", "secret")
    except AppError as exc:
        assert exc.status == 503
    else:
        raise AssertionError("expected a 503")
