import json

from tests.conftest import auth, login


def _setup(client):
    admin = auth(login(client, "Admin"))
    for code in ("SPL", "DGE"):
        client.post(
            "/api/systems",
            json={"system_code": code, "system_name": code, "has_batch": True, "has_report": True, "has_capability": True},
            headers=admin,
        )
    analyst = auth(login(client, "Analyst"))
    capability = client.post(
        "/api/capabilities",
        json={"country": "SG,MY", "system_code": "SPL", "l1_capability": "Payments", "l2_capability": "Card", "l3_capability": "Auth"},
        headers=analyst,
    ).json()
    interface = client.post(
        "/api/interfaces/SPL",
        json={"country": "SG", "interface_name": "Balance", "description": "Fetch balance", "protocol": "MQ",
              "source": "SPL", "destination": "DGE"},
        headers=analyst,
    ).json()
    report = client.post(
        "/api/reports",
        json={"country": "SG", "system_code": "SPL", "report_code": "RPT-01", "report_name": "Daily Balance", "description": "d", "layout": "A"},
        headers=analyst,
    ).json()
    table = client.post("/api/tables", json={"country": "SG", "database_name": "PIB", "schema_name": "DBO", "table_name": "ACCT"}, headers=analyst).json()
    columns = [
        client.post(f"/api/tables/{table['table_id']}/columns", json={"column_name": name, "data_type": kind, "description": f"{name} desc"}, headers=analyst).json()
        for name, kind in (("ACCT_NO", "VARCHAR(20)"), ("BAL", "NUMBER(18,2)"), ("OPENED", "DATE"))
    ]
    for kind, item_id in (("interfaces", interface["interface_id"]), ("reports", report["report_id"]), ("tables", table["table_id"])):
        assert client.post(f"/api/capabilities/{capability['capability_id']}/{kind}/{item_id}", headers=analyst).status_code == 200
    writer = login(client, "Write")
    project = client.post("/api/projects", json={"project_name": "Cards"}, headers=auth(writer)).json()
    sdd = client.get(f"/api/projects/{project['project_id']}/documents", headers=auth(writer)).json()[0]
    base = f"/api/projects/{project['project_id']}/documents/{sdd['document_id']}"
    return {
        "writer": auth(writer), "analyst": analyst, "base": base, "capability": capability, "interface": interface,
        "report": report, "table": table, "columns": columns,
    }


def _section(client, ctx, section_id):
    doc = client.get(ctx["base"], headers=ctx["writer"]).json()
    return doc["content_json"]["sections"][section_id]["blocks"]


def test_sdd_tables_are_seeded_with_knowledge_base_sources(client):
    admin = auth(login(client, "Admin"))
    templates = {item["template_id"]: item for item in client.get("/api/layouts/sdd", headers=admin).json()["templates"]}
    expected = {
        "inventory-of-capabilities": "capabilities", "interfaces-summary": "interfaces", "interfaces-details": "interfaces",
        "inventory-of-reports": "reports", "new-updated-tables": "tables",
    }
    for template_id, source in expected.items():
        tables = [block for block in templates[template_id]["blocks"] if block["type"] == "table"]
        assert tables[0]["source"] == source


def test_capabilities_interfaces_and_reports_become_linked_rows(client):
    ctx = _setup(client)
    url = f"{ctx['base']}/sections/inventory-of-capabilities/kb-links"
    added = client.post(url, json={"ids": [ctx["capability"]["capability_id"]]}, headers=ctx["writer"])
    assert added.status_code == 200, added.text
    table = added.json()["content_json"]["sections"]["inventory-of-capabilities"]["blocks"][0]
    assert table["rows"] == [["1", "SPL", "", "Payments", "Card", "Auth", "Existing"]]  # starter blank row replaced
    assert table["links"][0]["state"] == "ok"
    assert table["links"][0]["owned"] == [1, 3, 4, 5]  # VAL ID and New/Existing/Delete belong to the project
    again = client.post(url, json={"ids": [ctx["capability"]["capability_id"]]}, headers=ctx["writer"]).json()
    assert len(again["content_json"]["sections"]["inventory-of-capabilities"]["blocks"][0]["rows"]) == 1  # no duplicates

    summary = client.post(f"{ctx['base']}/sections/interfaces-summary/kb-links", json={"ids": [ctx["interface"]["interface_id"]]}, headers=ctx["writer"]).json()
    row = summary["content_json"]["sections"]["interfaces-summary"]["blocks"][0]["rows"][0]
    assert row == ["1", "Balance – Fetch balance", "", "Online", "SPL", "DGE", "SPL / MQ", "Existing", ""]
    reports = client.post(f"{ctx['base']}/sections/inventory-of-reports/kb-links", json={"ids": [ctx["report"]["report_id"]]}, headers=ctx["writer"]).json()
    assert reports["content_json"]["sections"]["inventory-of-reports"]["blocks"][0]["rows"][0] == ["1", "SPL", "", "Daily Balance", "", "Existing"]

    assert client.post(f"{ctx['base']}/sections/purpose/kb-links", json={"ids": []}, headers=ctx["writer"]).status_code in (400, 404)
    viewer = auth(login(client, "Read"))
    assert client.post(url, json={"ids": [ctx["capability"]["capability_id"]]}, headers=viewer).status_code == 403


def test_new_updated_tables_holds_one_table_per_database_table_with_only_ticked_fields(client):
    ctx = _setup(client)
    url = f"{ctx['base']}/sections/new-updated-tables/kb-links"
    ticked = [ctx["columns"][0]["column_id"], ctx["columns"][1]["column_id"]]
    result = client.post(url, json={"table_id": ctx["table"]["table_id"], "column_ids": ticked}, headers=ctx["writer"]).json()
    blocks = [b for b in result["content_json"]["sections"]["new-updated-tables"]["blocks"] if b["type"] == "table"]
    assert len(blocks) == 1
    assert blocks[0]["table_name"] == "PIB.DBO.ACCT"
    assert blocks[0]["rows"] == [["1", "ACCT_NO", "VARCHAR", "20", "ACCT_NO desc", ""], ["2", "BAL", "NUMBER", "18,2", "BAL desc", ""]]
    # ticking one more field of the same table adds to that table
    more = client.post(url, json={"table_id": ctx["table"]["table_id"], "column_ids": [ctx["columns"][2]["column_id"]]}, headers=ctx["writer"]).json()
    blocks = [b for b in more["content_json"]["sections"]["new-updated-tables"]["blocks"] if b["type"] == "table"]
    assert len(blocks) == 1 and len(blocks[0]["rows"]) == 3

    other = client.post("/api/tables", json={"country": "SG", "database_name": "PIB", "schema_name": "DBO", "table_name": "LOAN"}, headers=ctx["analyst"]).json()
    added = client.post(url, json={"table_id": other["table_id"], "column_ids": []}, headers=ctx["writer"]).json()
    blocks = [b for b in added["content_json"]["sections"]["new-updated-tables"]["blocks"] if b["type"] == "table"]
    assert [b["table_name"] for b in blocks] == ["PIB.DBO.ACCT", "PIB.DBO.LOAN"]

    # a normal save from the editor keeps the tables, names and links
    sections = added["content_json"]["sections"]
    saved = client.put(ctx["base"], json={"content_json": {"sections": sections}}, headers=ctx["writer"]).json()
    kept = [b for b in saved["content_json"]["sections"]["new-updated-tables"]["blocks"] if b["type"] == "table"]
    assert [b.get("table_name") for b in kept] == ["PIB.DBO.ACCT", "PIB.DBO.LOAN"]
    assert kept[0]["links"][0]["id"] == ctx["columns"][0]["column_id"]
    markdown = client.get(f"{ctx['base']}/export?format=md", headers=ctx["writer"]).text
    assert "**Table Name:** PIB.DBO.ACCT" in markdown


def test_changed_and_deleted_items_are_flagged_and_refresh_keeps_project_columns(client):
    ctx = _setup(client)
    capability_id = ctx["capability"]["capability_id"]
    client.post(f"{ctx['base']}/sections/inventory-of-capabilities/kb-links", json={"ids": [capability_id]}, headers=ctx["writer"])
    client.post(f"{ctx['base']}/sections/inventory-of-reports/kb-links", json={"ids": [ctx["report"]["report_id"]]}, headers=ctx["writer"])

    doc = client.get(ctx["base"], headers=ctx["writer"]).json()
    sections = doc["content_json"]["sections"]
    sections["inventory-of-capabilities"]["blocks"][0]["rows"][0][6] = "Delete"  # analyst's own column
    sections["inventory-of-capabilities"]["blocks"][0]["rows"][0][2] = "VAL-9"
    client.put(ctx["base"], json={"content_json": {"sections": sections}}, headers=ctx["writer"])

    assert client.patch(f"/api/capabilities/{capability_id}", json={"l3_capability": "Authorise"}, headers=ctx["analyst"]).status_code == 200
    assert client.delete(f"/api/reports/{ctx['report']['report_id']}", headers=ctx["analyst"]).status_code == 200
    assert _section(client, ctx, "inventory-of-capabilities")[0]["links"][0]["state"] == "changed"
    assert _section(client, ctx, "inventory-of-reports")[0]["links"][0]["state"] == "deleted"

    refreshed = client.post(f"{ctx['base']}/sections/inventory-of-capabilities/kb-refresh", headers=ctx["writer"]).json()
    table = refreshed["content_json"]["sections"]["inventory-of-capabilities"]["blocks"][0]
    assert table["rows"][0] == ["1", "SPL", "VAL-9", "Payments", "Card", "Authorise", "Delete"]
    assert table["links"][0]["state"] == "ok"
    kept = client.post(f"{ctx['base']}/sections/inventory-of-reports/kb-refresh", headers=ctx["writer"]).json()
    report_table = kept["content_json"]["sections"]["inventory-of-reports"]["blocks"][0]
    assert report_table["rows"][0][3] == "Daily Balance" and report_table["links"][0]["state"] == "deleted"


def test_related_items_from_a_capability_are_offered_for_other_sections(client):
    ctx = _setup(client)
    capability_id = ctx["capability"]["capability_id"]
    url = f"{ctx['base']}/sections/inventory-of-capabilities/kb-related"
    suggestions = {item["section_id"]: item for item in client.post(url, json={"ids": [capability_id]}, headers=ctx["writer"]).json()}
    assert set(suggestions) == {"interfaces-summary", "interfaces-details", "inventory-of-reports", "new-updated-tables"}
    assert suggestions["interfaces-summary"]["items"] == [{"id": ctx["interface"]["interface_id"], "label": "Balance"}]
    assert suggestions["new-updated-tables"]["items"][0]["label"] == "PIB.DBO.ACCT"
    client.post(f"{ctx['base']}/sections/interfaces-summary/kb-links", json={"ids": [ctx["interface"]["interface_id"]]}, headers=ctx["writer"])
    after = {item["section_id"] for item in client.post(url, json={"ids": [capability_id]}, headers=ctx["writer"]).json()}
    assert "interfaces-summary" not in after and "interfaces-details" in after


def test_auto_fill_keeps_linked_rows(client, monkeypatch):
    ctx = _setup(client)
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    client.post(f"{ctx['base']}/sections/inventory-of-capabilities/kb-links", json={"ids": [ctx["capability"]["capability_id"]]}, headers=ctx["writer"])
    generated = {"blocks": [{"type": "table", "columns": [], "rows": [
        ["1", "SPL", "", "Payments", "Card", "Auth", "Existing"],
        ["2", "DGE", "", "Lending", "Loans", "Apply", "New"],
    ]}]}
    monkeypatch.setattr("app.services.llm.complete", lambda system, user, temperature: json.dumps(generated))
    filled = client.post(f"{ctx['base']}/sections/inventory-of-capabilities/regenerate", headers=ctx["writer"])
    assert filled.status_code == 200, filled.text
    table = filled.json()["content_json"]["sections"]["inventory-of-capabilities"]["blocks"][0]
    assert [row[1] for row in table["rows"]] == ["SPL", "DGE"]  # the generated copy of the linked row is dropped
    assert table["links"][0]["id"] == ctx["capability"]["capability_id"] and table["links"][1] is None
