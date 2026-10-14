import re

DEFAULT_FLOWCHART = (
    "flowchart LR\n    Source[Source] --> System[System]\n    System --> Destination[Destination]"
)


def default_sequence_flow() -> dict:
    return {
        "nodes": [
            {
                "id": "user",
                "position": {"x": 0, "y": 0},
                "data": {"label": "User", "actor": True},
            },
            {
                "id": "system",
                "position": {"x": 220, "y": 0},
                "data": {"label": "System", "actor": False},
            },
        ],
        "edges": [
            {
                "id": "m1",
                "source": "user",
                "target": "system",
                "label": "Request",
                "data": {"kind": "request"},
            },
            {
                "id": "m2",
                "source": "system",
                "target": "user",
                "label": "Response",
                "data": {"kind": "reply"},
            },
        ],
    }


def _alias(node: dict, used: set[str]) -> str:
    label = str(node.get("data", {}).get("label") or node.get("id") or "Node")
    safe = re.sub(r"[^A-Za-z0-9_]", "", label) or "Node"
    if not safe[0].isalpha():
        safe = f"N{safe}"
    alias = safe
    index = 2
    while alias in used:
        alias = f"{safe}{index}"
        index += 1
    used.add(alias)
    return alias


def flow_to_mermaid(flow: dict | None) -> str:
    if not flow:
        return "sequenceDiagram\n    actor User\n    participant System"
    nodes = sorted(flow.get("nodes") or [], key=lambda node: node.get("position", {}).get("x", 0))
    lines = ["sequenceDiagram"]
    used: set[str] = set()
    id_alias: dict[str, str] = {}
    for node in nodes:
        alias = _alias(node, used)
        id_alias[node["id"]] = alias
        kind = "actor" if node.get("data", {}).get("actor") else "participant"
        label = str(node.get("data", {}).get("label") or alias).replace(":", " ")
        lines.append(f"    {kind} {alias} as {label}")
    for edge in flow.get("edges") or []:
        arrow = "-->>" if edge.get("data", {}).get("kind") == "reply" else "->>"
        source = id_alias.get(edge.get("source"), edge.get("source"))
        target = id_alias.get(edge.get("target"), edge.get("target"))
        label = str(edge.get("label") or "").replace("\n", " ").replace(":", " ")
        lines.append(f"    {source}{arrow}{target}: {label}")
    return "\n".join(lines)


# Mermaid allows spaces in a participant's name (`participant Source System`), and models write them that way.
_SEQ_PARTICIPANT = re.compile(r"(actor|participant)\s+(.+?)(?:\s+as\s+(.+))?$")
_SEQ_MESSAGE = re.compile(r"(.+?)\s*(-->>|->>)\s*(.+?)\s*:\s*(.*)$")


def mermaid_to_flow(source: str) -> dict | None:
    """Read a sequence diagram (participants and ->> / -->> messages) into a drawing.

    Mirrored by `mermaidToFlow` in frontend/src/flow.ts. A participant that is only mentioned in a message is added.
    None when the text is not a sequence diagram or uses anything else (notes, loops, activations): the diagram then
    stays text, so nothing is silently dropped.
    """
    lines = [line.strip() for line in (source or "").splitlines()]
    lines = [line for line in lines if line and not line.startswith("%%")]
    if not lines or lines[0] != "sequenceDiagram":
        return None
    nodes: list[dict] = []
    edges: list[dict] = []

    def add_node(alias: str, label: str | None, actor: bool) -> None:
        for node in nodes:
            if node["id"] == alias:
                if label is not None:
                    node["data"] = {"label": label, "actor": actor}
                return
        nodes.append({"id": alias, "position": {"x": len(nodes) * 220, "y": 0}, "data": {"label": label or alias, "actor": actor}})

    for line in lines[1:]:
        participant = _SEQ_PARTICIPANT.match(line)
        if participant:
            kind, alias, label = participant.groups()
            add_node(alias.strip(), (label or alias).strip(), kind == "actor")
            continue
        message = _SEQ_MESSAGE.match(line)
        if not message:
            return None
        source_id, arrow, target_id, label = message.groups()
        source_id, target_id = source_id.strip(), target_id.strip()
        add_node(source_id, None, False)
        add_node(target_id, None, False)
        edges.append(
            {
                "id": f"m{len(edges) + 1}",
                "source": source_id,
                "target": target_id,
                "label": label.strip(),
                "data": {"kind": "reply" if arrow == "-->>" else "request"},
            }
        )
    if not nodes:
        return None
    return {"nodes": nodes, "edges": edges}


# --- Flowcharts -----------------------------------------------------------------------------------------------------
# A flowchart is stored as {"direction": "LR"|"TB", "nodes": [{id, position, data: {label, shape}}], "edges":
# [{id, source, target, label}]} next to its Mermaid text. The conversion below is mirrored in frontend/src/flow.ts;
# change both together. Only a small Mermaid subset is understood (nodes with [] () {} shapes, --> arrows with an
# optional label). Anything else makes mermaid_to_flowchart return None and the diagram stays Mermaid text.

CHART_SHAPES = ("rect", "round", "decision")
CHART_DIRECTIONS = ("LR", "TB")
MAX_CHART_NODES = 200
_RESERVED = {"end", "graph", "flowchart", "subgraph", "style", "class", "classdef", "click", "default", "linkstyle", "direction"}
_OPEN = {"rect": ("[", "]"), "round": ("(", ")"), "decision": ("{", "}")}
_NODE = re.compile(
    r"(?P<id>[A-Za-z_][A-Za-z0-9_]*)"
    r"(?:(?P<open>\(\[|\(\(|\[\[|\[|\(|\{)(?P<body>\"[^\"]*\"|[^\]\)\}\"]*)(?P<close>\]\)|\)\)|\]\]|\]|\)|\}))?"
)
_ARROW = re.compile(r"\s*(?:-->\|(?P<l1>[^|]*)\||--\s+(?P<l2>[^>\-][^>]*?)\s+-->|-->)\s*")
_HEADER = re.compile(r"^(?:flowchart|graph)\s+(LR|TB|TD)\s*;?$", re.I)


def default_flowchart() -> dict:
    return mermaid_to_flowchart(DEFAULT_FLOWCHART) or {"direction": "LR", "nodes": [], "edges": []}


def _chart_alias(node_id: str, used: set[str]) -> str:
    safe = re.sub(r"[^A-Za-z0-9_]", "", str(node_id)) or "n"
    if not safe[0].isalpha():
        safe = f"n{safe}"
    if safe.lower() in _RESERVED:
        safe += "_"
    alias, index = safe, 2
    while alias in used:
        alias = f"{safe}{index}"
        index += 1
    used.add(alias)
    return alias


def _node_text(value) -> str:
    return str(value or "").replace("\n", " ").replace('"', "#quot;")


def _edge_text(value) -> str:
    return str(value or "").replace("\n", " ").replace("|", "/").replace('"', "'").strip()


def flowchart_to_mermaid(flow: dict | None) -> str:
    flow = normalize_flowchart(flow)
    if not flow:
        return DEFAULT_FLOWCHART
    lines = [f"flowchart {flow['direction']}"]
    used: set[str] = set()
    alias: dict[str, str] = {}
    for node in flow["nodes"]:
        alias[node["id"]] = _chart_alias(node["id"], used)
        opening, closing = _OPEN[node["data"]["shape"]]
        label = _node_text(node["data"]["label"] or node["id"])
        lines.append(f'    {alias[node["id"]]}{opening}"{label}"{closing}')
    for edge in flow["edges"]:
        label = _edge_text(edge["label"])
        arrow = f"-->|{label}|" if label else "-->"
        lines.append(f"    {alias[edge['source']]} {arrow} {alias[edge['target']]}")
    return "\n".join(lines)


def normalize_flowchart(flow) -> dict | None:
    """The clean form of a stored flowchart, or None when it is not usable."""
    if not isinstance(flow, dict) or not isinstance(flow.get("nodes"), list):
        return None
    nodes: list[dict] = []
    seen: set[str] = set()
    for node in flow["nodes"][:MAX_CHART_NODES]:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"] or node["id"] in seen:
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        position = node.get("position") if isinstance(node.get("position"), dict) else {}
        shape = data.get("shape") if data.get("shape") in CHART_SHAPES else "rect"
        coordinates = {}
        for axis in ("x", "y"):
            value = position.get(axis)
            coordinates[axis] = float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0
        seen.add(node["id"])
        nodes.append({"id": node["id"][:64], "position": coordinates, "data": {"label": str(data.get("label") or "")[:200], "shape": shape}})
    if not nodes:
        return None
    known = {node["id"] for node in nodes}
    edges: list[dict] = []
    for index, edge in enumerate(flow.get("edges") or [], start=1):
        if not isinstance(edge, dict) or edge.get("source") not in known or edge.get("target") not in known:
            continue
        identifier = edge.get("id") if isinstance(edge.get("id"), str) and edge.get("id") else f"e{index}"
        edges.append({"id": identifier[:64], "source": edge["source"], "target": edge["target"], "label": str(edge.get("label") or "")[:200]})
    direction = flow.get("direction") if flow.get("direction") in CHART_DIRECTIONS else "LR"
    return {"direction": direction, "nodes": nodes, "edges": edges}


def _layout(order: list[str], edges: list[tuple[str, str]], direction: str) -> dict[str, dict]:
    """Place nodes in columns (LR) or rows (TB) by longest path. Edges that point back to an earlier node are ignored."""
    index = {identifier: position for position, identifier in enumerate(order)}
    level = {identifier: 0 for identifier in order}
    for identifier in order:
        for source, target in edges:
            if target == identifier and index[source] < index[target]:
                level[identifier] = max(level[identifier], level[source] + 1)
    counters: dict[int, int] = {}
    positions: dict[str, dict] = {}
    for identifier in order:
        column = level[identifier]
        row = counters.get(column, 0)
        counters[column] = row + 1
        positions[identifier] = {"x": column * 240, "y": row * 110} if direction == "LR" else {"x": row * 240, "y": column * 120}
    return positions


def _unquote(body: str) -> str:
    text = body.strip()
    if len(text) >= 2 and text.startswith('"') and text.endswith('"'):
        text = text[1:-1]
    return text.replace("#quot;", '"').strip()


def mermaid_to_flowchart(source: str) -> dict | None:
    """Parse the supported Mermaid subset into a flowchart; None when anything in it is not supported."""
    lines = [line.strip().rstrip(";").strip() for line in (source or "").splitlines()]
    lines = [line for line in lines if line and not line.startswith("%%")]
    if not lines:
        return None
    header = _HEADER.match(lines[0])
    if not header:
        return None
    direction = "TB" if header.group(1).upper() in {"TB", "TD"} else "LR"
    labels: dict[str, str] = {}
    shapes: dict[str, str] = {}
    order: list[str] = []
    edges: list[tuple[str, str, str]] = []

    def take(text: str, position: int) -> tuple[str, int] | None:
        match = _NODE.match(text, position)
        if not match:
            return None
        identifier = match.group("id")
        if identifier.lower() in _RESERVED:
            return None
        if identifier not in order:
            order.append(identifier)
        if match.group("open"):
            opening = match.group("open")
            shape = "decision" if opening == "{" else "round" if opening.startswith("(") else "rect"
            labels[identifier] = _unquote(match.group("body"))
            shapes[identifier] = shape
        return identifier, match.end()

    for line in lines[1:]:
        first = take(line, 0)
        if first is None:
            return None
        previous, position = first
        while position < len(line):
            arrow = _ARROW.match(line, position)
            if not arrow:
                return None
            label = arrow.group("l1") if arrow.group("l1") is not None else arrow.group("l2") or ""
            following = take(line, arrow.end())
            if following is None:
                return None
            target, position = following
            edges.append((previous, target, _unquote(label)))
            previous = target
    if not order or len(order) > MAX_CHART_NODES:
        return None
    positions = _layout(order, [(source_id, target_id) for source_id, target_id, _ in edges], direction)
    return {
        "direction": direction,
        "nodes": [
            {"id": identifier, "position": positions[identifier], "data": {"label": labels.get(identifier, identifier), "shape": shapes.get(identifier, "rect")}}
            for identifier in order
        ],
        "edges": [{"id": f"e{index}", "source": s, "target": t, "label": label} for index, (s, t, label) in enumerate(edges, start=1)],
    }
