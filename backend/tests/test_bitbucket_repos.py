import io
import json

from openpyxl import Workbook
from tests.conftest import auth, login

HEADER = ["BITBUCKET_PROJECT", "BITBUCKET_REPO_NAME", "DESCRIPTION", "MAIN_COMPONENTS"]


def _excel(rows, header=HEADER) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _upload(client, token, project, rows, header=HEADER):
    return client.post(
        f"/api/bitbucket-repos/{project}/upload",
        files={"file": ("repos.xlsx", _excel(rows, header), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth(token),
    )


def test_catalogs_include_bitbucket_projects(client):
    viewer = login(client, "Viewer")
    catalogs = client.get("/api/catalogs", headers=auth(viewer))
    assert catalogs.status_code == 200
    assert catalogs.json()["bitbucket_projects"] == ["CORE", "SPL", "DBE", "PIB", "PIBVN2", "PIBID", "SOF", "WSM", "NTN"]


def test_upload_normalizes_case_and_rejects_another_project(client):
    analyst = login(client, "Analyst")
    viewer = login(client, "Viewer")
    admin = login(client, "Admin")

    upload = _upload(
        client,
        analyst,
        "CORE",
        [
            ["core", "Payment-API", "Handles card payments.", "gateway"],
            ["", "Ledger", "", ""],
        ],
    )
    assert upload.status_code == 200, upload.text
    rows = {row["repo_name"]: row for row in upload.json()}
    assert set(rows) == {"payment-api", "ledger"}
    assert rows["payment-api"]["bitbucket_project"] == "CORE"
    assert "system_code" not in rows["payment-api"]
    assert rows["payment-api"]["description"] == "Handles card payments."
    assert rows["payment-api"]["main_components"] == "gateway"
    assert "ledger" in rows["ledger"]["description"].lower()
    assert "CORE" in rows["ledger"]["description"]

    listed = client.get("/api/bitbucket-repos/core", headers=auth(viewer))
    assert listed.status_code == 200
    assert {row["repo_name"] for row in listed.json()} == {"payment-api", "ledger"}
    assert client.get("/api/bitbucket-repos/SPL", headers=auth(viewer)).json() == []

    # The same repository name can belong to another project.
    other = _upload(client, analyst, "SOF", [["SOF", "Payment-API", "Other project copy.", ""]])
    assert other.status_code == 200, other.text
    assert other.json()[0]["repo_name"] == "payment-api"
    assert other.json()[0]["bitbucket_project"] == "SOF"

    bad = _upload(client, analyst, "CORE", [["SOF", "orphan", "Should not land.", ""]])
    assert bad.status_code == 400
    assert any(err["field"] == "BITBUCKET_PROJECT" for err in bad.json()["errors"])
    assert all(row["repo_name"] != "orphan" for row in client.get("/api/bitbucket-repos/CORE", headers=auth(viewer)).json())

    duplicate = _upload(client, analyst, "CORE", [["CORE", "a", "one", ""], ["core", "A", "two", ""]])
    assert duplicate.status_code == 400
    assert "Duplicate" in duplicate.json()["errors"][0]["message"]

    assert _upload(client, viewer, "CORE", [["CORE", "blocked", "no", ""]]).status_code == 403
    assert client.get("/api/bitbucket-repos/NOPE", headers=auth(viewer)).status_code == 404

    blocked = client.post(
        "/api/rag",
        params={"inventory_type": "Bitbucket Repos"},
        files={"file": ("repos.md", b"# repo", "text/markdown")},
        headers=auth(admin),
    )
    assert blocked.status_code == 400
    assert "Bitbucket Repository" in blocked.json()["detail"]


def test_empty_description_is_kept_on_reupload_and_inferred_when_missing(client, monkeypatch):
    analyst = login(client, "Analyst")

    first = _upload(client, analyst, "PIB", [["PIB", "checkout", "Kept on purpose.", "old"]])
    assert first.status_code == 200, first.text
    again = _upload(client, analyst, "pib", [["pib", "Checkout", "", "new parts"]])
    assert again.status_code == 200, again.text
    saved = next(row for row in again.json() if row["repo_name"] == "checkout")
    assert saved["description"] == "Kept on purpose."
    assert saved["main_components"] == "new parts"
    assert saved["bitbucket_project"] == "PIB"

    calls = []

    def complete(system, user, temperature):
        calls.append(user)
        return json.dumps({"descriptions": ["Inferred by the model."]})

    monkeypatch.setattr("app.services.bitbucket_repos.llm.configured", lambda: True)
    monkeypatch.setattr("app.services.bitbucket_repos.llm.complete", complete)
    created = client.post(
        "/api/bitbucket-repos/sof",
        json={"repo_name": "Notify-Svc", "description": "", "main_components": "mailer"},
        headers=auth(analyst),
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["bitbucket_project"] == "SOF"
    assert body["repo_name"] == "notify-svc"
    assert body["description"] == "Inferred by the model."
    assert calls

    from app.services import reindex, retrieve

    rows = reindex._rows("kb_bitbucket", only_missing=False)
    assert any(text.startswith("Bitbucket repository notify-svc") for _repo_id, text in rows)
    hits = retrieve.retrieve("notify-svc mailer")
    assert any(hit["inventory_type"] == "Bitbucket Repos" and hit["system_name"] == "notify-svc" for hit in hits)
    assert "Bitbucket Repos: PIB 1, SOF 1" in retrieve.summary()
