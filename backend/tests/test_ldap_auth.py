from app.errors import AppError
from app.services import ldap_auth


def test_login_id_is_escaped_inside_the_search_filter():
    assert ldap_auth.escape_filter("a*(b)\\c") == r"a\2a\28b\29\5cc"


def test_user_dn_template_binds_with_the_login_id(monkeypatch):
    monkeypatch.setenv("LDAP_URL", "ldap://ad.example:389")
    monkeypatch.setenv("LDAP_USER_DN", "CN={login_id},OU=Users,DC=example,DC=com")
    binds = []

    class FakeConnection:
        def __init__(self, server, user, password, receive_timeout, auto_bind):
            del server, receive_timeout, auto_bind
            self.user = user
            self.password = password

        def open(self):
            return True

        def bind(self):
            binds.append((self.user, self.password))
            return True

        def unbind(self):
            return None

    monkeypatch.setattr("ldap3.Server", lambda *args, **kwargs: object())
    monkeypatch.setattr("ldap3.Connection", FakeConnection)
    ldap_auth.authenticate("ian", "directory-secret")
    assert binds == [("CN=ian,OU=Users,DC=example,DC=com", "directory-secret")]


def test_search_then_binds_as_the_directory_user(monkeypatch):
    monkeypatch.setenv("LDAP_URL", "ldaps://ad.example:636")
    monkeypatch.setenv("LDAP_BASE_DN", "DC=example,DC=com")
    monkeypatch.setenv("LDAP_BIND_DN", "CN=svc,DC=example,DC=com")
    monkeypatch.setenv("LDAP_BIND_PASSWORD", "svc-secret")
    monkeypatch.delenv("LDAP_USER_DN", raising=False)
    binds = []

    class Entry:
        entry_dn = "CN=Ian,OU=Users,DC=example,DC=com"

    class FakeConnection:
        def __init__(self, server, user, password, receive_timeout, auto_bind):
            del server, receive_timeout, auto_bind
            self.user = user
            self.password = password
            self.entries = []

        def open(self):
            return True

        def bind(self):
            binds.append((self.user, self.password))
            return self.user != "CN=missing,DC=example,DC=com"

        def search(self, base, search_filter, search_scope, attributes, size_limit):
            assert base == "DC=example,DC=com"
            assert search_filter == r"(sAMAccountName=ian\2a)"
            assert size_limit == 2
            self.entries = [Entry()]
            return True

        def unbind(self):
            return None

    monkeypatch.setattr("ldap3.Server", lambda *args, **kwargs: object())
    monkeypatch.setattr("ldap3.Connection", FakeConnection)
    ldap_auth.authenticate("ian*", "user-secret")
    assert binds[0] == ("CN=svc,DC=example,DC=com", "svc-secret")
    assert binds[1] == ("CN=Ian,OU=Users,DC=example,DC=com", "user-secret")


def test_a_rejected_user_bind_is_an_invalid_login(monkeypatch):
    monkeypatch.setenv("LDAP_URL", "ldap://ad.example:389")
    monkeypatch.setenv("LDAP_USER_DN", "CN={login_id},DC=example,DC=com")

    class FakeConnection:
        def __init__(self, server, user, password, receive_timeout, auto_bind):
            del server, user, password, receive_timeout, auto_bind
            self.result = {"description": "invalidCredentials"}

        def open(self):
            return True

        def bind(self):
            return False

        def unbind(self):
            return None

    monkeypatch.setattr("ldap3.Server", lambda *args, **kwargs: object())
    monkeypatch.setattr("ldap3.Connection", FakeConnection)
    try:
        ldap_auth.authenticate("ian", "wrong")
    except AppError as exc:
        assert exc.status == 401
    else:
        raise AssertionError("expected a 401")
