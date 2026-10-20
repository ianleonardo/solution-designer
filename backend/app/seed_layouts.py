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


def _filled_table(columns: tuple[str, ...], rows: list[tuple[str, ...]]) -> dict:
    """A table block that starts with standard rows (e.g. a rating scale) instead of one empty row."""
    return {"type": "table", "columns": list(columns), "rows": [list(row) for row in rows]}


FMEA_LAYOUT_ID = "fmea"
FMEA_LAYOUT_NAME = "FMEA Document"
FMEA_LAYOUT_DESCRIPTION = (
    "Failure Mode and Effects Analysis: how the solution can fail, how bad each failure is, and the actions that reduce the risk."
)

_SEVERITY_SCALE = [
    ("10", "Hazardous", "Regulatory breach or customer financial loss, without warning."),
    ("9", "Serious", "Regulatory or compliance breach with warning, or data loss or corruption."),
    ("8", "Very High", "Critical business service unavailable with no workaround."),
    ("7", "High", "Critical function degraded; major customer or operational impact."),
    ("6", "Moderate", "Non-critical function unavailable; a workaround exists."),
    ("5", "Low", "Non-critical function degraded; noticeable to users."),
    ("4", "Very Low", "Minor defect noticed by most users."),
    ("3", "Minor", "Minor defect noticed by some users."),
    ("2", "Very Minor", "Cosmetic defect noticed by few users."),
    ("1", "None", "No discernible effect."),
]
_OCCURRENCE_SCALE = [
    ("10", "Very High", "More than once a day."),
    ("9", "Very High", "Several times a week."),
    ("8", "High", "About once a week."),
    ("7", "High", "About once a month."),
    ("6", "Moderate", "About once a quarter."),
    ("5", "Moderate", "About once every six months."),
    ("4", "Low", "About once a year."),
    ("3", "Low", "Once in one to three years."),
    ("2", "Very Low", "Once in three to five years."),
    ("1", "Remote", "Eliminated by design, or not seen in more than five years."),
]
_DETECTION_SCALE = [
    ("10", "Absolute Uncertainty", "No control; the failure is not detected before it reaches the customer."),
    ("9", "Very Remote", "Detected only by a customer complaint or an audit."),
    ("8", "Remote", "Detected by a periodic manual review, such as a monthly reconciliation."),
    ("7", "Very Low", "Detected by a daily manual check."),
    ("6", "Low", "Detected only by manual testing or UAT."),
    ("5", "Moderate", "Detected by automated SIT or regression testing."),
    ("4", "Moderately High", "Monitoring alert after the failure occurs, before customer impact."),
    ("3", "High", "Real-time monitoring raises an automatic alert within minutes."),
    ("2", "Very High", "Automated validation blocks the failure at the point of entry."),
    ("1", "Almost Certain", "Prevented by design; the failure cannot occur undetected."),
]
_ACTION_THRESHOLDS = [
    ("Severity 9 or 10 (any RPN)", "High", "Action is mandatory; owner and target date agreed before go-live."),
    ("RPN 200 or more", "High", "Action is mandatory before go-live."),
    ("RPN 100 to 199", "Medium", "Action plan agreed; go-live allowed with sign-off of the residual risk."),
    ("RPN below 100", "Low", "Monitor; action is optional."),
]

FMEA_SECTIONS: list[dict] = [
    _section(
        "Introduction",
        "Explain why this FMEA is done and what it covers.",
        [{"type": "header", "text": "Introduction", "level": 1}, _prose()],
        [
            _section("Purpose", "State why this FMEA is done and which decisions it supports, such as go-live readiness.", [_prose()]),
            _section(
                "Scope and Boundary",
                "Describe the systems, processes and interfaces in and out of scope, and the FMEA type (system, design or process).",
                [_prose()],
            ),
            _section(
                "FMEA Team",
                "List the people who took part in the analysis and what each is responsible for.",
                [_table("Name", "Role", "Department", "Responsibility")],
            ),
            _section(
                "Definitions and Abbreviations",
                "List the terms and abbreviations used, including Severity (S), Occurrence (O), Detection (D) and Risk Priority Number (RPN).",
                [_table("Term", "Definition")],
            ),
        ],
    ),
    _section(
        "System and Function Analysis",
        "Break the solution into the items that are analysed and state what each must do.",
        [_prose()],
        [
            _section(
                "System Context",
                "Show the components and interfaces being analysed. An image of an existing diagram can be uploaded.",
                [_diagram(False), {"type": "image", "caption": "System context"}],
            ),
            _section(
                "Functions and Requirements",
                "One row per component or process step with the function it performs and the requirement it must meet.",
                [_table("Item ID", "Component / Process Step", "Function", "Requirement")],
            ),
        ],
    ),
    _section(
        "Rating Criteria",
        "Explain the scales used to rate each failure. RPN = Severity x Occurrence x Detection, from 1 to 1000.",
        [_prose()],
        [
            _section(
                "Severity Scale",
                "Keep the standard severity scale unless the project agrees a different one.",
                [_filled_table(("Rating", "Effect", "Criteria"), _SEVERITY_SCALE)],
            ),
            _section(
                "Occurrence Scale",
                "Keep the standard occurrence scale unless the project agrees a different one.",
                [_filled_table(("Rating", "Likelihood", "Criteria"), _OCCURRENCE_SCALE)],
            ),
            _section(
                "Detection Scale",
                "Keep the standard detection scale unless the project agrees a different one.",
                [_filled_table(("Rating", "Detectability", "Criteria"), _DETECTION_SCALE)],
            ),
            _section(
                "Action Thresholds",
                "State which ratings require action and how quickly.",
                [_filled_table(("Condition", "Priority", "Required Response"), _ACTION_THRESHOLDS)],
            ),
        ],
    ),
    _section(
        "Failure Analysis",
        "Identify how each function can fail, its effect and cause, and the controls in place today.",
        [_prose()],
        [
            _section(
                "FMEA Worksheet",
                "One row per failure mode and cause. Rate S, O and D with the Rating Criteria, set RPN = S x O x D, "
                "and set Priority with the Action Thresholds.",
                [
                    _table(
                        "ID", "Item / Function", "Failure Mode", "Effect", "S", "Cause", "O",
                        "Prevention Controls", "Detection Controls", "D", "RPN", "Priority",
                    )
                ],
            ),
            _section(
                "Failure Scenarios",
                "Describe the highest-risk failure modes and show how each one propagates across the systems.",
                [_table("SN", "Scenario", "Description"), _diagram(True)],
            ),
        ],
    ),
    _section(
        "Risk Mitigation",
        "Plan the actions that reduce the risk and re-rate each failure once they are done.",
        [_prose()],
        [
            _section(
                "Recommended Actions",
                "One row per action, linked to the worksheet ID, with an owner, a target date and a status.",
                [_table("ID", "Failure Mode", "Action", "Owner", "Target Date", "Status")],
            ),
            _section(
                "Re-assessment",
                "Re-rate S, O and D after each action is complete and recalculate the RPN.",
                [_table("ID", "Action Taken", "New S", "New O", "New D", "New RPN")],
            ),
        ],
    ),
    _section(
        "Summary and Sign-off",
        "Summarise the result of the analysis and record its approval.",
        [_prose()],
        [
            _section(
                "Top Risks",
                "Summarise the highest risks and how far the actions reduced them.",
                [_prose(), _table("Rank", "Failure Mode", "RPN Before", "RPN After", "Status")],
            ),
            _section(
                "Residual Risk and Approval",
                "State the risk that remains after the actions and record who accepted it.",
                [_prose(), _table("Name", "Role", "Decision", "Date")],
            ),
        ],
    ),
]
