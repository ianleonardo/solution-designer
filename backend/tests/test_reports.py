import io

from openpyxl import Workbook
from tests.conftest import auth, login

HEADER = ["REPORT_ID", "REPORT_NAME", "REPORT_DESCRIPTION", "FREQUENCY", "REPORT_LAYOUT"]


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
            json={"system_code": code, "system_name": code, "has_report": True},
            headers=auth(token),
        ).status_code
        == 200
    )


def test_reports_upload_list_and_layout(client):
    admin = login(client, "Admin")
    _system(client, admin)
    analyst = login(client, "SuperAnalyst")
    viewer = login(client, "Viewer")

    data = _excel(
        [
            ["RPT-01", "Daily Balance", "End of day balances", "Daily", "Col A | Col B"],
            ["RPT-02", "Exception Report", "Failed postings", "", "Layout text"],
        ]
    )
    files = {"file": ("reports.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    upload = client.post(
        "/api/reports/upload",
        data={"country": "SG", "system": "SPL"},
        files=files,
        headers=auth(analyst),
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    assert body["uploaded"] == 2
    assert len(body["reports"]) == 2

    listed = client.get("/api/reports", headers=auth(viewer))
    assert listed.status_code == 200
    names = {row["report_name"] for row in listed.json()}
    assert names == {"Daily Balance", "Exception Report"}
    assert {row["report_code"] for row in listed.json()} == {"RPT-01", "RPT-02"}
    first = listed.json()[0]
    detail = client.get(f"/api/reports/{first['report_id']}", headers=auth(viewer))
    assert detail.status_code == 200
    assert detail.json()["layout"]

    assert (
        client.post(
            "/api/reports/upload",
            data={"country": "SG", "system": "SPL"},
            files=files,
            headers=auth(viewer),
        ).status_code
        == 403
    )

    # Generic RAG Reports inventory is blocked
    blocked = client.post(
        "/api/rag",
        params={"inventory_type": "Reports"},
        files={"file": ("r.md", b"# report", "text/markdown")},
        headers=auth(admin),
    )
    assert blocked.status_code == 400
    assert "reports" in blocked.json()["detail"].lower()

    assert client.delete(f"/api/reports/{first['report_id']}", headers=auth(analyst)).status_code == 200
    assert len(client.get("/api/reports", headers=auth(viewer)).json()) == 1


def test_reports_edit_country_system_and_reject_duplicate_name(client):
    admin = login(client, "Admin")
    _system(client, admin, "SPL")
    _system(client, admin, "DGE")
    analyst = login(client, "SuperAnalyst")
    first = client.post(
        "/api/reports",
        json={
            "country": "SG",
            "system_code": "SPL",
            "report_code": "RPT-01",
            "report_name": "Daily",
            "description": "a",
            "layout": "A",
        },
        headers=auth(analyst),
    )
    assert first.status_code == 200, first.text
    second = client.post(
        "/api/reports",
        json={
            "country": "MY",
            "system_code": "DGE",
            "report_code": "RPT-02",
            "report_name": "Weekly",
            "description": "b",
            "layout": "B",
        },
        headers=auth(analyst),
    )
    assert second.status_code == 200, second.text

    moved = client.patch(
        f"/api/reports/{first.json()['report_id']}",
        json={"country": "MY", "system_code": "DGE", "report_name": "Daily"},
        headers=auth(analyst),
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["country"] == "MY"
    assert moved.json()["system_code"] == "DGE"

    dup = client.patch(
        f"/api/reports/{first.json()['report_id']}",
        json={"country": "MY", "system_code": "DGE", "report_name": "weekly"},
        headers=auth(analyst),
    )
    assert dup.status_code == 400
    assert "already exists" in dup.json()["detail"].lower()


def test_report_frequency_includes_adhoc_and_quarterly(client):
    admin = login(client, "Admin")
    _system(client, admin)
    created = client.post(
        "/api/reports",
        json={
            "country": "SG",
            "system_code": "SPL",
            "report_code": "RPT-Q",
            "report_name": "Quarter Pack",
            "frequency": "quarterly, adhoc",
            "description": "q",
            "layout": "L",
        },
        headers=auth(admin),
    )
    assert created.status_code == 200, created.text
    assert created.json()["frequency"] == "Adhoc, Quarterly"

    uploaded = client.post(
        "/api/reports/upload",
        data={"country": "SG", "system": "SPL"},
        files={
            "file": (
                "reports.xlsx",
                _excel(
                    [
                        ["RPT-UP", "Uploaded", "From a sheet", "adhoc, quarterly", "L"],
                        ["RPT-OT", "Custom", "Other cadence", "Other: Biweekly", "L"],
                    ]
                ),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=auth(admin),
    )
    assert uploaded.status_code == 200, uploaded.text
    by_code = {row["report_code"]: row for row in uploaded.json()["reports"]}
    assert by_code["RPT-UP"]["frequency"] == "Adhoc, Quarterly"
    assert by_code["RPT-OT"]["frequency"] == "Other"
    assert by_code["RPT-OT"]["frequency_other"] == "Biweekly"

    rejected_sheet = client.post(
        "/api/reports/upload",
        data={"country": "SG", "system": "SPL"},
        files={
            "file": (
                "bad.xlsx",
                _excel([["RPT-BAD", "Nope", "x", "Yearly", "L"]]),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=auth(admin),
    )
    assert rejected_sheet.status_code == 400
    assert rejected_sheet.json()["errors"][0]["field"] == "FREQUENCY"
    assert "RPT-BAD" not in {row["report_code"] for row in client.get("/api/reports", headers=auth(admin)).json()}

    rejected = client.post(
        "/api/reports",
        json={
            "country": "SG",
            "system_code": "SPL",
            "report_code": "RPT-X",
            "report_name": "Bad",
            "frequency": "Yearly",
            "description": "q",
            "layout": "L",
        },
        headers=auth(admin),
    )
    assert rejected.status_code == 400
    assert "Adhoc" in rejected.json()["detail"] and "Quarterly" in rejected.json()["detail"]
