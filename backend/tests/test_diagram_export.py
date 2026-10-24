import json
import re

import pytest
from app.flow import mermaid_to_flow
from app.services import diagrams, export, mermaid_render
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


_draw_with_mermaid = mermaid_render.render_svgs


@pytest.fixture(autouse=True)
def builtin_drawings(monkeypatch):
    """These tests check the plainer drawings. The Mermaid picture is covered on its own."""
    monkeypatch.setattr(export.mermaid_render, "render_svgs", lambda sources, html_labels=True: [None] * len(sources))


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
    er = diagrams.scene_for_block({"type": "diagram", "mermaid": "erDiagram\n  A ||--o{ B : has"})
    assert er is not None
    assert "A" in [item["text"] for item in er.items if item["kind"] == "text"]


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


PIE = 'pie title Volume by channel\n    "API" : 55\n    "Batch" : 30\n    "File" : 15'
STATE = "stateDiagram-v2\n    [*] --> Received\n    Received --> Validated : valid\n    Received --> Rejected : invalid\n    Validated --> Settled\n    Settled --> [*]\n    Rejected --> [*]"
ER = (
    "erDiagram\n"
    "    CUSTOMER ||--o{ ACCOUNT : holds\n"
    "    ACCOUNT ||--o{ PAYMENT : makes\n"
    "    CUSTOMER {\n"
    "        string id\n"
    "        string name\n"
    "    }\n"
    "    PAYMENT {\n"
    "        string id\n"
    "        decimal amount\n"
    "    }"
)
GANTT = (
    "gantt\n"
    "    title Delivery plan\n"
    "    dateFormat YYYY-MM-DD\n"
    "    section Build\n"
    "    Design      :a1, 2026-01-05, 10d\n"
    "    Development :after a1, 20d\n"
    "    section Release\n"
    "    UAT         :10d\n"
    "    Go live     :milestone, 2026-03-01, 0d"
)


def test_html_export_draws_pie_state_er_and_gantt():
    page = export.render_html("T", TEMPLATES, _content(
        {"type": "diagram", "sequence": False, "mermaid": PIE},
        {"type": "diagram", "sequence": False, "mermaid": STATE},
        {"type": "diagram", "sequence": False, "mermaid": ER},
        {"type": "diagram", "sequence": False, "mermaid": GANTT},
    ))
    assert page.count("<svg ") == 4
    assert "<pre>" not in page
    for label in (
        "Volume by channel",
        "API (55)",
        "Batch (30)",
        "Received",
        "Validated",
        "valid",
        "Start",
        "End",
        "CUSTOMER",
        "1 holds 0..*",
        "string id",
        "Delivery plan",
        "Design",
        "Development",
        "Go live",
    ):
        assert f">{label}</text>" in page, label
    assert "stateDiagram-v2" not in page and "erDiagram" not in page and "dateFormat" not in page


ADDED = {
    "journey": "journey\n    title Pay a bill\n    section Sign in\n      Open the app: 5: Customer",
    "c4": 'C4Context\n    Person(customer, "Customer", "A bank customer")\n    System(banking, "Internet Banking", "Views accounts")\n    Rel(customer, banking, "Uses")',
    "architecture": "architecture-beta\n    service db(database)[Database]\n    service server(server)[Server]\n    db:R --> L:server",
    "block": 'block-beta\n    columns 3\n    Customer["Customer"] Account["Account"] Payment["Payment"]\n    Customer --> Account',
    "requirement": "requirementDiagram\n    requirement pay {\n    text: the customer can pay a bill\n    }\n    element gateway {\n    type: service\n    }\n    gateway - satisfies -> pay",
    "usecase": 'usecase-beta\n    actor Customer\n    SignIn("Sign in")\n    Customer --> SignIn',
    "mindmap": "mindmap\n  root((Payments))\n    Card\n      Auth",
    "tree": "treeView-beta\n    payments/\n        src/\n            pay.js",
    "swimlane": "swimlane-beta LR\n    subgraph Customer\n        request[Request service]\n    end\n    subgraph Support\n        triage[Triage request]\n    end\n    request --> triage",
}


def test_html_and_pdf_draw_the_added_diagram_types():
    blocks = [{"type": "diagram", "mermaid": text} for text in ADDED.values()]
    for block in blocks:
        scene = diagrams.scene_for_block(block)
        assert scene is not None and scene.items, block["mermaid"].splitlines()[0]
        for item in scene.items:
            xs = [item[key] for key in ("x", "x1", "x2") if key in item] + [point[0] for point in item.get("points", [])]
            ys = [item[key] for key in ("y", "y1", "y2") if key in item] + [point[1] for point in item.get("points", [])]
            assert all(0 <= x <= scene.width + 0.1 for x in xs)
            assert all(0 <= y <= scene.height + 0.1 for y in ys)
    page = export.render_html("T", TEMPLATES, _content(*blocks))
    assert page.count("<svg ") == len(blocks)
    assert "<pre>" not in page
    for label in ("Pay a bill", "Open the app", "Internet Banking", "Database", "Account", "can pay", "Sign in", "Auth", "pay.js", "Request service", "Triage request"):
        assert label in page, label
    pdf = export.render_pdf_document("T", TEMPLATES, _content(*blocks))
    assert pdf.startswith(b"%PDF") and len(pdf) > 1000


def test_pdf_export_includes_the_extra_diagrams():
    content = _content(
        {"type": "diagram", "mermaid": PIE},
        {"type": "diagram", "mermaid": STATE},
        {"type": "diagram", "mermaid": ER},
        {"type": "diagram", "mermaid": GANTT},
    )
    pdf = export.render_pdf_document("T", TEMPLATES, content)
    assert pdf.startswith(b"%PDF") and len(pdf) > 1000


def test_scene_stays_inside_its_canvas():
    extra = [
        {"type": "diagram", "mermaid": PIE},
        {"type": "diagram", "mermaid": STATE},
        {"type": "diagram", "mermaid": ER},
        {"type": "diagram", "mermaid": GANTT},
    ]
    for block in (_flowchart_block(), _sequence_block(), _class_block(), _flowchart_block("flowchart TB\n A --> A\n A --> B"), *extra):
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
    saved = client.get(base, headers=auth(writer)).json()
    page = export.render_html("Diagrams", saved["templates"], saved["content_json"])
    assert "<svg" in page and "flowchart LR" not in page
    assert client.get(f"{base}/export?format=html", headers=auth(writer)).status_code == 400
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


def test_html_export_embeds_the_mermaid_picture(monkeypatch):
    picture = '<svg id="exportDiagram0" xmlns="http://www.w3.org/2000/svg"><text>Start</text></svg>'
    monkeypatch.setattr(export.mermaid_render, "render_svgs", lambda sources, html_labels=True: [picture] * len(sources))
    page = export.render_html("T", TEMPLATES, _content(_flowchart_block()))
    assert 'id="exportDiagram0"' in page and "<pre>" not in page and "flowchart LR" not in page


def test_html_keeps_mermaid_labels_and_pdf_asks_for_svg_text(monkeypatch):
    seen = []

    def spy(sources, html_labels=True):
        seen.append(html_labels)
        return ['<svg xmlns="http://www.w3.org/2000/svg"><text>Start</text></svg>'] * len(sources)

    monkeypatch.setattr(export.mermaid_render, "render_svgs", spy)
    html_page = export.render_html("T", TEMPLATES, _content(_flowchart_block()))
    pdf_page, _ = export._render_html("T", TEMPLATES, _content(_flowchart_block()), pdf=True)
    assert seen == [True, False]
    assert "<text>Start</text>" in html_page and "<text>Start</text>" in pdf_page


def test_a_diagram_mermaid_cannot_draw_falls_back_to_the_plainer_picture(monkeypatch):
    monkeypatch.setattr(export.mermaid_render, "render_svgs", lambda sources, html_labels=True: [None] * len(sources))
    page = export.render_html("T", TEMPLATES, _content(_flowchart_block()))
    assert "<svg " in page and ">Start</text>" in page and "flowchart LR" not in page


def test_mermaid_pictures_are_half_the_natural_size():
    cleaned = mermaid_render._picture(
        {"svg": '<svg id="exportDiagram0" width="100%" style="max-width: 400px;" viewBox="-10 0 400 200"></svg>'}
    )
    assert cleaned is not None
    assert 'width="200"' in cleaned and 'height="100"' in cleaned and "max-width: 200px" in cleaned
    assert 'width="100%"' not in cleaned


def test_a_script_in_a_diagram_picture_is_removed():
    cleaned = mermaid_render._picture(
        {"svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text onclick="x">Hi</text></svg>'}
    )
    assert cleaned is not None and "<script" not in cleaned and "onclick" not in cleaned and ">Hi</text>" in cleaned


def test_chrome_draws_the_same_mermaid_picture_as_markdown(monkeypatch):
    monkeypatch.setattr(export.mermaid_render, "render_svgs", _draw_with_mermaid)
    page = export.render_html("T", TEMPLATES, _content(_flowchart_block(), {"type": "diagram", "mermaid": PIE}))
    if "exportDiagram0" not in page:
        pytest.skip("Chrome is not available to draw Mermaid")
    assert "exportDiagram1" in page and "Start" in page and "API" in page
    assert "flowchart LR" not in page and "<pre>" not in page


def test_json_round_trip_of_a_scene_is_plain_data():
    scene = diagrams.scene_for_block(_flowchart_block())
    assert json.loads(json.dumps(scene.items, default=list))
    svg = diagrams.to_svg(scene)
    assert re.search(r'viewBox="0 0 [\d.]+ [\d.]+"', svg)
    shown = re.search(r'width="([\d.]+)" height="([\d.]+)"', svg)
    assert shown is not None
    assert float(shown.group(1)) <= scene.width * diagrams.EXPORT_SCALE + 0.1
    assert float(shown.group(2)) <= min(scene.height * diagrams.EXPORT_SCALE, diagrams.MAX_DISPLAY_HEIGHT) + 0.1
