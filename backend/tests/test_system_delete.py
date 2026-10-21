from app import db
from tests.conftest import auth, login


def test_deleting_a_system_removes_its_capabilities_batches_and_reports(client):
    admin = auth(login(client, "Admin"))
    for code, name in (("SPL", "Spending"), ("DGE", "Digital")):
        client.post(
            "/api/systems",
            json={"system_code": code, "system_name": name, "has_batch": True, "has_report": True, "has_capability": True},
            headers=admin,
        )
    db.exec_sql("UPDATE systems SET upstreams = 'SPL' WHERE system_code = 'DGE'")  # set by uploads, not by create
    capability = client.post(
        "/api/capabilities", json={"country": "SG", "system_code": "SPL", "l1_capability": "Pay", "l2_capability": "Card", "l3_capability": "Auth"}, headers=admin
    ).json()
    other = client.post(
        "/api/capabilities", json={"country": "SG", "system_code": "DGE", "l1_capability": "Web", "l2_capability": "Login", "l3_capability": "OTP"}, headers=admin
    ).json()
    table = client.post("/api/tables", json={"country": "SG", "database_name": "PIB", "schema_name": "DBO", "table_name": "ACCT"}, headers=admin).json()
    client.post(f"/api/capabilities/{capability['capability_id']}/tables/{table['table_id']}", headers=admin)
    client.post(f"/api/capabilities/{other['capability_id']}/tables/{table['table_id']}", headers=admin)
    batch = client.post(
        "/api/batches", json={"country": "SG", "system_code": "SPL", "batch_name": "Nightly", "batch_type": "incoming"}, headers=admin
    )
    assert batch.status_code == 200, batch.text
    peer_batch = client.post(
        "/api/batches",
        json={"country": "SG", "system_code": "DGE", "batch_name": "Feed", "batch_type": "outgoing", "to_from_systems": "SPL"},
        headers=admin,
    )
    assert peer_batch.status_code == 200, peer_batch.text
    report = client.post(
        "/api/reports", json={"country": "SG", "system_code": "SPL", "report_code": "R1", "report_name": "Daily", "layout": "A"}, headers=admin
    )
    assert report.status_code == 200, report.text
    project = client.post("/api/projects", json={"project_name": "Cards", "systems": ["SPL", "DGE"]}, headers=admin).json()

    impact = client.get("/api/systems/SPL/delete-impact", headers=admin).json()
    assert [row["l3_capability"] for row in impact["capabilities"]] == ["Auth"]
    assert [row["batch_name"] for row in impact["batches"]] == ["Nightly"]
    assert [row["report_name"] for row in impact["reports"]] == ["Daily"]
    assert [row["table_name"] for row in impact["unlinked_tables"]] == ["ACCT"]
    assert impact["systems_referencing"] == ["DGE"]
    assert impact["batches_referencing"] == ["Feed"]
    assert impact["projects_in_scope"] == ["Cards"]

    assert client.delete("/api/systems/SPL", headers=admin).status_code == 400  # no confirmation
    assert client.delete("/api/systems/SPL?confirm=DGE", headers=admin).status_code == 400
    viewer = auth(login(client, "Viewer"))
    assert client.delete("/api/systems/SPL?confirm=SPL", headers=viewer).status_code == 403
    done = client.delete("/api/systems/SPL?confirm=spl", headers=admin)
    assert done.status_code == 200, done.text
    assert done.json()["deleted"] == {"capabilities": 1, "batches": 1, "reports": 1}

    assert [row["system_code"] for row in client.get("/api/capabilities", headers=admin).json()] == ["DGE"]
    assert [row["batch_name"] for row in client.get("/api/batches", headers=admin).json()] == ["Feed"]
    assert client.get("/api/batches", headers=admin).json()[0]["to_from_systems"] == ""
    assert client.get("/api/reports", headers=admin).json() == []
    # the table stays, still linked to the other system's capability
    assert [row["table_name"] for row in client.get("/api/tables", headers=admin).json()] == ["ACCT"]
    assert [row["table_id"] for row in client.get(f"/api/capabilities/{other['capability_id']}", headers=admin).json()["tables"]] == [table["table_id"]]
    systems = {row["system_code"]: row for row in client.get("/api/systems", headers=admin).json()}
    assert list(systems) == ["DGE"] and systems["DGE"]["upstreams"] == ""
    assert client.get(f"/api/projects/{project['project_id']}", headers=admin).json()["systems"] == ["DGE"]
