import json
import re

from app.flow import mermaid_to_flow
from app.services import diagrams, export
from tests.conftest import auth, login

TEMPLATES = [{"template_id": "s", "parent_id": None, "section_name": "Flows", "sequence_order": 100}]
FLOWCHART = "flowchart LR\n  A[Start] --> B{Is it OK?}\n  B -->|Yes| C(Done)\n  B -->|No| A"
SEQUENCE = "sequenceDiagram\n  actor User as Customer\n  participant Core as Settlement Core\n  User->>Core: Submit payment\n  Core-->>User: Accepted\n  Core->>Core: Validate"
CLASS = (
    "classDiagram\n"
    "    class Payment {\n"
    "        +String id\n"
    "        +Decimal amount\n"
    "        +submit()\n"
    "    }\n"
    "    class Account {\n"
    "        +String number\n"
    "    }\n"
    '    Account "1" --> "*" Payment : owns'
)


def _content(*blocks):
    return {"sections": {"s": {"blocks": list(blocks)}}}


def _flowchart_block(mermaid=FLOWCHART):
    return {"type": "diagram", "sequence": False, "mermaid": mermaid, "flow": None}


def _sequence_block(mermaid=SEQUENCE):
    return {"type": "diagram", "sequence": True, "mermaid": mermaid, "flow": mermaid_to_flow(mermaid)}


def _class_block(mermaid=CLASS):
    return {"type": "diagram", "sequence": False, "mermaid": mermaid, "flow": None}


def test_html_export_draws_diagrams_as_svg_not_source_text():
    page = export.render_html("T", TEMPLATES, _content(_flowchart_block(), _sequence_block(), _class_block()))
    assert page.count("<svg ") == 3
    assert "<pre>" not in page and "flowchart LR" not in page and "sequenceDiagram" not in page and "classDiagram" not in page
    for label in ("Start", "Is it OK?", "Yes", "Done", "Customer", "Settlement Core", "Submit payment", "Accepted", "Validate", "Payment", "Account", "+String id", "+submit()", "1 owns *"):
        assert f">{label}</text>" in page, label
    assert page.count("<polygon") >= 5  # the decision diamond and the arrow heads


def test_svg_text_is_escaped():
    block = _flowchart_block('flowchart LR\n  A["<b>x</b> & y"] --> B')
    page = export.render_html("T", TEMPLATES, _content(block))
    assert "<b>x</b>" not in page and "&lt;b&gt;x&lt;/b&gt; &amp; y" in page


def test_diagrams_the_app_cannot_draw_keep_their_source():
    odd = "flowchart LR\n  subgraph s\n  A --> B\n  end"
    page = export.render_html("T", TEMPLATES, _content(_flowchart_block(odd), _sequence_block("sequenceDiagram\n  A->>B: hi\n  Note over A,B: careful")))
    assert "<svg" not in page and page.count("<pre>") == 2
    assert "subgraph s" in page and "Note over" in page


def test_the_scene_is_drawn_from_the_mermaid_text_whatever_else_the_block_holds():
    block = {"type": "diagram", "sequence": True, "mermaid": "flowchart TB\n  a[Drawn one] --> b(Drawn two)", "flow": {"stale": True}}
    scene = diagrams.scene_for_block(block)
    assert scene is not None
    texts = [item["text"] for item in scene.items if item["kind"] == "text"]
    assert texts == ["Drawn one", "Drawn two"]
    assert scene.height > scene.width * 0.5 and scene.width > 0
    assert diagrams.scene_for_block({"type": "diagram", "mermaid": "erDiagram\n  A ||--o{ B : has"}) is None


def test_html_export_draws_class_diagrams():
    scene = diagrams.scene_for_block(_class_block())
    assert scene is not None
    texts = [item["text"] for item in scene.items if item["kind"] == "text"]
    assert "Payment" in texts and "Account" in texts
    assert "+String id" in texts and "+submit()" in texts
    page = export.render_html("T", TEMPLATES, _content(_class_block()))
    assert "<svg " in page and "<pre>" not in page and "classDiagram" not in page


def test_class_diagram_skips_direction_and_notes_instead_of_falling_back_to_source():
    mermaid = (
        "classDiagram\n"
        "    direction LR\n"
        "    note for Payment \"settlement\"\n"
        "    class Payment {\n"
        "        +submit()\n"
        "    }\n"
        "    class Account\n"
        "    Account --> Payment : owns\n"
    )
    scene = diagrams.scene_for_block(_class_block(mermaid))
    assert scene is not None
    texts = [item["text"] for item in scene.items if item["kind"] == "text"]
    assert "Payment" in texts and "Account" in texts and "+submit()" in texts
    page = export.render_html("T", TEMPLATES, _content(_class_block(mermaid)))
    assert "<svg " in page and "classDiagram" not in page and "direction LR" not in page


def test_scene_stays_inside_its_canvas():
    for block in (_flowchart_block(), _sequence_block(), _class_block(), _flowchart_block("flowchart TB\n A --> A\n A --> B")):
        scene = diagrams.scene_for_block(block)
        for item in scene.items:
            xs = [item[k] for k in ("x", "x1", "x2") if k in item] + [p[0] for p in item.get("points", [])]
            ys = [item[k] for k in ("y", "y1", "y2") if k in item] + [p[1] for p in item.get("points", [])]
            assert all(0 <= x <= scene.width for x in xs), item
            assert all(0 <= y <= scene.height for y in ys), item


def test_markdown_export_keeps_the_mermaid_fence():
    text = export.render_markdown("T", TEMPLATES, _content(_flowchart_block()))
    assert "```mermaid\nflowchart LR" in text


def test_pdf_export_draws_the_diagrams(client):
    writer = login(client, "Write")
    project_id = client.post("/api/projects", json={"project_name": "Diagrams"}, headers=auth(writer)).json()["project_id"]
    listing = client.get(f"/api/projects/{project_id}/documents", headers=auth(writer)).json()[0]
    base = f"/api/projects/{project_id}/documents/{listing['document_id']}"
    document = client.get(base, headers=auth(writer)).json()
    sections = document["content_json"]["sections"]
    key = next(k for k, s in sections.items() if any(b["type"] == "diagram" and not b["sequence"] for b in s["blocks"]))
    block = next(b for b in sections[key]["blocks"] if b["type"] == "diagram")
    block.update({"mermaid": FLOWCHART, "flow": None})
    assert client.put(base, json={"content_json": {"sections": sections}}, headers=auth(writer)).status_code == 200
    html_page = client.get(f"{base}/export?format=html", headers=auth(writer))
    assert html_page.status_code == 200 and "<svg" in html_page.text and "flowchart LR" not in html_page.text
    pdf = client.get(f"{base}/export?format=pdf", headers=auth(writer))
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    plain = client.get(f"{base}/export?format=md", headers=auth(writer)).text
    assert "```mermaid" in plain


def test_fallback_pdf_places_diagrams_between_text(monkeypatch):
    monkeypatch.setattr(export, "_render_pdf_weasyprint", lambda page: None)
    seen = []
    real = diagrams.draw_pdf

    def spy(pdf, scene, width):
        seen.append((round(scene.width), round(width)))
        real(pdf, scene, width)

    monkeypatch.setattr(diagrams, "draw_pdf", spy)
    content = _content({"type": "prose", "markdown": "Before the picture"}, _flowchart_block(), {"type": "prose", "markdown": "After"}, _sequence_block())
    pdf = export.render_pdf_document("T", TEMPLATES, content)
    assert pdf.startswith(b"%PDF") and len(seen) == 2
    assert all(width > 0 for _, width in seen)


def test_json_round_trip_of_a_scene_is_plain_data():
    scene = diagrams.scene_for_block(_flowchart_block())
    assert json.loads(json.dumps(scene.items, default=list))
    assert re.search(r'viewBox="0 0 [\d.]+ [\d.]+"', diagrams.to_svg(scene))
