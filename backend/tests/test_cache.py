from tests.conftest import auth, login


def test_settings_cache_refreshes_after_admin_write(client, monkeypatch):
    from app import cache, db

    cache.invalidate()
    calls = {"n": 0}
    real = db.fetch_settings

    def wrapped():
        calls["n"] += 1
        return real()

    monkeypatch.setattr(db, "fetch_settings", wrapped)
    admin = login(client, "Admin")
    headers = auth(admin)
    first = client.get("/api/settings", headers=headers)
    assert first.status_code == 200
    second = client.get("/api/settings", headers=headers)
    assert second.json()["active_provider"] == first.json()["active_provider"]
    assert calls["n"] == 1
    updated = client.put(
        "/api/settings",
        json={
            "active_provider": "gemini",
            "global_system_prompt": first.json()["global_system_prompt"],
        },
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["active_provider"] == "gemini"
    assert calls["n"] == 2
    cached = client.get("/api/settings", headers=headers)
    assert cached.json()["active_provider"] == "gemini"
    assert calls["n"] == 2
    maker = login(client, "Maker")
    assert client.put("/api/templates/order", json={"template_ids": []}, headers=auth(maker)).status_code == 403
