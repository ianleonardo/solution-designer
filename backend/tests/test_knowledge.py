from tests.conftest import auth, login

TABLE = b"| Name | Purpose |\n| --- | --- |\n| Login screen | Authenticate users |\n| Nightly settle | Settle trades |\n"


def _upload(client, token, inventory_type, filename="items.md", body=TABLE):
    return client.post(
        "/api/rag",
        params={"inventory_type": inventory_type} if inventory_type else None,
        files={"file": (filename, body, "text/markdown")},
        headers=auth(token),
    )


def test_upload_is_forced_to_the_selected_type(client):
    admin = login(client, "Admin")
    screens = _upload(client, admin, "Screens")
    assert screens.status_code == 200, screens.text
    rows = screens.json()
    assert len(rows) == 2
    assert {row["inventory_type"] for row in rows} == {"Screens"}
    assert all(row["rag_id"].startswith("SC-") for row in rows)
    capabilities = _upload(client, admin, "Capabilities", filename="caps.md")
    assert capabilities.status_code == 400
    assert "capabilities" in capabilities.json()["detail"].lower()
    blocked = _upload(client, admin, "Batches", filename="jobs.md")
    assert blocked.status_code == 400
    assert "batches" in blocked.json()["detail"].lower()


def test_heading_classification_still_works_without_a_type(client):
    admin = login(client, "Admin")
    body = b"# Screens\n| Name | Purpose |\n| --- | --- |\n| Login | Authenticate |\n"
    created = _upload(client, admin, None, body=body)
    assert created.json()[0]["inventory_type"] == "Screens"


def test_unknown_inventory_type_is_rejected(client):
    admin = login(client, "Admin")
    assert _upload(client, admin, "Nonsense").status_code == 400


def test_analyst_can_upload_and_viewer_cannot_upload_to_the_knowledge_base(client):
    analyst = login(client, "Analyst")
    assert _upload(client, analyst, "Screens").status_code == 200
    viewer = login(client, "Viewer")
    assert client.get("/api/rag", headers=auth(viewer)).status_code == 200
    assert _upload(client, viewer, "Screens").status_code == 403
