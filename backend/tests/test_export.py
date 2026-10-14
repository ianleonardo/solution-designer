from app.config import template_path
from app.template_parser import parse_template
from tests.conftest import auth, login


def test_markdown_export_includes_top_level_sections_in_order(client):
    maker = login(client, "Maker")
    created = client.post("/api/projects", json={"project_name": "Export Me"}, headers=auth(maker))
    project_id = created.json()["project_id"]
    exported = client.get(f"/api/projects/{project_id}/export?format=md", headers=auth(maker))
    assert exported.status_code == 200
    text = exported.text
    top = [item["section_name"] for item in parse_template(template_path()) if item["parent_id"] is None]
    indexes = [text.index(f"## {name}") for name in top]
    assert indexes == sorted(indexes)
    html = client.get(f"/api/projects/{project_id}/export?format=html", headers=auth(maker))
    assert html.status_code == 200
    assert "<h2>Key Functional Requirements</h2>" in html.text
    pdf = client.get(f"/api/projects/{project_id}/export?format=pdf", headers=auth(maker))
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF-")
    viewer = login(client, "Viewer")
    assert client.get(f"/api/projects/{project_id}/export?format=md", headers=auth(viewer)).status_code == 200
