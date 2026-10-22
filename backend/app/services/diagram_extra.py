"""Pictures for the Mermaid types the older export drawings do not cover.

HTML and PDF use these when Mermaid itself cannot be run. Each picture is the same Scene of boxes,
lines and text as the other diagrams.
"""

import math
import re

from app.services.diagrams import (
    ACTOR_FILL,
    FILL,
    FONT,
    INK,
    LINE,
    Scene,
    _Bounds,
    _arrow_head,
    _diagram_lines,
    _shift,
    _text_width,
)

_LANE = "#e7eef8"
_EDGE = re.compile(r"-->|---|-\.->|==>")
_NODE = re.compile(
    r"^(?P<id>\w+)\s*(?:\(\((?P<circle>[^)]+)\)\)|\(\[(?P<stadium>[^\]]+)\]\)|\[(?P<rect>[^\]]+)\]|\((?P<round>[^)]+)\)|\{(?P<decision>[^}]+)\})\s*$"
)


def extra_scene(source: str) -> Scene | None:
    """A picture for a supported extra diagram, or None when this text is some other Mermaid type."""
    for draw in (
        journey_scene,
        c4_scene,
        architecture_scene,
        block_scene,
        requirement_scene,
        usecase_scene,
        mindmap_scene,
        tree_scene,
        swimlane_scene,
    ):
        scene = draw(source)
        if scene is not None:
            return scene
    return None


def _quote(text: str) -> str:
    return (text or "").strip().strip('"').strip("'")


def _node_id(text: str) -> str:
    token = (text or "").strip().split()[0] if (text or "").strip() else ""
    return re.split(r"[\[\(\{]", token, maxsplit=1)[0]


def _parse_edges(line: str) -> list[dict]:
    pieces = _EDGE.split(line.strip())
    operators = _EDGE.findall(line)
    if len(pieces) < 2 or not operators:
        return []
    edges = []
    left = _node_id(pieces[0])
    for operator, right_raw in zip(operators, pieces[1:]):
        right_text = right_raw.strip()
        label = ""
        labelled = re.match(r"\|([^|]*)\|\s*(.*)$", right_text)
        if labelled:
            label = labelled.group(1).strip()
            right_text = labelled.group(2).strip()
        right = _node_id(right_text)
        if left and right:
            edges.append({"source": left, "target": right, "label": label, "arrow": ">" in operator, "dash": operator.startswith("-.")})
        left = right
    return edges


def _box(scene: Scene, bounds: _Bounds, x: float, y: float, w: float, h: float, label: str, *, fill: str = FILL, radius: float = 6) -> None:
    scene.items.append({"kind": "rect", "x": x, "y": y, "w": w, "h": h, "r": radius, "fill": fill, "stroke": LINE})
    bounds.box(x, y, w, h)
    for index, line in enumerate(_wrap(label, max(8, int(w / 7)))):
        scene.items.append(
            {"kind": "text", "x": x + w / 2, "y": y + h / 2 + (index - 0.5) * 14, "text": line, "size": FONT, "anchor": "middle", "fill": INK}
        )


def _wrap(label: str, width: int) -> list[str]:
    words = str(label or "").split() or [""]
    lines: list[str] = []
    current = ""
    for word in words:
        trial = word if not current else f"{current} {word}"
        if len(trial) > width and current:
            lines.append(current)
            current = word
        else:
            current = trial
    if current:
        lines.append(current)
    return lines[:3]


def _connect(scene: Scene, bounds: _Bounds, start: tuple[float, float, float, float], end: tuple[float, float, float, float], edge: dict) -> None:
    x1, y1 = start[0] + start[2] / 2, start[1] + start[3] / 2
    x2, y2 = end[0] + end[2] / 2, end[1] + end[3] / 2
    angle = math.atan2(y2 - y1, x2 - x1)
    inset = min(start[2], start[3], end[2], end[3]) / 2
    sx, sy = x1 + math.cos(angle) * inset, y1 + math.sin(angle) * inset
    tx, ty = x2 - math.cos(angle) * inset, y2 - math.sin(angle) * inset
    scene.items.append({"kind": "line", "x1": sx, "y1": sy, "x2": tx, "y2": ty, "stroke": LINE, "dash": edge.get("dash", False)})
    bounds.add(sx, sy)
    bounds.add(tx, ty)
    if edge.get("arrow", True):
        head = _arrow_head(tx, ty, angle)
        scene.items.append({"kind": "poly", "points": head, "fill": LINE, "stroke": LINE})
        for point in head:
            bounds.add(*point)
    if edge.get("label"):
        width = _text_width(edge["label"])
        mx, my = (sx + tx) / 2, (sy + ty) / 2 - 12
        scene.items.append({"kind": "text", "x": mx, "y": my, "text": edge["label"], "size": 11, "anchor": "middle", "fill": INK})
        bounds.box(mx - width / 2, my - 8, width, 16)


def _grid(nodes: list[dict], edges: list[dict], columns: int = 3, *, title: str = "") -> Scene | None:
    if not nodes:
        return None
    columns = max(1, columns)
    scene, bounds = Scene(), _Bounds()
    width, height, gap_x, gap_y = 168.0, 56.0, 56.0, 48.0
    top = 28.0 if title else 0.0
    if title:
        scene.items.append({"kind": "text", "x": 0, "y": 8, "text": title, "size": FONT, "anchor": "start", "fill": INK})
        bounds.box(0, 0, _text_width(title), 16)
    placed: dict[str, tuple[float, float, float, float]] = {}
    for index, node in enumerate(nodes):
        column, row = index % columns, index // columns
        x, y = column * (width + gap_x), top + row * (height + gap_y)
        placed[node["id"]] = (x, y, width, height)
        radius = height / 2 if node.get("shape") == "round" else 8 if node.get("shape") == "actor" else 6
        _box(scene, bounds, x, y, width, height, node["label"], fill=ACTOR_FILL if node.get("shape") == "actor" else FILL, radius=radius)
    for edge in edges:
        if edge["source"] in placed and edge["target"] in placed and edge["source"] != edge["target"]:
            _connect(scene, bounds, placed[edge["source"]], placed[edge["target"]], edge)
    return _shift(scene, bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y)


def _indented(source: str, keyword: str) -> list[tuple[int, str]]:
    body: list[str] = []
    started = False
    for line in source.replace("\r\n", "\n").replace("\r", "\n").splitlines():
        if not started:
            started = line.strip().lower().startswith(keyword)
            continue
        if line.strip() and not line.strip().startswith("%%"):
            body.append(line.replace("\t", "    "))
    if not body:
        return []
    unit = min((len(line) - len(line.lstrip(" ")) for line in body if line[:1] == " "), default=2) or 2
    return [((len(line) - len(line.lstrip(" "))) // unit, line.strip()) for line in body]


def _tree(levels: list[tuple[int, str]]) -> Scene | None:
    if not levels:
        return None
    nodes = [{"label": label, "depth": depth, "children": [], "x": 0.0, "y": 0.0} for depth, label in levels]
    stack: list[dict] = []
    roots: list[dict] = []
    for node in nodes:
        while stack and stack[-1]["depth"] >= node["depth"]:
            stack.pop()
        if stack:
            stack[-1]["children"].append(node)
        else:
            roots.append(node)
        stack.append(node)

    def place(node: dict, x: float, y: float) -> float:
        if not node["children"]:
            node["x"], node["y"] = x, y
            return 40
        cursor = y
        for child in node["children"]:
            cursor += place(child, x + 180, cursor)
        node["x"] = x
        node["y"] = (node["children"][0]["y"] + node["children"][-1]["y"]) / 2
        return max(cursor - y, 40)

    cursor = 0.0
    for root in roots:
        cursor += place(root, 0, cursor)
    scene, bounds = Scene(), _Bounds()
    flat = []

    def walk(node: dict) -> None:
        flat.append(node)
        for child in node["children"]:
            walk(child)

    for root in roots:
        walk(root)
    boxes: dict[int, tuple[float, float, float, float]] = {}
    for index, node in enumerate(flat):
        width = max(96.0, _text_width(node["label"]) + 24)
        box = (node["x"], node["y"], width, 32.0)
        boxes[index] = box
        _box(scene, bounds, *box, node["label"], radius=8)
    by_id = {id(node): index for index, node in enumerate(flat)}
    for node in flat:
        parent = boxes[by_id[id(node)]]
        for child in node["children"]:
            _connect(scene, bounds, parent, boxes[by_id[id(child)]], {"arrow": False, "label": ""})
    return _shift(scene, bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y)


def journey_scene(source: str) -> Scene | None:
    lines = _diagram_lines(source)
    if not lines or not lines[0].lower().startswith("journey"):
        return None
    title = ""
    sections: list[dict] = []
    current = None
    for line in lines[1:]:
        if line.lower().startswith("title "):
            title = line.split(None, 1)[1].strip()
        elif line.lower().startswith("section "):
            current = {"name": line.split(None, 1)[1].strip(), "tasks": []}
            sections.append(current)
        elif current is not None and ":" in line:
            parts = [part.strip() for part in line.split(":")]
            current["tasks"].append((parts[0], parts[1] if len(parts) > 1 else "", parts[2] if len(parts) > 2 else ""))
    if not sections:
        return None
    scene, bounds = Scene(), _Bounds()
    y = 0.0
    if title:
        scene.items.append({"kind": "text", "x": 0, "y": 8, "text": title, "size": FONT, "anchor": "start", "fill": INK})
        bounds.box(0, 0, _text_width(title), 16)
        y = 28
    for section in sections:
        scene.items.append({"kind": "text", "x": 0, "y": y + 8, "text": section["name"], "size": FONT, "anchor": "start", "fill": LINE})
        bounds.box(0, y, _text_width(section["name"]), 18)
        y += 24
        for name, score, actors in section["tasks"]:
            _box(scene, bounds, 0, y, 220, 32, name, radius=4)
            try:
                filled = max(0.0, min(5.0, float(score))) / 5
            except ValueError:
                filled = 0
            scene.items.append({"kind": "rect", "x": 232, "y": y + 10, "w": 80 * filled, "h": 12, "r": 2, "fill": LINE, "stroke": LINE})
            bounds.box(232, y + 10, 80, 12)
            who = f"{score}  {actors}".strip()
            scene.items.append({"kind": "text", "x": 320, "y": y + 16, "text": who, "size": 11, "anchor": "start", "fill": INK})
            bounds.box(320, y, _text_width(who), 32)
            y += 40
    return _shift(scene, bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y)


def c4_scene(source: str) -> Scene | None:
    lines = _diagram_lines(source)
    if not lines or not re.match(r"c4(context|container|component|dynamic|deployment)\b", lines[0], re.I):
        return None
    title = ""
    nodes = []
    edges = []
    node_re = re.compile(
        r"^(Person|Person_Ext|System|System_Ext|SystemDb|SystemQueue|Container|ContainerDb|Component|ComponentDb)\s*\(\s*(\w+)\s*,\s*\"([^\"]*)\"",
        re.I,
    )
    rel_re = re.compile(r"^(?:Rel|BiRel|Rel_Back|Rel_[UDRL])\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*\"([^\"]*)\"", re.I)
    for line in lines[1:]:
        if line.lower().startswith("title "):
            title = line.split(None, 1)[1].strip()
            continue
        node = node_re.match(line)
        if node:
            kind = node.group(1).lower()
            nodes.append({"id": node.group(2), "label": node.group(3), "shape": "actor" if kind.startswith("person") else "rect"})
            continue
        rel = rel_re.match(line)
        if rel:
            edges.append({"source": rel.group(1), "target": rel.group(2), "label": rel.group(3), "arrow": True})
    return _grid(nodes, edges, 3, title=title)


def architecture_scene(source: str) -> Scene | None:
    lines = _diagram_lines(source)
    if not lines or not lines[0].lower().startswith("architecture-beta"):
        return None
    nodes = []
    edges = []
    group_re = re.compile(r"^group\s+(\w+)(?:\([^)]*\))?\[([^\]]+)\]")
    service_re = re.compile(r"^service\s+(\w+)(?:\([^)]*\))?\[([^\]]+)\]")
    edge_re = re.compile(r"^(\w+)(?::[LTRB])?\s+(-+>|--+)\s+(?:[LTRB]:)?(\w+)")
    for line in lines[1:]:
        group = group_re.match(line)
        service = service_re.match(line)
        edge = edge_re.match(line)
        if service:
            nodes.append({"id": service.group(1), "label": service.group(2), "shape": "rect"})
        elif group:
            nodes.append({"id": group.group(1), "label": group.group(2), "shape": "round"})
        elif edge:
            edges.append({"source": edge.group(1), "target": edge.group(3), "label": "", "arrow": ">" in edge.group(2)})
    # A group that only holds services is the frame, not a separate box.
    held = {edge["source"] for edge in edges} | {edge["target"] for edge in edges}
    service_ids = {node["id"] for node in nodes if node["shape"] == "rect"}
    if service_ids:
        nodes = [node for node in nodes if node["shape"] == "rect" or node["id"] in held]
    return _grid(nodes, edges, max(1, len(nodes)))


def block_scene(source: str) -> Scene | None:
    lines = _diagram_lines(source)
    if not lines or not lines[0].lower().startswith("block-beta"):
        return None
    columns = 3
    nodes = []
    edges = []
    seen: set[str] = set()
    token = re.compile(r"(\w+)(?:\[\s*\"?([^\"\]]+)\"?\s*\]|\(\(\s*\"?([^)\"]+)\"?\s*\)\)|\(\s*\"?([^)\"]+)\"?\s*\))?")
    for line in lines[1:]:
        counted = re.match(r"^columns\s+(\d+)", line, re.I)
        if counted:
            columns = int(counted.group(1))
            continue
        if _EDGE.search(line):
            edges.extend(_parse_edges(line))
            continue
        if line.lower().startswith("block:") or line.lower() in {"end", "space"}:
            continue
        for match in token.finditer(line):
            ident = match.group(1)
            if ident.lower() in {"columns", "block", "space", "end"} or ident in seen:
                continue
            label = next((part.strip() for part in match.groups()[1:] if part), ident)
            seen.add(ident)
            nodes.append({"id": ident, "label": label, "shape": "rect"})
    return _grid(nodes, edges, columns)


def requirement_scene(source: str) -> Scene | None:
    lines = _diagram_lines(source)
    if not lines or not lines[0].lower().startswith("requirementdiagram"):
        return None
    nodes = []
    edges = []
    current = None
    fields: list[str] = []
    for line in lines[1:]:
        opened = re.match(r"^(requirement|element)\s+(\w+)\s*\{", line, re.I)
        relation = re.match(r"^(\w+)\s+-\s+([A-Za-z_]+)\s+->\s+(\w+)", line)
        if opened:
            current = {"id": opened.group(2), "label": opened.group(2), "shape": "rect" if opened.group(1).lower() == "requirement" else "round"}
            fields = []
        elif current is not None and line == "}":
            if fields:
                current["label"] = " ".join([current["id"], *fields])
            nodes.append(current)
            current = None
        elif current is not None and ":" in line:
            key, value = [part.strip() for part in line.split(":", 1)]
            if key.lower() in {"text", "type", "id"} and value:
                fields.append(value)
        elif relation:
            edges.append({"source": relation.group(1), "target": relation.group(3), "label": relation.group(2), "arrow": True, "dash": True})
    return _grid(nodes, edges, 2)


def usecase_scene(source: str) -> Scene | None:
    lines = _diagram_lines(source)
    if not lines or not lines[0].lower().startswith("usecase-beta"):
        return None
    nodes = []
    edges = []
    seen: set[str] = set()
    for line in lines[1:]:
        if line.lower().startswith("direction ") or line.lower() in {"end"} or line.lower().startswith("systemboundary"):
            continue
        if _EDGE.search(line) or ".." in line:
            dotted = re.match(r"^(\w+)\s+\.\.>\s*(?::\s*(\w+)\s+)?(\w+)", line)
            if dotted:
                edges.append({"source": dotted.group(1), "target": dotted.group(3), "label": dotted.group(2) or "", "arrow": True, "dash": True})
            else:
                edges.extend(_parse_edges(line))
            continue
        actor = re.match(r"^actor\s+(\w+)(?:\(\s*\"([^\"]*)\"\s*\))?", line)
        case = re.match(r"^(\w+)(?:\(\s*\"([^\"]*)\"\s*\)|\[\s*([^\]]+)\s*\])", line)
        if actor:
            ident, label = actor.group(1), actor.group(2) or actor.group(1)
            shape = "actor"
        elif case:
            ident, label = case.group(1), _quote(case.group(2) or case.group(3) or case.group(1))
            shape = "round"
        else:
            continue
        if ident not in seen:
            seen.add(ident)
            nodes.append({"id": ident, "label": label, "shape": shape})
    return _grid(nodes, edges, 3)


def mindmap_scene(source: str) -> Scene | None:
    levels = []
    for depth, text in _indented(source, "mindmap"):
        circle = re.search(r"\(\(([^)]+)\)\)", text)
        bracket = re.search(r"\[([^\]]+)\]", text)
        label = circle.group(1).strip() if circle else _quote(bracket.group(1)) if bracket else text
        levels.append((depth, label))
    return _tree(levels) if levels else None


def tree_scene(source: str) -> Scene | None:
    levels = []
    for depth, text in _indented(source, "treeview-beta"):
        label = re.sub(r"\s*##\s*.*$", "", text)
        label = re.sub(r":::\S+", "", label)
        label = re.sub(r"\s*icon\([^)]*\)", "", label).strip()
        if label.startswith('"') and label.endswith('"'):
            label = label[1:-1]
        if label:
            levels.append((depth, label))
    return _tree(levels) if levels else None


def swimlane_scene(source: str) -> Scene | None:
    lines = _diagram_lines(source)
    if not lines or not lines[0].lower().startswith("swimlane-beta"):
        return None
    horizontal = "lr" in lines[0].lower() or "rl" in lines[0].lower()
    lanes: list[dict] = []
    current = None
    edges = []
    for line in lines[1:]:
        if line.lower().startswith("subgraph"):
            rest = line.split(None, 1)[1].strip() if " " in line else "Lane"
            named = re.match(r"(\w+)\s*\[([^\]]+)\]", rest)
            current = {"name": _quote(named.group(2)) if named else rest, "nodes": []}
            lanes.append(current)
        elif line.lower() == "end":
            current = None
        elif _EDGE.search(line):
            edges.extend(_parse_edges(line))
        elif current is not None:
            matched = _NODE.match(line)
            if matched:
                label = next(part for part in matched.groups()[1:] if part)
                current["nodes"].append({"id": matched.group("id"), "label": _quote(label)})
            elif re.match(r"^\w+$", line):
                current["nodes"].append({"id": line, "label": line})
    lanes = [lane for lane in lanes if lane["nodes"]]
    if not lanes:
        return None
    scene, bounds = Scene(), _Bounds()
    node_w, node_h, gap = 150.0, 40.0, 28.0
    label_w = max(_text_width(lane["name"]) for lane in lanes) + 20
    placed: dict[str, tuple[float, float, float, float]] = {}
    if horizontal:
        y = 0.0
        for lane in lanes:
            width = label_w + 16 + len(lane["nodes"]) * (node_w + gap)
            scene.items.append({"kind": "rect", "x": 0, "y": y, "w": width, "h": node_h + 24, "r": 6, "fill": _LANE, "stroke": LINE})
            bounds.box(0, y, width, node_h + 24)
            scene.items.append({"kind": "text", "x": 10, "y": y + (node_h + 24) / 2, "text": lane["name"], "size": FONT, "anchor": "start", "fill": INK})
            for index, node in enumerate(lane["nodes"]):
                x = label_w + index * (node_w + gap)
                box = (x, y + 12, node_w, node_h)
                placed[node["id"]] = box
                _box(scene, bounds, *box, node["label"])
            y += node_h + 36
    else:
        x = 0.0
        for lane in lanes:
            height = 28 + len(lane["nodes"]) * (node_h + gap)
            width = max(label_w, node_w + 24)
            scene.items.append({"kind": "rect", "x": x, "y": 0, "w": width, "h": height, "r": 6, "fill": _LANE, "stroke": LINE})
            bounds.box(x, 0, width, height)
            scene.items.append({"kind": "text", "x": x + width / 2, "y": 14, "text": lane["name"], "size": FONT, "anchor": "middle", "fill": INK})
            for index, node in enumerate(lane["nodes"]):
                box = (x + 12, 28 + index * (node_h + gap), width - 24, node_h)
                placed[node["id"]] = box
                _box(scene, bounds, *box, node["label"])
            x += width + 24
    for edge in edges:
        if edge["source"] in placed and edge["target"] in placed:
            _connect(scene, bounds, placed[edge["source"]], placed[edge["target"]], edge)
    return _shift(scene, bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y)
