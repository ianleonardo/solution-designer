from tests.conftest import auth, login

FLOW = "sequenceDiagram\n  A->>B: hi"


def _setup(client):
    admin = auth(login(client, "Admin"))
    client.post("/api/systems", json={"system_code": "SPL", "system_name": "Spending", "has_capability": True}, headers=admin)
    for country, l2, l3 in (("SG", "Card", "Auth"), ("SG", "Card", "Capture"), ("MY", "Card", "Auth"), ("SG", "Wallet", "Top up")):
        response = client.post(
            "/api/capabilities",
            json={"country": country, "system_code": "SPL", "l1_capability": "Payments", "l2_capability": l2, "l3_capability": l3},
            headers=admin,
        )
        assert response.status_code == 200, response.text
    return admin


def test_l1_and_l2_details_with_countries_and_diagrams(client):
    admin = _setup(client)
    viewer = auth(login(client, "Viewer"))

    l1 = client.post(
        "/api/capability-nodes",
        json={
            "system_code": "SPL",
            "level": 1,
            "l1_capability": "payments",
            "l2_capability": "ignored for L1",
            "country": "",
            "description": "Everything about moving money.",
            "sequence_diagrams": [{"title": "Overview", "mermaid": FLOW}],
        },
        headers=admin,
    )
    assert l1.status_code == 200, l1.text
    body = l1.json()
    assert body["level"] == 1 and body["l1_capability"] == "Payments" and body["l2_capability"] == ""
    assert body["country"] == "" and body["l3_count"] == 4
    assert body["sequence_diagrams"][0]["title"] == "Overview"

    sg = client.post(
        "/api/capability-nodes",
        json={"system_code": "SPL", "level": 2, "l1_capability": "Payments", "l2_capability": "Card", "country": "SG", "description": "Cards in SG"},
        headers=admin,
    )
    assert sg.status_code == 200, sg.text
    assert sg.json()["l3_count"] == 3  # counted across countries
    # Another record for the same node may not cover SG again, nor every country.
    for country in ("SG,MY", ""):
        clash = client.post(
            "/api/capability-nodes",
            json={"system_code": "SPL", "level": 2, "l1_capability": "Payments", "l2_capability": "card", "country": country},
            headers=admin,
        )
        assert clash.status_code == 400 and "already has details" in clash.json()["detail"]
    my = client.post(
        "/api/capability-nodes",
        json={"system_code": "SPL", "level": 2, "l1_capability": "Payments", "l2_capability": "Card", "country": "MY", "country_behavior": "MY rules"},
        headers=admin,
    )
    assert my.status_code == 200, my.text

    bad = client.post(
        "/api/capability-nodes",
        json={"system_code": "SPL", "level": 3, "l1_capability": "Payments"},
        headers=admin,
    )
    assert bad.status_code == 400
    no_l2 = client.post("/api/capability-nodes", json={"system_code": "SPL", "level": 2, "l1_capability": "Payments"}, headers=admin)
    assert no_l2.status_code == 400

    listed = client.get("/api/capability-nodes", params={"system": "SPL"}, headers=viewer)
    assert listed.status_code == 200
    assert [(row["level"], row["l2_capability"], row["country"]) for row in listed.json()] == [(1, "", ""), (2, "Card", "MY"), (2, "Card", "SG")]

    # Viewers read only.
    assert client.post("/api/capability-nodes", json={"system_code": "SPL", "level": 1, "l1_capability": "X"}, headers=viewer).status_code == 403
    node_id = sg.json()["node_id"]
    assert client.patch(f"/api/capability-nodes/{node_id}", json={"description": "x"}, headers=viewer).status_code == 403

    # Edit keeps the node it belongs to; countries may not overlap the MY record.
    updated = client.patch(
        f"/api/capability-nodes/{node_id}",
        json={"description": "Card payments", "l2_capability": "Wallet", "sequence_diagrams": [{"title": "Flow", "mermaid": FLOW}]},
        headers=admin,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["l2_capability"] == "Card" and updated.json()["description"] == "Card payments"
    assert updated.json()["sequence_diagrams"][0]["title"] == "Flow"
    overlap = client.patch(f"/api/capability-nodes/{node_id}", json={"country": "SG,MY"}, headers=admin)
    assert overlap.status_code == 400

    bad_diagram = client.patch(f"/api/capability-nodes/{node_id}", json={"sequence_diagrams": [{"title": "x", "mermaid": "not mermaid"}]}, headers=admin)
    assert bad_diagram.status_code == 400

    md = client.get(f"/api/capability-nodes/{node_id}/export", params={"format": "md"}, headers=viewer)
    assert md.status_code == 200
    assert "# L2 — Payments / Card" in md.text and "```mermaid" in md.text and "**Applicable for:** SG" in md.text
    pdf = client.get(f"/api/capability-nodes/{node_id}/export", params={"format": "pdf"}, headers=viewer)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    assert client.delete(f"/api/capability-nodes/{node_id}", headers=admin).status_code == 200
    assert client.get(f"/api/capability-nodes/{node_id}", headers=viewer).status_code == 404


def test_rename_moves_l3_rows_and_details(client):
    admin = _setup(client)
    client.post("/api/capability-nodes", json={"system_code": "SPL", "level": 1, "l1_capability": "Payments", "description": "L1"}, headers=admin)
    client.post(
        "/api/capability-nodes",
        json={"system_code": "SPL", "level": 2, "l1_capability": "Payments", "l2_capability": "Card", "description": "L2"},
        headers=admin,
    )

    l2 = client.post(
        "/api/capability-nodes/rename",
        json={"system_code": "SPL", "level": 2, "l1_capability": "Payments", "l2_capability": "card", "new_name": "Cards"},
        headers=admin,
    )
    assert l2.status_code == 200, l2.text
    assert l2.json() == {"renamed": 3, "details": 1, "new_name": "Cards"}
    rows = client.get("/api/capabilities", headers=admin).json()
    assert sorted({row["l2_capability"] for row in rows}) == ["Cards", "Wallet"]

    # Renaming Cards to Wallet would merge "Top up" fine but nothing clashes; rename Wallet's Top up clash instead.
    client.post(
        "/api/capabilities",
        json={"country": "SG", "system_code": "SPL", "l1_capability": "Payments", "l2_capability": "Wallet", "l3_capability": "Auth"},
        headers=admin,
    )
    clash = client.post(
        "/api/capability-nodes/rename",
        json={"system_code": "SPL", "level": 2, "l1_capability": "Payments", "l2_capability": "Cards", "new_name": "Wallet"},
        headers=admin,
    )
    assert clash.status_code == 400 and "already exists" in clash.json()["detail"]

    l1 = client.post(
        "/api/capability-nodes/rename",
        json={"system_code": "SPL", "level": 1, "l1_capability": "Payments", "new_name": "Money"},
        headers=admin,
    )
    assert l1.status_code == 200, l1.text
    assert l1.json()["details"] == 2
    nodes = client.get("/api/capability-nodes", params={"system": "SPL"}, headers=admin).json()
    assert {(row["level"], row["l1_capability"], row["l2_capability"]) for row in nodes} == {(1, "Money", ""), (2, "Money", "Cards")}
    assert {row["l1_capability"] for row in client.get("/api/capabilities", headers=admin).json()} == {"Money"}

    missing = client.post(
        "/api/capability-nodes/rename", json={"system_code": "SPL", "level": 1, "l1_capability": "Nothing", "new_name": "X"}, headers=admin
    )
    assert missing.status_code == 404


def test_system_delete_removes_details(client):
    admin = _setup(client)
    client.post("/api/capability-nodes", json={"system_code": "SPL", "level": 1, "l1_capability": "Payments"}, headers=admin)
    impact = client.get("/api/systems/SPL/delete-impact", headers=admin).json()
    assert [row["l1_capability"] for row in impact["capability_details"]] == ["Payments"]
    assert client.delete("/api/systems/SPL?confirm=SPL", headers=admin).status_code == 200
    assert client.get("/api/capability-nodes", headers=admin).json() == []


def test_downloads_include_the_parent_l1_and_l2_details(client):
    admin = _setup(client)
    client.post(
        "/api/capability-nodes",
        json={
            "system_code": "SPL",
            "level": 1,
            "l1_capability": "Payments",
            "description": "L1 money movement.",
            "sequence_diagrams": [{"title": "L1 overview", "mermaid": FLOW}],
        },
        headers=admin,
    )
    l2_sg = client.post(
        "/api/capability-nodes",
        json={"system_code": "SPL", "level": 2, "l1_capability": "Payments", "l2_capability": "Card", "country": "SG", "description": "SG card rules."},
        headers=admin,
    ).json()
    client.post(
        "/api/capability-nodes",
        json={"system_code": "SPL", "level": 2, "l1_capability": "Payments", "l2_capability": "Card", "country": "MY", "description": "MY card rules."},
        headers=admin,
    )

    l2_md = client.get(f"/api/capability-nodes/{l2_sg['node_id']}/export?format=md", headers=admin).text
    assert l2_md.index("## L1 — Payments") < l2_md.index("## L2 — Card")
    assert "L1 money movement." in l2_md and "L1 overview" in l2_md and "SG card rules." in l2_md
    assert "MY card rules." not in l2_md

    rows = client.get("/api/capabilities", headers=admin).json()
    sg_auth = next(row for row in rows if row["country"] == "SG" and row["l3_capability"] == "Auth")
    md = client.get(f"/api/capabilities/{sg_auth['capability_id']}/export?format=md", headers=admin).text
    assert md.index("## L1 — Payments") < md.index("## L2 — Card") < md.index("## L3 — Auth")
    assert "L1 money movement." in md and "L1 overview" in md and "SG card rules." in md
    assert "MY card rules." not in md  # only the details for the capability's countries
    pdf = client.get(f"/api/capabilities/{sg_auth['capability_id']}/export?format=pdf", headers=admin)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    wallet = next(row for row in rows if row["l2_capability"] == "Wallet")
    wallet_md = client.get(f"/api/capabilities/{wallet['capability_id']}/export?format=md", headers=admin).text
    assert "L1 money movement." in wallet_md and "No L2 details." in wallet_md
