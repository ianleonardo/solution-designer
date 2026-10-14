"""Starter document layouts seeded in code (the SDD layout is parsed from specs/solution_design_document.md)."""

SDD_LAYOUT_ID = "sdd"
SDD_LAYOUT_NAME = "Solution Design Document"

INTERFACE_LAYOUT_ID = "interface-spec"
INTERFACE_LAYOUT_NAME = "Interface Specifications Document"
INTERFACE_LAYOUT_DESCRIPTION = "Describes the interfaces between systems: messages, mappings, security and operations."


def _prose() -> dict:
    return {"type": "prose"}


def _table(*columns: str) -> dict:
    return {"type": "table", "columns": list(columns), "rows": [[""] * len(columns)]}


def _diagram(sequence: bool = False) -> dict:
    return {"type": "diagram", "sequence": sequence}


def _section(name: str, hint: str, blocks: list[dict], children: list[dict] | None = None) -> dict:
    return {"name": name, "hint": hint, "blocks": blocks, "children": children or []}


# Each entry is a top-level section with optional sub-sections.
INTERFACE_SECTIONS: list[dict] = [
    _section(
        "Introduction",
        "Explain why this document exists and what it covers.",
        [{"type": "header", "text": "Introduction", "level": 1}, _prose()],
        [
            _section("Purpose", "State the purpose of the interface specification and its intended audience.", [_prose()]),
            _section("Scope", "Describe which interfaces, systems and environments are in and out of scope.", [_prose()]),
            _section(
                "Definitions and Abbreviations",
                "List the terms and abbreviations used in this document.",
                [_table("Term", "Definition")],
            ),
        ],
    ),
    _section(
        "Interface Overview",
        "Summarise every interface and show how the systems connect.",
        [_prose()],
        [
            _section(
                "Interface Summary",
                "One row per interface with its identifier, endpoints, protocol and frequency.",
                [_table("Interface ID", "Name", "Source System", "Target System", "Protocol", "Frequency")],
            ),
            _section(
                "Context Diagram",
                "Show the systems and the interfaces between them. An image of an existing diagram can be uploaded.",
                [_diagram(False), {"type": "image", "caption": "Interface context"}],
            ),
        ],
    ),
    _section(
        "Interface Details",
        "Detail the technical contract of each interface.",
        [_prose()],
        [
            _section(
                "Message Format",
                "Describe the message structure and list every field with type, length and whether it is mandatory.",
                [_prose(), _table("Field", "Type", "Length", "Mandatory", "Description")],
            ),
            _section(
                "Data Mapping",
                "Map each source field to the target field and note any transformation rule.",
                [_table("Source Field", "Target Field", "Transformation Rule", "Remarks")],
            ),
            _section(
                "Sequence of Interactions",
                "List the key interaction scenarios and show each as a sequence diagram.",
                [_table("SN", "Scenario", "Description"), _diagram(True)],
            ),
        ],
    ),
    _section(
        "Non-Functional Considerations",
        "Cover security, performance and error behaviour of the interfaces.",
        [_prose()],
        [
            _section("Security", "Describe authentication, authorisation, encryption and data protection for the interfaces.", [_prose()]),
            _section(
                "Performance and Volumes",
                "State the expected message volumes, peak rates and response-time targets.",
                [_table("Interface ID", "Average Volume", "Peak Volume", "Response Time Target")],
            ),
            _section(
                "Error Handling and Retries",
                "List the error conditions, how each is reported and how it is retried or recovered.",
                [_table("Error Code", "Description", "Handling")],
            ),
        ],
    ),
    _section(
        "Operations",
        "Explain how the interfaces are run and supported.",
        [_prose()],
        [
            _section("Monitoring and Alerting", "Describe what is monitored, the thresholds and who is alerted.", [_prose()]),
            _section(
                "Support Contacts",
                "List the teams and contacts responsible for each system.",
                [_table("System", "Team", "Contact", "Escalation")],
            ),
        ],
    ),
]
