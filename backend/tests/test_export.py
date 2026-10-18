from app.config import template_path
from app.template_parser import parse_template
from tests.conftest import auth, login


def test_nested_sections_export_as_deeper_headings():
    from app.services.export import render_html, render_markdown

    templates = [
        {"template_id": "a", "parent_id": None, "section_name": "Main", "sequence_order": 1},
        {"template_id": "b", "parent_id": "a", "section_name": "Child", "sequence_order": 2},
        {"template_id": "c", "parent_id": "b", "section_name": "Grandchild", "sequence_order": 3},
    ]
    content = {"sections": {}}
    text = render_markdown("Doc", templates, content)
    assert "## Main" in text and "### Child" in text and "#### Grandchild" in text
    page = render_html("Doc", templates, content)
    assert "<h2>Main</h2>" in page and "<h3>Child</h3>" in page and "<h4>Grandchild</h4>" in page


def test_markdown_export_includes_top_level_sections_in_order(client):
    writer = login(client, "Write")
    created = client.post("/api/projects", json={"project_name": "Export Me"}, headers=auth(writer))
    project_id = created.json()["project_id"]
    exported = client.get(f"/api/projects/{project_id}/export?format=md", headers=auth(writer))
    assert exported.status_code == 200
    text = exported.text
    top = [item["section_name"] for item in parse_template(template_path()) if item["parent_id"] is None]
    indexes = [text.index(f"## {name}") for name in top]
    assert indexes == sorted(indexes)
    html = client.get(f"/api/projects/{project_id}/export?format=html", headers=auth(writer))
    assert html.status_code == 200
    assert "<h2>Key Functional Requirements</h2>" in html.text
    pdf = client.get(f"/api/projects/{project_id}/export?format=pdf", headers=auth(writer))
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF-")
    reader = login(client, "Read")
    assert client.get(f"/api/projects/{project_id}/export?format=md", headers=auth(reader)).status_code == 200


def _document_parts(client):
    from app.services import documents

    writer = login(client, "Write")
    project_id = client.post("/api/projects", json={"project_name": "Sizes"}, headers=auth(writer)).json()["project_id"]
    row = documents.document_row(project_id)
    return "Sizes", documents.document_templates(row), documents.payload(row)["content_json"]


def test_the_pdf_text_is_set_at_75_percent_of_the_html_sizes(client, monkeypatch):
    from app.services import export

    title, templates, content = _document_parts(client)
    html = export.render_html(title, templates, content)
    assert "font-size:14px" in html and "10.5px" not in html and "font-size:12px" not in html

    captured = {}
    monkeypatch.setattr(export, "_render_pdf_weasyprint", lambda page: captured.setdefault("page", page).encode())
    assert export.render_pdf_document(title, templates, content).startswith(b"<!DOCTYPE")
    page = captured["page"]
    assert "body{font-size:12px;}" in page and "th,td{font-size:10.5px;}" in page and "pre{font-size:9.75px;}" in page
    # The override comes after the HTML sizes so it wins.
    assert page.index("font-size:14px") < page.index("th,td{font-size:10.5px;}")


def test_the_pdf_fallback_uses_75_percent_font_sizes(client, monkeypatch):
    from app.services import export
    from fpdf import FPDF

    title, templates, content = _document_parts(client)
    sizes: list[float] = []
    original = FPDF.set_font

    def spy(self, family=None, style="", size=0):
        sizes.append(size)
        return original(self, family, style, size)

    monkeypatch.setattr(FPDF, "set_font", spy)
    monkeypatch.setattr(export, "_render_pdf_weasyprint", lambda page: None)
    assert export.render_pdf_document(title, templates, content).startswith(b"%PDF-")
    assert 7.5 in sizes and 10 not in sizes

    styles = export._scaled_tag_styles()
    assert styles["h1"].size_pt == 18 and styles["h2"].size_pt == 13.5 and styles["h3"].size_pt == 10.5

    sizes.clear()
    soup = __import__("bs4").BeautifulSoup("<h1>Title</h1><h3>Sub</h3><p>Text</p>", "html.parser")
    assert export._render_pdf_plain(soup).startswith(b"%PDF-")
    assert set(sizes) >= {10.5, 8.25, 7.5} and 14 not in sizes and 11 not in sizes
