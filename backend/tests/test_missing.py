from app.config import template_path
from app.content import blank_content
from app.missing import evaluate_missing
from app.template_parser import parse_template


def _blank():
    return blank_content(parse_template(template_path()))


def test_empty_draft_flags_required_gaps():
    content = _blank()
    nfr = content["sections"]["key-non-functional-requirements"]["missing"]
    messages = [item["message"] for item in nfr]
    assert "Missing NFR volumetric projections" in messages
    assert "Missing maximum load" in messages
    assert "Missing peak load" in messages
    assert "Missing concurrent user load" in messages
    assert "Missing response time" in messages
    growth = content["sections"]["expected-db-size-growth"]["missing"]
    assert growth[0]["message"] == "Missing database growth estimates"


def test_filled_requirements_clear_flags():
    content = _blank()
    table = next(
        block
        for block in content["sections"]["key-non-functional-requirements"]["blocks"]
        if block["type"] == "table"
    )
    columns = table["columns"]
    nfr_index = columns.index("NFR")
    value_index = columns.index("Requirements")
    for row in table["rows"]:
        if row[nfr_index] in {
            "Volumetric Projections (next 3 to 5 years)",
            "Maximum Load/Users",
            "Peak Load/Users",
            "Concurrent Users (TPS)",
            "Response Time (for key use cases)",
        }:
            row[value_index] = "stated in the BRD"
    for block in content["sections"]["expected-db-size-growth"]["blocks"]:
        if block["type"] == "prose":
            block["markdown"] = "Database grows by 20 GB a year."
    evaluate_missing(content)
    assert content["sections"]["key-non-functional-requirements"]["missing"] == []
    assert content["sections"]["expected-db-size-growth"]["missing"] == []
