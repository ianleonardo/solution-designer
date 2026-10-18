from tests.conftest import auth, login


def _admin(client):
    return auth(login(client, "Admin"))


def _create(client, name="Runbook", **extra):
    response = client.post("/api/layouts", json={"name": name, **extra}, headers=_admin(client))
    assert response.status_code == 200, response.text
    return response.json()


def test_builtin_layouts_are_seeded(client):
    writer = auth(login(client, "Write"))
    layouts = client.get("/api/layouts", headers=writer).json()
    by_id = {item["layout_id"]: item for item in layouts}
    assert by_id["sdd"]["name"] == "Solution Design Document"
    assert by_id["interface-spec"]["name"] == "Interface Specifications Document"
    assert by_id["interface-spec"]["section_count"] >= 15
    assert all(item["is_system"] for item in by_id.values())
    assert client.get("/api/layouts/interface-spec", headers=writer).status_code == 403
    detail = client.get("/api/layouts/interface-spec", headers=_admin(client)).json()
    purpose = next(item for item in detail["templates"] if item["section_name"] == "Purpose")
    assert purpose["parent_id"] == "interface-spec--introduction"
    assert purpose["blocks"] == [{"type": "prose"}]
    assert purpose["system_prompt"]


def test_create_update_delete_layout(client):
    headers = _admin(client)
    layout = _create(client, "Runbook", description="Operations runbook")
    assert layout["layout_id"] == "runbook"
    assert layout["templates"] == []
    assert client.post("/api/layouts", json={"name": "runbook"}, headers=headers).status_code == 400
    assert client.post("/api/layouts", json={"name": " "}, headers=headers).status_code == 400
    renamed = client.put("/api/layouts/runbook", json={"name": "Ops Runbook"}, headers=headers)
    assert renamed.json()["name"] == "Ops Runbook"
    assert client.delete("/api/layouts/sdd", headers=headers).status_code == 400
    assert client.delete("/api/layouts/runbook", headers=headers).status_code == 200
    assert client.get("/api/layouts/runbook", headers=headers).status_code == 404


def test_only_admin_edits_layouts(client):
    writer = auth(login(client, "Write"))
    assert client.post("/api/layouts", json={"name": "Nope"}, headers=writer).status_code == 403
    assert client.post("/api/layouts/sdd/templates", json={"section_name": "x"}, headers=writer).status_code == 403
    assert client.put("/api/layouts/sdd/order", json={"sections": []}, headers=writer).status_code == 403
    assert client.delete("/api/templates/key-non-functional-requirements", headers=writer).status_code == 403


def test_copy_layout_clones_sections_with_new_ids(client):
    copy = _create(client, "Interface Copy", copy_from="interface-spec")
    assert len(copy["templates"]) >= 15
    assert all(item["template_id"].startswith("interface-copy--") for item in copy["templates"])
    children = [item for item in copy["templates"] if item["parent_id"]]
    parents = {item["template_id"] for item in copy["templates"] if item["parent_id"] is None}
    assert children and all(item["parent_id"] in parents for item in children)


def test_section_and_block_builder(client):
    headers = _admin(client)
    _create(client, "Runbook")
    top = client.post(
        "/api/layouts/runbook/templates",
        json={"section_name": "Overview", "blocks": [{"type": "header", "text": "Overview", "level": 2}, {"type": "prose"}]},
        headers=headers,
    )
    assert top.status_code == 200, top.text
    assert top.json()["template_id"] == "runbook--overview"
    assert top.json()["content_kind"] == "prose"
    child = client.post(
        "/api/layouts/runbook/templates",
        json={
            "section_name": "Contacts",
            "parent_id": "runbook--overview",
            "blocks": [{"type": "table", "columns": ["Name", "Phone"]}, {"type": "image", "caption": "Org chart"}],
            "system_prompt": "List contacts.",
            "temperature": 0.5,
            "max_words": 300,
        },
        headers=headers,
    )
    assert child.status_code == 200, child.text
    body = child.json()
    assert body["parent_id"] == "runbook--overview"
    assert body["content_kind"] == "table"
    assert body["blocks"][0]["rows"] == [["", ""]]
    assert body["system_prompt"] == "List contacts."
    assert body["temperature"] == 0.5 and body["max_words"] == 300
    nested = client.post(
        "/api/layouts/runbook/templates",
        json={"section_name": "Too deep", "parent_id": body["template_id"]},
        headers=headers,
    )
    assert nested.status_code == 200, nested.text
    current = nested.json()["template_id"]
    for name in ("Fourth", "Fifth", "Sixth"):
        deeper = client.post(
            "/api/layouts/runbook/templates",
            json={"section_name": name, "parent_id": current},
            headers=headers,
        )
        if name == "Sixth":
            assert deeper.status_code == 400
            assert "at most 5 levels" in deeper.json()["detail"]
        else:
            assert deeper.status_code == 200, deeper.text
            current = deeper.json()["template_id"]


def test_block_validation(client):
    headers = _admin(client)
    _create(client, "Runbook")
    url = "/api/layouts/runbook/templates"
    assert client.post(url, json={"section_name": "A", "blocks": [{"type": "video"}]}, headers=headers).status_code == 400
    assert client.post(url, json={"section_name": "A", "blocks": [{"type": "table", "columns": []}]}, headers=headers).status_code == 400
    assert client.post(url, json={"section_name": "A", "blocks": [{"type": "table", "columns": ["x", ""]}]}, headers=headers).status_code == 400
    assert client.post(url, json={"section_name": "A", "blocks": [{"type": "header", "level": 9}]}, headers=headers).status_code == 400
    assert client.post(url, json={"section_name": "A", "blocks": []}, headers=headers).status_code == 200  # defaults to prose
    assert client.post(url, json={"section_name": ""}, headers=headers).status_code == 400


def test_update_template_partially_and_delete_with_children(client):
    headers = _admin(client)
    detail = client.get("/api/layouts/interface-spec", headers=headers).json()
    scope = next(item for item in detail["templates"] if item["section_name"] == "Scope")
    renamed = client.put(
        f"/api/templates/{scope['template_id']}",
        json={"section_name": "Scope and Boundaries", "blocks": [{"type": "prose"}, {"type": "table", "columns": ["In", "Out"]}]},
        headers=headers,
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["content_kind"] == "mixed"
    assert renamed.json()["system_prompt"] == scope["system_prompt"]  # untouched
    assert client.put(f"/api/templates/{scope['template_id']}", json={"temperature": 5}, headers=headers).status_code == 400
    assert client.delete("/api/templates/interface-spec--introduction", headers=headers).status_code == 200
    after = client.get("/api/layouts/interface-spec", headers=headers).json()
    names = {item["section_name"] for item in after["templates"]}
    assert "Introduction" not in names and "Purpose" not in names and "Interface Overview" in names


def test_reorder_moves_sections_and_sub_sections(client):
    headers = _admin(client)
    detail = client.get("/api/layouts/interface-spec", headers=headers).json()
    tops = [item for item in detail["templates"] if item["parent_id"] is None]
    children = {item["template_id"]: [c["template_id"] for c in detail["templates"] if c["parent_id"] == item["template_id"]] for item in tops}
    order = [item["template_id"] for item in tops]
    order.reverse()
    first_children = children[order[0]]
    moved = children[order[1]][0]
    sections = []
    for index, template_id in enumerate(order):
        kids = list(children[template_id])
        if index == 0:
            kids.append(moved)
        elif moved in kids:
            kids.remove(moved)
        sections.append({"template_id": template_id, "children": kids})
    response = client.put("/api/layouts/interface-spec/order", json={"sections": sections}, headers=headers)
    assert response.status_code == 200, response.text
    result = response.json()["templates"]
    result_tops = [item["template_id"] for item in result if item["parent_id"] is None]
    assert result_tops == order
    assert next(item for item in result if item["template_id"] == moved)["parent_id"] == order[0]
    assert len([item for item in result if item["parent_id"] == order[0]]) == len(first_children) + 1
    missing = client.put("/api/layouts/interface-spec/order", json={"sections": sections[:-1]}, headers=headers)
    assert missing.status_code == 400


def test_legacy_top_level_order_still_works(client):
    headers = _admin(client)
    tops = [item["template_id"] for item in client.get("/api/templates", headers=headers).json() if item["parent_id"] is None]
    reordered = list(reversed(tops))
    response = client.put("/api/templates/order", json={"template_ids": reordered}, headers=headers)
    assert response.status_code == 200, response.text
    again = [item["template_id"] for item in response.json() if item["parent_id"] is None]
    assert again == reordered
    assert client.get("/api/templates?layout_id=interface-spec", headers=headers).json()[0]["layout_id"] == "interface-spec"


def test_promote_rejects_a_cycle_and_delete_removes_descendants(client):
    headers = _admin(client)
    _create(client, "Runbook")
    overview = client.post("/api/layouts/runbook/templates", json={"section_name": "Overview"}, headers=headers).json()
    child = client.post(
        "/api/layouts/runbook/templates",
        json={"section_name": "Contacts", "parent_id": overview["template_id"]},
        headers=headers,
    ).json()
    grand = client.post(
        "/api/layouts/runbook/templates",
        json={"section_name": "Phones", "parent_id": child["template_id"]},
        headers=headers,
    ).json()
    cycle = client.put(
        "/api/layouts/runbook/order",
        json={
            "sections": [
                {
                    "template_id": overview["template_id"],
                    "children": [
                        {
                            "template_id": child["template_id"],
                            "children": [{"template_id": grand["template_id"], "children": [{"template_id": overview["template_id"], "children": []}]}],
                        }
                    ],
                }
            ]
        },
        headers=headers,
    )
    assert cycle.status_code == 400
    assert "itself" in cycle.json()["detail"]
    promoted = client.put(
        "/api/layouts/runbook/order",
        json={
            "sections": [
                {"template_id": overview["template_id"], "children": []},
                {"template_id": child["template_id"], "children": [{"template_id": grand["template_id"], "children": []}]},
            ]
        },
        headers=headers,
    )
    assert promoted.status_code == 200, promoted.text
    rows = {item["template_id"]: item for item in promoted.json()["templates"]}
    assert rows[child["template_id"]]["parent_id"] is None
    assert rows[grand["template_id"]]["parent_id"] == child["template_id"]
    assert client.delete(f"/api/templates/{child['template_id']}", headers=headers).status_code == 200
    names = {item["section_name"] for item in client.get("/api/layouts/runbook", headers=headers).json()["templates"]}
    assert names == {"Overview"}
