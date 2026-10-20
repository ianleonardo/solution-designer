from tests.conftest import auth, login


def test_dashboard_includes_knowledge_base_stats_by_country(client):
    admin = login(client, "Admin")
    assert (
        client.post(
            "/api/systems",
            json={"system_code": "SPL", "system_name": "SPL", "has_batch": True, "has_report": True, "has_capability": True},
            headers=auth(admin),
        ).status_code
        == 200
    )
    assert client.post("/api/systems", json={"system_code": "DGE", "system_name": "DGE"}, headers=auth(admin)).status_code == 200
    assert (
        client.post(
            "/api/interfaces/SPL",
            json={
                "country": "SG",
                "interface_name": "Balance",
                "protocol": "API",
                "source": "SPL",
                "destination": "DGE",
            },
            headers=auth(admin),
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/tables",
            json={"country": "MY", "database_name": "PIB", "table_name": "ACCT"},
            headers=auth(admin),
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/reports",
            json={
                "country": "SG",
                "system_code": "SPL",
                "report_code": "RPT-01",
                "report_name": "Daily",
                "description": "Balances",
                "layout": "A|B",
            },
            headers=auth(admin),
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/batches",
            json={
                "country": "TH",
                "system_code": "SPL",
                "batch_name": "Night job",
                "batch_type": "incoming",
                "description": "Settle",
                "batch_filename": "night.dat",
                "file_layout": "A|B",
            },
            headers=auth(admin),
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/capabilities",
            json={
                "country": "TH",
                "system_code": "SPL",
                "l1_capability": "Pay",
                "l2_capability": "Card",
                "l3_capability": "Auth",
            },
            headers=auth(admin),
        ).status_code
        == 200
    )

    res = client.get("/api/dashboard", headers=auth(admin))
    assert res.status_code == 200, res.text
    body = res.json()
    assert "total_projects" in body
    by_country = {row["country"]: row for row in body["kb_by_country"]}
    assert by_country["SG"]["interfaces"] == 1
    assert by_country["SG"]["reports"] == 1
    assert by_country["MY"]["tables"] == 1
    assert by_country["TH"]["capabilities"] == 1
    assert by_country["TH"]["batches"] == 1
    for code in ("SG", "MY", "TH", "VN", "ID"):
        assert code in by_country


def test_dashboard_counts_multi_country_and_all_country_items_towards_each_country(client):
    admin = login(client, "Admin")
    headers = auth(admin)
    client.post("/api/systems", json={"system_code": "SPL", "system_name": "SPL", "has_capability": True}, headers=headers)
    client.post("/api/systems", json={"system_code": "DGE", "system_name": "DGE"}, headers=headers)
    capability = {"system_code": "SPL", "l1_capability": "Pay", "l2_capability": "Card", "l3_capability": "Auth"}
    shared = client.post("/api/capabilities", json={**capability, "country": "SG,MY"}, headers=headers)
    assert shared.status_code == 200, shared.text
    everywhere = client.post("/api/capabilities", json={**capability, "l3_capability": "Settle", "country": ""}, headers=headers)
    assert everywhere.status_code == 200, everywhere.text
    interface = {"interface_name": "Balance", "protocol": "API", "source": "SPL", "destination": "DGE", "country": ""}
    assert client.post("/api/interfaces/SPL", json=interface, headers=headers).status_code == 200

    rows = client.get("/api/dashboard", headers=headers).json()["kb_by_country"]
    by_country = {row["country"]: row for row in rows}
    assert "Unspecified" not in by_country
    assert not any("," in row["country"] for row in rows)
    assert by_country["SG"]["capabilities"] == 2  # SG,MY + all countries
    assert by_country["MY"]["capabilities"] == 2
    assert by_country["TH"]["capabilities"] == 1  # all countries only
    for code in ("SG", "MY", "TH", "VN", "ID"):
        assert by_country[code]["interfaces"] == 1
