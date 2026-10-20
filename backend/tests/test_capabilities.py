import io

from openpyxl import Workbook
from tests.conftest import auth, login

HEADER = ["L1_CAPABILITY", "L2_CAPABILITY", "L3_CAPABILITY", "DESCRIPTION"]


def _excel(rows, header=HEADER) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _system(client, token, code="SPL"):
    assert (
        client.post(
            "/api/systems",
            json={"system_code": code, "system_name": code, "has_capability": True},
            headers=auth(token),
        ).status_code
        == 200
    )


def test_capabilities_upload_infers_description_and_blocks_rag(client):
    admin = login(client, "Admin")
    _system(client, admin)
    analyst = login(client, "Analyst")
    viewer = login(client, "Viewer")

    data = _excel(
        [
            ["Payments", "Card", "Auth", ""],
            ["Payments", "Card", "Capture", "Take funds"],
        ]
    )
    files = {"file": ("caps.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    upload = client.post(
        "/api/capabilities/upload",
        data={"country": "SG", "system": "SPL"},
        files=files,
        headers=auth(analyst),
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    assert body["uploaded"] == 2
    by_l3 = {row["l3_capability"]: row for row in body["capabilities"]}
    assert by_l3["Auth"]["description"] == "Provides Auth as a Card feature of Payments."
    assert by_l3["Capture"]["description"] == "Take funds"

    listed = client.get("/api/capabilities", headers=auth(viewer))
    assert listed.status_code == 200
    assert len(listed.json()) == 2

    detail = client.get(f"/api/capabilities/{by_l3['Auth']['capability_id']}", headers=auth(viewer))
    assert detail.status_code == 200
    assert detail.json()["interfaces"] == []

    blocked = client.post(
        "/api/rag",
        params={"inventory_type": "Capabilities"},
        files={"file": ("c.md", b"# cap", "text/markdown")},
        headers=auth(admin),
    )
    assert blocked.status_code == 400
    assert "capabilities" in blocked.json()["detail"].lower()


def test_capabilities_require_l1_l2_l3(client):
    admin = login(client, "Admin")
    _system(client, admin)
    analyst = login(client, "Analyst")
    data = _excel([["Payments", "", "Auth", "x"]])
    files = {"file": ("caps.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    upload = client.post(
        "/api/capabilities/upload",
        data={"country": "SG", "system": "SPL"},
        files=files,
        headers=auth(analyst),
    )
    assert upload.status_code == 400
    assert client.get("/api/capabilities", headers=auth(analyst)).json() == []


def test_capabilities_link_interface_and_unlink(client):
    admin = login(client, "Admin")
    _system(client, admin, "SPL")
    _system(client, admin, "DGE")
    analyst = login(client, "Analyst")
    created = client.post(
        "/api/capabilities",
        json={
            "country": "SG",
            "system_code": "SPL",
            "l1_capability": "Pay",
            "l2_capability": "Card",
            "l3_capability": "Auth",
            "description": "",
            "processing_rules": "**step** one",
        },
        headers=auth(analyst),
    )
    assert created.status_code == 200, created.text
    assert created.json()["description"] == "Provides Auth as a Card feature of Pay."
    assert created.json()["processing_rules"] == "**step** one"
    capability_id = created.json()["capability_id"]

    iface = client.post(
        "/api/interfaces/EAI",
        json={
            "country": "SG",
            "interface_name": "Remit",
            "description": "d",
            "protocol": "MQ",
            "source": "SPL",
            "destination": "DGE",
        },
        headers=auth(analyst),
    )
    assert iface.status_code == 200, iface.text
    interface_id = iface.json()["interface_id"]

    linked = client.post(
        f"/api/capabilities/{capability_id}/interfaces/{interface_id}",
        headers=auth(analyst),
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["interfaces"][0]["interface_name"] == "Remit"

    unlinked = client.delete(
        f"/api/capabilities/{capability_id}/interfaces/{interface_id}",
        headers=auth(analyst),
    )
    assert unlinked.status_code == 200
    assert unlinked.json()["interfaces"] == []

    regional = client.post(
        "/api/capabilities",
        json={
            "country": "MY,TH",
            "system_code": "SPL",
            "l1_capability": "Pay",
            "l2_capability": "Card",
            "l3_capability": "Regional",
        },
        headers=auth(analyst),
    )
    assert regional.status_code == 200, regional.text
    regional_id = regional.json()["capability_id"]
    everywhere = client.post(
        "/api/interfaces/EAI",
        json={
            "country": "",
            "interface_name": "Login API",
            "description": "d",
            "protocol": "API",
            "source": "SPL",
            "destination": "DGE",
        },
        headers=auth(analyst),
    )
    assert everywhere.status_code == 200, everywhere.text
    linked_all = client.post(
        f"/api/capabilities/{regional_id}/interfaces/{everywhere.json()['interface_id']}",
        headers=auth(analyst),
    )
    assert linked_all.status_code == 200, linked_all.text
    assert linked_all.json()["interfaces"][0]["interface_name"] == "Login API"

    other = client.post(
        f"/api/capabilities/{regional_id}/interfaces/{interface_id}",
        headers=auth(analyst),
    )
    assert other.status_code == 400
    assert "same country" in other.json()["detail"].lower()


def test_capabilities_accept_system_without_flag(client):
    admin = login(client, "Admin")
    assert (
        client.post(
            "/api/systems",
            json={"system_code": "SPL", "system_name": "SPL", "has_capability": False},
            headers=auth(admin),
        ).status_code
        == 200
    )
    analyst = login(client, "Analyst")
    created = client.post(
        "/api/capabilities",
        json={
            "country": "SG",
            "system_code": "SPL",
            "l1_capability": "A",
            "l2_capability": "B",
            "l3_capability": "C",
        },
        headers=auth(analyst),
    )
    assert created.status_code == 200
    assert created.json()["system_code"] == "SPL"


def test_capability_countries_can_be_all_or_several(client):
    admin = login(client, "Admin")
    _system(client, admin)
    analyst = login(client, "Analyst")
    everywhere = client.post(
        "/api/capabilities",
        json={
            "country": "",
            "country_behavior": "Uses the local calendar",
            "system_code": "SPL",
            "l1_capability": "Pay",
            "l2_capability": "Card",
            "l3_capability": "Auth",
        },
        headers=auth(analyst),
    )
    assert everywhere.status_code == 200, everywhere.text
    assert everywhere.json()["country"] == ""
    assert everywhere.json()["country_behavior"] == "Uses the local calendar"
    several = client.post(
        "/api/capabilities",
        json={
            "country": "MY, SG",
            "system_code": "SPL",
            "l1_capability": "Pay",
            "l2_capability": "Card",
            "l3_capability": "Refund",
        },
        headers=auth(analyst),
    )
    assert several.status_code == 200, several.text
    assert several.json()["country"] == "SG,MY"
    unknown = client.post(
        "/api/capabilities",
        json={"country": "ZZ", "system_code": "SPL", "l1_capability": "A", "l2_capability": "B", "l3_capability": "C"},
        headers=auth(analyst),
    )
    assert unknown.status_code == 400
    again = client.post(
        "/api/capabilities",
        json={"country": " ", "system_code": "SPL", "l1_capability": "Pay", "l2_capability": "Card", "l3_capability": "Auth"},
        headers=auth(analyst),
    )
    assert again.status_code == 400
    assert "All countries" in again.json()["detail"]

    my_interface = client.post(
        "/api/interfaces/EAI",
        json={"country": "MY", "interface_name": "Local", "description": "d", "protocol": "MQ", "source": "SPL", "destination": "SPL"},
        headers=auth(analyst),
    )
    assert my_interface.status_code == 200, my_interface.text
    interface_id = my_interface.json()["interface_id"]
    linked = client.post(f"/api/capabilities/{everywhere.json()['capability_id']}/interfaces/{interface_id}", headers=auth(analyst))
    assert linked.status_code == 200, linked.text
    only_sg = client.post(
        "/api/capabilities",
        json={"country": "SG", "system_code": "SPL", "l1_capability": "Pay", "l2_capability": "Card", "l3_capability": "Void"},
        headers=auth(analyst),
    )
    refused = client.post(f"/api/capabilities/{only_sg.json()['capability_id']}/interfaces/{interface_id}", headers=auth(analyst))
    assert refused.status_code == 400
    both = client.post(f"/api/capabilities/{several.json()['capability_id']}/interfaces/{interface_id}", headers=auth(analyst))
    assert both.status_code == 200, both.text
