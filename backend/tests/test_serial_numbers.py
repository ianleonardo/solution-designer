import pytest
from app.content import number_rows, sanitize_content, section_is_empty, serial_column
from tests.conftest import auth, login

SN_COLUMNS = ["SN", "Item", "Detail"]


@pytest.mark.parametrize("header", ["SN", "sn", "S/N", "s.n.", "No", "No.", "#", "Serial No", "Serial No.", "serial number", " SN "])
def test_serial_columns_are_found_by_their_header(header):
    assert serial_column([header, "Other"]) == 0


@pytest.mark.parametrize("columns", [[], ["Item", "SN"], ["Name", "Detail"], ["Snack"], ["Number of users"], ["Notes"]])
def test_other_tables_have_no_serial_column(columns):
    assert serial_column(columns) == -1


def test_rows_are_numbered_in_order_and_other_tables_are_left_alone():
    assert number_rows(SN_COLUMNS, [["9", "a", ""], ["", "b", "x"], ["3", "c", ""]]) == [["1", "a", ""], ["2", "b", "x"], ["3", "c", ""]]
    rows = [["z", "a"], ["y", "b"]]
    assert number_rows(["Name", "Detail"], rows) == rows
    assert number_rows(SN_COLUMNS, []) == []


def _section(columns, rows):
    templates = [{"template_id": "t", "section_name": "T", "schema_json": {"blocks": [{"type": "table", "columns": columns, "rows": [[""] * len(columns)]}]}}]
    content = {"sections": {"t": {"blocks": [{"type": "table", "columns": columns, "rows": rows}]}}}
    return sanitize_content(content, templates)["sections"]["t"]["blocks"][0]["rows"]


def test_saved_content_is_renumbered():
    assert _section(SN_COLUMNS, [["7", "first", ""], ["7", "second", ""], ["", "third", ""]]) == [["1", "first", ""], ["2", "second", ""], ["3", "third", ""]]
    assert _section(["Name", "Detail"], [["7", "x"], ["7", "y"]]) == [["7", "x"], ["7", "y"]]


def test_a_blank_serial_table_still_counts_as_empty():
    template = {"schema_json": {"blocks": [{"type": "table", "columns": SN_COLUMNS, "rows": [["", "", ""]]}]}}
    blank = {"blocks": [{"type": "table", "columns": SN_COLUMNS, "rows": [["1", "", ""]]}]}
    assert section_is_empty(blank, template)
    written = {"blocks": [{"type": "table", "columns": SN_COLUMNS, "rows": [["1", "Peak load", ""]]}]}
    assert not section_is_empty(written, template)
    plain = {"blocks": [{"type": "table", "columns": ["A", "B"], "rows": [["1", ""]]}]}
    assert not section_is_empty(plain, {"schema_json": {"blocks": [{"type": "table", "columns": ["A", "B"], "rows": [["", ""]]}]}})


def test_the_api_and_the_exports_show_the_rows_in_order(client):
    writer = login(client, "Write")
    project_id = client.post("/api/projects", json={"project_name": "Numbers"}, headers=auth(writer)).json()["project_id"]
    document = client.get(f"/api/projects/{project_id}/documents", headers=auth(writer)).json()[0]
    base = f"/api/projects/{project_id}/documents/{document['document_id']}"
    added = client.post(
        f"{base}/sections",
        json={"section_name": "Cases", "blocks": [{"type": "table", "columns": SN_COLUMNS, "rows": [["1", "", ""]]}]},
        headers=auth(writer),
    ).json()
    sid = next(item["template_id"] for item in added["templates"] if item["section_name"] == "Cases")
    content = added["content_json"]
    # The browser moved row 3 to the top but left the old numbers in place.
    content["sections"][sid]["blocks"][0]["rows"] = [["3", "third", ""], ["1", "first", ""], ["2", "second", ""]]
    saved = client.put(base, json={"content_json": content}, headers=auth(writer)).json()
    assert saved["content_json"]["sections"][sid]["blocks"][0]["rows"] == [["1", "third", ""], ["2", "first", ""], ["3", "second", ""]]
    markdown = client.get(f"{base}/export?format=md", headers=auth(writer)).text
    assert "| 1 | third |" in markdown and "| 3 | second |" in markdown
    html = client.get(f"{base}/export?format=html", headers=auth(writer)).text
    assert html.index("<td>1</td><td>third") < html.index("<td>2</td><td>first")
