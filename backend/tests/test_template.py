from app.config import template_path
from app.template_parser import parse_template


def test_template_matches_solution_design_document():
    templates = parse_template(template_path())
    top = [item["section_name"] for item in templates if item["parent_id"] is None]
    assert top[0] == "Project Specific References"
    assert "Key Non-Functional Requirements" in top
    assert "Expected DB Size Growth" not in top
    assert "Happy Flows" not in top
    nfr = next(item for item in templates if item["template_id"] == "key-non-functional-requirements")
    table = next(block for block in nfr["schema_json"]["blocks"] if block["type"] == "table")
    assert table["columns"] == ["SN", "NFR", "Requirements"]
    labels = [row[1] for row in table["rows"]]
    assert "Volumetric Projections (next 3 to 5 years)" in labels
    assert "Response Time (for key use cases)" in labels
    children = [item["section_name"] for item in templates if item["parent_id"] == "database-design"]
    assert "Expected DB Size Growth" in children
    assert "Data Model" in children
    assert any(item["template_id"] == "happy-flows" and item["content_kind"] == "mixed" for item in templates)
