from app.content import sanitize_content
from app.flow import (
    DEFAULT_FLOWCHART,
    STARTER_SEQUENCE,
    default_flowchart,
    flow_to_mermaid,
    flowchart_to_mermaid,
    mermaid_to_flow,
    mermaid_to_flowchart,
    normalize_flowchart,
)


def test_sequence_flow_round_trip():
    source = "\n".join(
        [
            "sequenceDiagram",
            "    actor User as User",
            "    participant Core as Settlement Core",
            "    User->>Core: Submit payment",
            "    Core-->>User: Accepted",
        ]
    )
    flow = mermaid_to_flow(source)
    assert flow is not None
    rendered = flow_to_mermaid(flow)
    assert "Submit payment" in rendered
    assert "Accepted" in rendered
    assert "actor User" in rendered


CHART = "\n".join(
    [
        "flowchart TD",
        "  A[Start] --> B{Is it OK?}",
        "  B -->|Yes| C(Done)",
        "  B -- No --> A",
        "  C --> D --> E",
    ]
)


def test_flowchart_is_read_from_mermaid():
    flow = mermaid_to_flowchart(CHART)
    assert flow is not None and flow["direction"] == "TB"
    shapes = {node["id"]: (node["data"]["label"], node["data"]["shape"]) for node in flow["nodes"]}
    assert shapes["A"] == ("Start", "rect") and shapes["B"] == ("Is it OK?", "decision") and shapes["C"] == ("Done", "round")
    assert shapes["D"] == ("D", "rect")
    assert [(e["source"], e["target"], e["label"]) for e in flow["edges"]] == [
        ("A", "B", ""),
        ("B", "C", "Yes"),
        ("B", "A", "No"),
        ("C", "D", ""),
        ("D", "E", ""),
    ]


def test_flowchart_round_trips_through_mermaid():
    flow = mermaid_to_flowchart(CHART)
    text = flowchart_to_mermaid(flow)
    assert text.splitlines()[0] == "flowchart TB"
    assert 'B{"Is it OK?"}' in text and 'C("Done")' in text and "B -->|Yes| C" in text and "B -->|No| A" in text
    again = mermaid_to_flowchart(text)
    assert again is not None
    assert [(n["id"], n["data"]) for n in again["nodes"]] == [(n["id"], n["data"]) for n in flow["nodes"]]
    assert [(e["source"], e["target"], e["label"]) for e in again["edges"]] == [(e["source"], e["target"], e["label"]) for e in flow["edges"]]


def test_the_default_flowchart_parses_and_is_laid_out_left_to_right():
    flow = default_flowchart()
    assert [node["id"] for node in flow["nodes"]] == ["Source", "System", "Destination"]
    assert [node["position"]["x"] for node in flow["nodes"]] == [0, 240, 480]
    assert mermaid_to_flowchart(DEFAULT_FLOWCHART)["edges"][0]["source"] == "Source"


def test_layout_ignores_edges_that_loop_back():
    flow = mermaid_to_flowchart("flowchart LR\n A --> B\n B --> C\n C --> A\n B --> X")
    position = {node["id"]: node["position"] for node in flow["nodes"]}
    assert position["A"] == {"x": 0, "y": 0} and position["B"] == {"x": 240, "y": 0}
    assert position["C"]["x"] == 480 and position["X"]["x"] == 480 and position["X"]["y"] == 110


def test_unsupported_mermaid_is_left_as_text():
    for source in [
        "flowchart LR\n subgraph s\n A --> B\n end",
        "flowchart LR\n A --> B\n style A fill:#fff",
        "flowchart LR\n A -.-> B",
        "flowchart RL\n A --> B",
        "flowchart LR\n A & B --> C",
        "sequenceDiagram\n A->>B: hi",
        "pie\n a: 1",
        "",
    ]:
        assert mermaid_to_flowchart(source) is None, source


def test_comments_and_semicolons_are_tolerated_and_quotes_survive():
    flow = mermaid_to_flowchart('graph LR;\n%% a note\n A["Say #quot;hi#quot;"] --> B;')
    assert flow["nodes"][0]["data"]["label"] == 'Say "hi"'
    assert 'A["Say #quot;hi#quot;"]' in flowchart_to_mermaid(flow)


def test_flowchart_text_is_made_safe():
    flow = {
        "direction": "TB",
        "nodes": [
            {"id": "end", "position": {"x": 1, "y": 2}, "data": {"label": 'He said "x"\nnext', "shape": "round"}},
            {"id": "2nd", "position": {"x": 0, "y": 0}, "data": {"label": "", "shape": "weird"}},
        ],
        "edges": [{"id": "e1", "source": "end", "target": "2nd", "label": "a|b"}],
    }
    text = flowchart_to_mermaid(flow)
    assert 'end_("He said #quot;x#quot; next")' in text
    assert 'n2nd["2nd"]' in text
    assert "end_ -->|a/b| n2nd" in text


def test_normalize_flowchart_drops_bad_parts():
    assert normalize_flowchart(None) is None and normalize_flowchart({"nodes": []}) is None and normalize_flowchart({"nodes": "x"}) is None
    clean = normalize_flowchart(
        {
            "direction": "RL",
            "nodes": [
                {"id": "a", "position": {"x": "1", "y": 5}, "data": {"label": "A", "shape": "decision"}},
                {"id": "a", "data": {"label": "dup"}},
                {"id": 3},
                "junk",
            ],
            "edges": [{"source": "a", "target": "zzz"}, {"source": "a", "target": "a", "label": "self"}, 7],
        }
    )
    assert clean["direction"] == "LR"
    assert clean["nodes"] == [{"id": "a", "position": {"x": 0.0, "y": 5.0}, "data": {"label": "A", "shape": "decision"}}]
    assert clean["edges"] == [{"id": "e2", "source": "a", "target": "a", "label": "self"}]


def _section(block):
    templates = [{"template_id": "t", "section_name": "T", "schema_json": {"blocks": [block]}}]
    return templates


def test_the_mermaid_text_is_the_source_and_no_drawing_is_stored():
    drawn = {"direction": "LR", "nodes": [{"id": "a", "position": {"x": 0, "y": 0}, "data": {"label": "Old", "shape": "rect"}}], "edges": []}
    content = {"sections": {"t": {"blocks": [{"type": "diagram", "mermaid": "flowchart LR\n  X --> Y", "flow": drawn}]}}}
    block = sanitize_content(content, _section({"type": "diagram", "sequence": False}))["sections"]["t"]["blocks"][0]
    assert block == {"type": "diagram", "sequence": False, "mermaid": "flowchart LR\n  X --> Y"}


def test_sanitize_keeps_any_mermaid_text_and_starts_blank_blocks_with_a_starter():
    er = "erDiagram\n  CUSTOMER ||--o{ ORDER : places"
    for sequence in (False, True):
        block = sanitize_content({"sections": {"t": {"blocks": [{"type": "diagram", "mermaid": er}]}}}, _section({"type": "diagram", "sequence": sequence}))["sections"]["t"]["blocks"][0]
        assert block["mermaid"] == er
    blank = sanitize_content({}, _section({"type": "diagram", "sequence": False}))["sections"]["t"]["blocks"][0]
    assert blank["mermaid"] == DEFAULT_FLOWCHART and "flow" not in blank
    blank = sanitize_content({}, _section({"type": "diagram", "sequence": True}))["sections"]["t"]["blocks"][0]
    assert blank["mermaid"] == STARTER_SEQUENCE
    fenced = {"sections": {"t": {"blocks": [{"type": "diagram", "mermaid": "```mermaid\nflowchart LR\n A-->B\n```\n"}]}}}
    assert sanitize_content(fenced, _section({"type": "diagram", "sequence": False}))["sections"]["t"]["blocks"][0]["mermaid"] == "flowchart LR\n A-->B"


def test_a_flowchart_block_can_hold_a_sequence_diagram_and_the_other_way_round():
    seq_text = "sequenceDiagram\n  A->>B: hi"
    in_flowchart = sanitize_content({"sections": {"t": {"blocks": [{"type": "diagram", "mermaid": seq_text}]}}}, _section({"type": "diagram", "sequence": False}))
    assert in_flowchart["sections"]["t"]["blocks"][0]["mermaid"] == seq_text
    chart = "flowchart LR\n A --> B"
    in_sequence = sanitize_content({"sections": {"t": {"blocks": [{"type": "diagram", "mermaid": chart}]}}}, _section({"type": "diagram", "sequence": True}))
    assert in_sequence["sections"]["t"]["blocks"][0]["mermaid"] == chart


def test_generated_diagrams_keep_their_text_and_drop_code_fences():
    from app.services.generate import _apply

    blocks = _apply([{"type": "diagram", "sequence": False}], {"blocks": [{"type": "diagram", "mermaid": "flowchart LR\n A[Gateway] --> B[Core]"}]}, 100)
    assert blocks[0] == {"type": "diagram", "sequence": False, "mermaid": "flowchart LR\n A[Gateway] --> B[Core]"}
    fenced = _apply([{"type": "diagram", "sequence": False}], {"blocks": [{"type": "diagram", "mermaid": "```mermaid\nclassDiagram\n  A <|-- B\n```"}]}, 100)
    assert fenced[0]["mermaid"] == "classDiagram\n  A <|-- B"
    empty = _apply([{"type": "diagram", "sequence": True}], {"blocks": []}, 100)
    assert empty[0]["mermaid"] == STARTER_SEQUENCE


def test_sequence_text_is_read_strictly():
    flow = mermaid_to_flow("sequenceDiagram\n  actor U as User\n  U->>Core: Pay\n  Core-->>U: Done")
    assert [(n["id"], n["data"]["label"], n["data"]["actor"]) for n in flow["nodes"]] == [("U", "User", True), ("Core", "Core", False)]
    assert [(e["source"], e["target"], e["data"]["kind"]) for e in flow["edges"]] == [("U", "Core", "request"), ("Core", "U", "reply")]
    for source in (
        "sequenceDiagram\n  A->>B: hi\n  Note over A,B: no",
        "sequenceDiagram\n  autonumber\n  A->>B: hi",
        "sequenceDiagram\n  A->>B: hi\n  loop every day\n  B->>A: x\n  end",
        "flowchart LR\n A --> B",
        "",
        "sequenceDiagram",
    ):
        assert mermaid_to_flow(source) is None, source


def test_sanitize_keeps_a_sequence_diagram_text():
    text = "sequenceDiagram\n  A->>B: hi"
    content = {"sections": {"t": {"blocks": [{"type": "diagram", "mermaid": text}]}}}
    block = sanitize_content(content, _section({"type": "diagram", "sequence": True}))["sections"]["t"]["blocks"][0]
    assert block["mermaid"] == text


def test_sequence_participants_may_have_spaces_in_their_names():
    text = "sequenceDiagram\n    participant Source System\n    participant Integration Layer\n    Source System->>Integration Layer: Request Data (e.g., Create)\n    Integration Layer-->>Source System: Done"
    flow = mermaid_to_flow(text)
    assert [(n["id"], n["data"]["label"]) for n in flow["nodes"]] == [("Source System", "Source System"), ("Integration Layer", "Integration Layer")]
    assert [(e["source"], e["target"], e["label"]) for e in flow["edges"]] == [
        ("Source System", "Integration Layer", "Request Data (e.g., Create)"),
        ("Integration Layer", "Source System", "Done"),
    ]
    rewritten = flow_to_mermaid(flow)
    assert "participant SourceSystem as Source System" in rewritten and "SourceSystem->>IntegrationLayer: Request Data (e.g., Create)" in rewritten
    again = mermaid_to_flow(rewritten)
    assert [n["data"]["label"] for n in again["nodes"]] == ["Source System", "Integration Layer"]
