import io

from openpyxl import Workbook
from tests.conftest import auth, login

HEADER = ["COUNTRY", "L1_CAPABILITY", "L2_CAPABILITY", "L3_CAPABILITY", "DESCRIPTION"]


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
    analyst = login(client, "Admin")
    viewer = login(client, "Viewer")

    data = _excel(
        [
            ["SG", "Payments", "Card", "Auth", ""],
            ["SG", "Payments", "Card", "Capture", "Take funds"],
        ]
    )
    files = {"file": ("caps.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    upload = client.post(
        "/api/capabilities/upload",
        data={"system": "SPL"},
        files=files,
        headers=auth(analyst),
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    assert body["uploaded"] == 2
    by_l3 = {row["l3_capability"]: row for row in body["capabilities"]}
    assert by_l3["Auth"]["description"] == "Provides auth as a card feature of payments."
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
    analyst = login(client, "Admin")
    data = _excel([["SG", "Payments", "", "Auth", "x"]])
    files = {"file": ("caps.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    upload = client.post(
        "/api/capabilities/upload",
        data={"system": "SPL"},
        files=files,
        headers=auth(analyst),
    )
    assert upload.status_code == 400
    assert client.get("/api/capabilities", headers=auth(analyst)).json() == []


def test_capabilities_upload_country_column(client):
    admin = login(client, "Admin")
    _system(client, admin)
    analyst = login(client, "Admin")
    files = {
        "file": (
            "caps.xlsx",
            _excel(
                [
                    ["", "Payments", "Card", "Everywhere", "All"],
                    ["my, sg", "Payments", "Card", "Regional", "Two"],
                    ["SG", "Payments", "Card", "Local", "One"],
                ]
            ),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    upload = client.post("/api/capabilities/upload", data={"system": "SPL"}, files=files, headers=auth(analyst))
    assert upload.status_code == 200, upload.text
    by_l3 = {row["l3_capability"]: row["country"] for row in upload.json()["capabilities"]}
    assert by_l3["Everywhere"] == ""
    assert by_l3["Regional"] == "SG,MY"
    assert by_l3["Local"] == "SG"

    rejected = client.post(
        "/api/capabilities/upload",
        data={"system": "SPL"},
        files={
            "file": (
                "bad.xlsx",
                _excel([["ZZ", "Payments", "Card", "Nope", "x"], ["SG,XX", "Payments", "Card", "Also", "x"]]),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=auth(analyst),
    )
    assert rejected.status_code == 400
    assert {err["field"] for err in rejected.json()["errors"]} == {"COUNTRY"}
    assert "Nope" not in {row["l3_capability"] for row in client.get("/api/capabilities", headers=auth(analyst)).json()}


def test_capabilities_link_interface_and_unlink(client):
    admin = login(client, "Admin")
    _system(client, admin, "SPL")
    _system(client, admin, "DGE")
    analyst = login(client, "Admin")
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
    assert created.json()["description"] == "Provides auth as a card feature of pay."
    assert created.json()["processing_rules"] == "**step** one"
    capability_id = created.json()["capability_id"]

    iface = client.post(
        "/api/interfaces/EAI",
        json={
            "country": "SG",
            "interface_name": "Remit",
            "endpoint": "/remit",
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
    assert linked.json()["interfaces"][0]["endpoint"] == "/remit"

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
    analyst = login(client, "Admin")
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
    analyst = login(client, "Admin")
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


def test_names_are_sentence_case_and_diagrams_accept_any_mermaid_type(client, monkeypatch):
    from app.services import capabilities as capabilities_svc

    admin = login(client, "Admin")
    _system(client, admin)
    embedded = []
    monkeypatch.setattr("app.services.llm.embedding_configured", lambda: True)
    monkeypatch.setattr("app.services.llm.embed", lambda text: embedded.append(text) or [0.1])
    created = client.post(
        "/api/capabilities",
        json={
            "country": "SG",
            "system_code": "SPL",
            "l1_capability": "FUND TRANSFER",
            "l2_capability": "fund transfer",
            "l3_capability": "Fund Transfer",
            "description": "SENDS MONEY overnight.",
            "country_behavior": "Uses FAST on weekdays.",
            "processing_rules": "Step one then step two.",
            "sequence_diagrams": [
                {"title": "Flow", "mermaid": "flowchart LR\n  A[Payer] --> B[Bank]"},
                {"title": "States", "mermaid": "stateDiagram-v2\n  [*] --> Received"},
            ],
        },
        headers=auth(admin),
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["l1_capability"] == "Fund transfer"
    assert body["l2_capability"] == "Fund transfer"
    assert body["l3_capability"] == "Fund transfer"
    assert body["description"] == "Sends money overnight."
    assert {item["title"] for item in body["sequence_diagrams"]} == {"Flow", "States"}
    text = capabilities_svc.text_for(
        {
            **body,
            "sequence_diagrams": body["sequence_diagrams"],
        }
    )
    assert "flowchart LR" in text and "stateDiagram-v2" in text
    assert "Uses FAST on weekdays." in text and "Step one then step two." in text
    assert embedded and "flowchart LR" in embedded[-1] and "Uses FAST on weekdays." in embedded[-1]

    too_long = client.post(
        "/api/capabilities",
        json={
            "country": "SG",
            "system_code": "SPL",
            "l1_capability": "Pay",
            "l2_capability": "Card",
            "l3_capability": "Notes",
            "description": "Notes",
            "processing_rules": "x" * 20001,
        },
        headers=auth(admin),
    )
    assert too_long.status_code == 400
    assert "20000" in too_long.json()["detail"]
    behavior = client.post(
        "/api/capabilities",
        json={
            "country": "SG",
            "system_code": "SPL",
            "l1_capability": "Pay",
            "l2_capability": "Card",
            "l3_capability": "Local",
            "country_behavior": "y" * 20001,
        },
        headers=auth(admin),
    )
    assert behavior.status_code == 400
    plain = client.post(
        "/api/capabilities",
        json={
            "country": "SG",
            "system_code": "SPL",
            "l1_capability": "Pay",
            "l2_capability": "Card",
            "l3_capability": "Sketch",
            "sequence_diagrams": [{"title": "Notes", "mermaid": "just some words"}],
        },
        headers=auth(admin),
    )
    assert plain.status_code == 400
    assert "Mermaid" in plain.json()["detail"]
