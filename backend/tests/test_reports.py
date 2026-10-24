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
    assert first.json()["sample"] is None
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


def test_report_sample_can_be_uploaded_previewed_and_deleted(client):
    admin = login(client, "Admin")
    _system(client, admin)
    analyst = login(client, "SuperAnalyst")
    viewer = login(client, "Viewer")
    created = client.post(
        "/api/reports",
        json={"country": "SG", "system_code": "SPL", "report_code": "RPT-01", "report_name": "Daily", "layout": "A"},
        headers=auth(analyst),
    )
    assert created.status_code == 200, created.text
    report_id = created.json()["report_id"]
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    forbidden = client.post(f"/api/reports/{report_id}/sample", files={"file": ("balance.png", png, "image/png")}, headers=auth(viewer))
    assert forbidden.status_code == 403
    rejected = client.post(f"/api/reports/{report_id}/sample", files={"file": ("notes.bin", b"\x00\x01", "application/octet-stream")}, headers=auth(analyst))
    assert rejected.status_code == 400 and "text" in rejected.json()["detail"]
    text = client.post(f"/api/reports/{report_id}/sample", files={"file": ("notes.txt", b"Posted SGD 10.00", "text/plain")}, headers=auth(analyst))
    assert text.status_code == 200, text.text
    assert text.json()["sample"] == {"filename": "notes.txt", "media_type": "text/plain"}
    text_preview = client.get(f"/api/reports/{report_id}/sample", headers=auth(viewer))
    assert text_preview.status_code == 200 and text_preview.content == b"Posted SGD 10.00"
    assert text_preview.headers["content-type"].startswith("text/plain")

    uploaded = client.post(f"/api/reports/{report_id}/sample", files={"file": ("balance.png", png, "image/png")}, headers=auth(analyst))
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["sample"] == {"filename": "balance.png", "media_type": "image/png"}
    preview = client.get(f"/api/reports/{report_id}/sample", headers=auth(viewer))
    assert preview.status_code == 200
    assert preview.content.startswith(b"\x89PNG")
    assert preview.headers["content-type"].startswith("image/png")

    removed = client.delete(f"/api/reports/{report_id}/sample", headers=auth(analyst))
    assert removed.status_code == 200 and removed.json()["sample"] is None
    assert client.get(f"/api/reports/{report_id}/sample", headers=auth(viewer)).status_code == 404
