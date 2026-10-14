from app.services import export
from tests.conftest import auth, login


def _doc(client):
    writer = login(client, "Write")
    project_id = client.post("/api/projects", json={"project_name": "Rich"}, headers=auth(writer)).json()["project_id"]
    document = client.get(f"/api/projects/{project_id}/documents", headers=auth(writer)).json()[0]
    return writer, f"/api/projects/{project_id}/documents/{document['document_id']}"


def test_header_size_chosen_in_the_document_is_kept(client):
    writer, base = _doc(client)
    section = client.post(f"{base}/sections", json={"section_name": "Sized", "blocks": [{"type": "header", "text": "T", "level": 1}]}, headers=auth(writer)).json()
    sid = next(item["template_id"] for item in section["templates"] if item["section_name"] == "Sized")
    content = section["content_json"]
    assert content["sections"][sid]["blocks"][0]["level"] == 1
    content["sections"][sid]["blocks"][0].update({"text": "Bigger", "level": 3})
    saved = client.put(base, json={"content_json": content}, headers=auth(writer)).json()
    assert saved["content_json"]["sections"][sid]["blocks"][0] == {"type": "header", "text": "Bigger", "level": 3}
    content["sections"][sid]["blocks"][0]["level"] = 9
    clamped = client.put(base, json={"content_json": content}, headers=auth(writer)).json()
    assert clamped["content_json"]["sections"][sid]["blocks"][0]["level"] == 3


def _templates():
    return [{"template_id": "s", "parent_id": None, "section_name": "S", "sequence_order": 100}]


def _content(blocks):
    return {"sections": {"s": {"blocks": blocks}}}


def test_html_export_renders_prose_and_cell_formatting():
    page = export.render_html(
        "T",
        _templates(),
        _content(
            [
                {"type": "prose", "markdown": "Some **bold** and *italic* text\n\n- one\n- two\n\n[link](https://example.com)"},
                {"type": "table", "columns": ["A", "B"], "rows": [["**x**", "- a\n- b"]]},
            ]
        ),
    )
    assert "<strong>bold</strong>" in page and "<em>italic</em>" in page
    assert "<li>one</li>" in page and '<a href="https://example.com">link</a>' in page
    assert "<td><strong>x</strong></td>" in page
    assert "<td><ul>" in page and "<li>a</li>" in page


def test_html_export_does_not_let_raw_html_through():
    page = export.render_html("T", _templates(), _content([{"type": "prose", "markdown": "<script>alert(1)</script> hi"}, {"type": "table", "columns": ["A"], "rows": [["<img src=x onerror=1>"]]}]))
    assert "<script>" not in page and "<img" not in page
    assert "&lt;script&gt;" in page


def test_markdown_export_keeps_multi_line_cells_in_one_row():
    text = export.render_markdown("T", _templates(), _content([{"type": "table", "columns": ["A"], "rows": [["- a\n- b"]]}]))
    assert "| \u2022 a<br>\u2022 b |" in text


def test_pdf_with_lists_in_cells_and_unusual_characters_is_built(monkeypatch):
    # WeasyPrint is not needed for this: the FPDF fallback must cope with what the rich text editor produces.
    monkeypatch.setattr(export, "_render_pdf_weasyprint", lambda page: None)
    content = _content(
        [
            {"type": "prose", "markdown": "Smart \u201cquotes\u201d \u2014 and \u2022 bullets, plus \u65e5\u672c"},
            {"type": "table", "columns": ["A", "B"], "rows": [["satu\n- dua\n- tiga\n  - nested", "**bold** and [link](https://x.io)\n\nsecond paragraph"], ["1. one\n2. two", "plain"]]},
        ]
    )
    pdf = export.render_pdf_document("T", [{"template_id": "s", "parent_id": None, "section_name": "S \u2013 dash", "sequence_order": 100}], content)
    assert pdf.startswith(b"%PDF")


def test_cell_text_is_flattened_for_the_pdf():
    from bs4 import BeautifulSoup

    page = export.render_html("T", _templates(), _content([{"type": "table", "columns": ["A"], "rows": [["satu\n- dua\n- tiga\n  - nested"], ["**bold** and [link](https://x.io)\n\nsecond"], ["1. one\n2. two"]]}]))
    cells = [export._cell_text(cell) for cell in BeautifulSoup(page, "html.parser").find_all("td")]
    assert cells == ["satu\n- dua\n- tiga\n  - nested", "bold and link\nsecond", "1. one\n2. two"]


def test_pdf_falls_back_to_plain_text_when_the_html_cannot_be_laid_out(monkeypatch):
    from fpdf import FPDF

    monkeypatch.setattr(export, "_render_pdf_weasyprint", lambda page: None)

    def refuse(self, text, *args, **kwargs):
        raise NotImplementedError("unsupported")

    monkeypatch.setattr(FPDF, "write_html", refuse)
    pdf = export.render_pdf_document("T", _templates(), _content([{"type": "prose", "markdown": "Some text"}]))
    assert pdf.startswith(b"%PDF")


def test_markdown_cell_bullets_stay_on_one_row_with_bullet_characters():
    text = export.render_markdown("T", _templates(), _content([{"type": "table", "columns": ["A"], "rows": [["satu\n- dua\n* tiga | x"]]}]))
    assert "| satu<br>\u2022 dua<br>\u2022 tiga \\| x |" in text
    assert "| --- |" in text


def test_fallback_pdf_draws_table_borders_in_helvetica(monkeypatch):
    monkeypatch.setattr(export, "_render_pdf_weasyprint", lambda page: None)
    pdf = export.render_pdf_document("T", _templates(), _content([{"type": "table", "columns": ["A"], "rows": [["x"]]}]))
    assert b"Helvetica" in pdf and b"Times" not in pdf


def test_homebrew_libraries_are_made_visible_to_weasyprint_on_macos(monkeypatch, tmp_path):
    monkeypatch.setattr(export.sys, "platform", "darwin")
    monkeypatch.delenv("DYLD_FALLBACK_LIBRARY_PATH", raising=False)
    monkeypatch.setattr(export.os.path, "isdir", lambda folder: folder == "/opt/homebrew/lib")
    export._find_native_libraries()
    export._find_native_libraries()
    assert export.os.environ["DYLD_FALLBACK_LIBRARY_PATH"] == "/opt/homebrew/lib"
