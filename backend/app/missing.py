NFR_CHECKS = [
    ("Volumetric Projections (next 3 to 5 years)", "Missing NFR volumetric projections"),
    ("Maximum Load/Users", "Missing maximum load"),
    ("Peak Load/Users", "Missing peak load"),
    ("Concurrent Users (TPS)", "Missing concurrent user load"),
    ("Response Time (for key use cases)", "Missing response time"),
]


def _table(section: dict | None) -> dict | None:
    if not section:
        return None
    for block in section.get("blocks") or []:
        if block.get("type") == "table":
            return block
    return None


def _cell(table: dict, match_column: str, match_value: str, value_column: str) -> str:
    columns = table.get("columns") or []
    try:
        match_index = columns.index(match_column)
        value_index = columns.index(value_column)
    except ValueError:
        return ""
    for row in table.get("rows") or []:
        if match_index < len(row) and row[match_index].strip() == match_value:
            if value_index < len(row):
                return row[value_index].strip()
            return ""
    return ""


def _prose(section: dict | None) -> str:
    if not section:
        return ""
    return " ".join(
        block.get("markdown", "") for block in section.get("blocks") or [] if block.get("type") == "prose"
    ).strip()


def evaluate_missing(content: dict) -> dict:
    sections = content.setdefault("sections", {})
    for section in sections.values():
        section["missing"] = []

    nfr = sections.get("key-non-functional-requirements")
    table = _table(nfr)
    if nfr is not None:
        missing = []
        if table is None:
            missing = [{"field": label, "message": message} for label, message in NFR_CHECKS]
        else:
            for label, message in NFR_CHECKS:
                if not _cell(table, "NFR", label, "Requirements"):
                    missing.append({"field": label, "message": message})
        nfr["missing"] = missing

    growth = sections.get("expected-db-size-growth")
    if growth is not None and not _prose(growth):
        growth["missing"] = [
            {"field": "Expected DB Size Growth", "message": "Missing database growth estimates"}
        ]
    return content
