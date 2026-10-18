"""Draws a diagram block as a picture for the HTML and PDF exports.

Mermaid needs a browser to draw, which an export does not have, so the diagram is drawn from the Mermaid text when
it is simple enough to read (flowcharts, sequence diagrams and class diagrams of the common kind). The result is a
`Scene`: a list of simple shapes that become an inline SVG for HTML (and WeasyPrint) or are drawn with FPDF when
WeasyPrint is not available. Diagrams that cannot be read are left to the caller, which prints the Mermaid source.
"""

import html
import math
import re
import textwrap
from dataclasses import dataclass, field

from app.flow import mermaid_to_flow, mermaid_to_flowchart, normalize_flowchart

INK = "#131b2e"
LINE = "#1a4b8c"
FILL = "#f0f4f8"
ACTOR_FILL = "#dbe6f7"
FONT = 12
PAD = 16
CHAR_WIDTH = 6.8


@dataclass
class Scene:
    width: float = 0
    height: float = 0
    items: list[dict] = field(default_factory=list)


def _text_width(text: str) -> float:
    return len(text) * CHAR_WIDTH


def _lines(label: str, width: int = 24) -> list[str]:
    wrapped = textwrap.wrap(" ".join(str(label or "").split()), width=width, break_long_words=True)
    return wrapped[:4] or [""]


def _arrow_head(x: float, y: float, angle: float, size: float = 9) -> list[tuple[float, float]]:
    spread = math.radians(24)
    return [
        (x, y),
        (x - size * math.cos(angle - spread), y - size * math.sin(angle - spread)),
        (x - size * math.cos(angle + spread), y - size * math.sin(angle + spread)),
    ]


def _shift(scene: Scene, min_x: float, min_y: float, max_x: float, max_y: float) -> Scene:
    dx, dy = PAD - min_x, PAD - min_y
    for item in scene.items:
        for key in ("x", "x1", "x2"):
            if key in item:
                item[key] += dx
        for key in ("y", "y1", "y2"):
            if key in item:
                item[key] += dy
        if "points" in item:
            item["points"] = [(px + dx, py + dy) for px, py in item["points"]]
    scene.width = round(max_x - min_x + 2 * PAD, 1)
    scene.height = round(max_y - min_y + 2 * PAD, 1)
    return scene


class _Bounds:
    def __init__(self) -> None:
        self.min_x = self.min_y = math.inf
        self.max_x = self.max_y = -math.inf

    def add(self, x: float, y: float) -> None:
        self.min_x, self.max_x = min(self.min_x, x), max(self.max_x, x)
        self.min_y, self.max_y = min(self.min_y, y), max(self.max_y, y)

    def box(self, x: float, y: float, w: float, h: float) -> None:
        self.add(x, y)
        self.add(x + w, y + h)


def _clip(center: tuple[float, float], other: tuple[float, float], w: float, h: float, diamond: bool) -> tuple[float, float]:
    """Where the line from this box's centre towards `other` leaves the box."""
    dx, dy = other[0] - center[0], other[1] - center[1]
    if dx == 0 and dy == 0:
        return center
    half_w, half_h = w / 2, h / 2
    if diamond:
        t = 1 / (abs(dx) / half_w + abs(dy) / half_h)
    else:
        t = min(half_w / abs(dx) if dx else math.inf, half_h / abs(dy) if dy else math.inf)
    return center[0] + dx * t, center[1] + dy * t


def flowchart_scene(flow: dict) -> Scene | None:
    chart = normalize_flowchart(flow)
    if not chart:
        return None
    scene, bounds = Scene(), _Bounds()
    boxes: dict[str, dict] = {}
    for node in chart["nodes"]:
        shape = node["data"]["shape"]
        lines = _lines(node["data"]["label"] or node["id"])
        text_w = max(_text_width(line) for line in lines)
        decision = shape == "decision"
        width = min(max(text_w + (64 if decision else 32), 110 if decision else 100), 220)
        height = max(44 if not decision else 60, len(lines) * 16 + (16 if not decision else 30))
        cx, cy = node["position"]["x"] + 60, node["position"]["y"] + 22
        boxes[node["id"]] = {"c": (cx, cy), "w": width, "h": height, "diamond": decision, "lines": lines, "shape": shape}
        x, y = cx - width / 2, cy - height / 2
        bounds.box(x, y, width, height)
        if decision:
            points = [(cx, y), (cx + width / 2, cy), (cx, y + height), (cx - width / 2, cy)]
            scene.items.append({"kind": "poly", "points": points, "fill": FILL, "stroke": LINE})
        else:
            radius = height / 2 if shape == "round" else 4
            scene.items.append({"kind": "rect", "x": x, "y": y, "w": width, "h": height, "r": radius, "fill": FILL, "stroke": LINE})
        top = cy - (len(lines) - 1) * 8
        for index, line in enumerate(lines):
            scene.items.append({"kind": "text", "x": cx, "y": top + index * 16, "text": line, "size": FONT, "anchor": "middle", "fill": INK})

    for edge in chart["edges"]:
        source, target = boxes[edge["source"]], boxes[edge["target"]]
        if edge["source"] == edge["target"]:
            cx, cy = source["c"]
            right, top = cx + source["w"] / 2, cy - source["h"] / 2
            path = [(cx + 20, top), (cx + 20, top - 26), (right + 26, top - 26), (right + 26, cy), (right, cy)]
            for a, b in zip(path, path[1:], strict=False):
                scene.items.append({"kind": "line", "x1": a[0], "y1": a[1], "x2": b[0], "y2": b[1], "stroke": LINE})
                bounds.add(*a)
                bounds.add(*b)
            scene.items.append({"kind": "poly", "points": _arrow_head(right, cy, math.pi), "fill": LINE, "stroke": LINE})
            mid = (right + 26, top - 26)
        else:
            start = _clip(source["c"], target["c"], source["w"], source["h"], source["diamond"])
            end = _clip(target["c"], source["c"], target["w"], target["h"], target["diamond"])
            angle = math.atan2(end[1] - start[1], end[0] - start[0])
            tail = (end[0] - 8 * math.cos(angle), end[1] - 8 * math.sin(angle))
            scene.items.append({"kind": "line", "x1": start[0], "y1": start[1], "x2": tail[0], "y2": tail[1], "stroke": LINE})
            scene.items.append({"kind": "poly", "points": _arrow_head(end[0], end[1], angle), "fill": LINE, "stroke": LINE})
            bounds.add(*start)
            bounds.add(*end)
            mid = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        label = " ".join(str(edge["label"] or "").split())
        if label:
            width = _text_width(label) + 8
            scene.items.append({"kind": "rect", "x": mid[0] - width / 2, "y": mid[1] - 9, "w": width, "h": 18, "r": 2, "fill": "#ffffff", "stroke": "none"})
            scene.items.append({"kind": "text", "x": mid[0], "y": mid[1], "text": label, "size": 11, "anchor": "middle", "fill": INK})
            bounds.box(mid[0] - width / 2, mid[1] - 9, width, 18)
    return _shift(scene, bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y)


def sequence_scene(flow: dict) -> Scene | None:
    nodes = sorted((flow or {}).get("nodes") or [], key=lambda node: (node.get("position") or {}).get("x", 0))
    if not nodes:
        return None
    scene, bounds = Scene(), _Bounds()
    labels = {node["id"]: " ".join(str((node.get("data") or {}).get("label") or node["id"]).split()) for node in nodes}
    spacing = max(170, max(_text_width(label) for label in labels.values()) + 48)
    centres = {node["id"]: index * spacing for index, node in enumerate(nodes)}
    edges = [edge for edge in (flow.get("edges") or []) if edge.get("source") in centres and edge.get("target") in centres]
    head_h, first, step = 34, 34 + 40, 42
    bottom = head_h + 22 + max(len(edges), 1) * step

    for node in nodes:
        cx = centres[node["id"]]
        label = labels[node["id"]]
        width = max(_text_width(label) + 24, 100)
        actor = bool((node.get("data") or {}).get("actor"))
        scene.items.append({"kind": "line", "x1": cx, "y1": head_h, "x2": cx, "y2": bottom, "stroke": "#9aa5b8", "dash": True})
        scene.items.append({"kind": "rect", "x": cx - width / 2, "y": 0, "w": width, "h": head_h, "r": 17 if actor else 4, "fill": ACTOR_FILL if actor else FILL, "stroke": LINE})
        scene.items.append({"kind": "text", "x": cx, "y": head_h / 2, "text": label, "size": FONT, "anchor": "middle", "fill": INK})
        bounds.box(cx - width / 2, 0, width, bottom)

    for index, edge in enumerate(edges):
        y = first + index * step
        a, b = centres[edge["source"]], centres[edge["target"]]
        reply = (edge.get("data") or {}).get("kind") == "reply"
        label = " ".join(str(edge.get("label") or "").split())
        if a == b:
            loop = [(a, y - 8), (a + 44, y - 8), (a + 44, y + 12), (a + 6, y + 12)]
            for p, q in zip(loop, loop[1:], strict=False):
                scene.items.append({"kind": "line", "x1": p[0], "y1": p[1], "x2": q[0], "y2": q[1], "stroke": LINE, "dash": reply})
            scene.items.append({"kind": "poly", "points": _arrow_head(a, y + 12, math.pi), "fill": LINE, "stroke": LINE})
            if label:
                scene.items.append({"kind": "text", "x": a + 50, "y": y + 2, "text": label, "size": 11, "anchor": "start", "fill": INK})
                bounds.add(a + 50 + _text_width(label), y)
            bounds.add(a + 44, y)
            continue
        direction = 1 if b > a else -1
        end = b - direction * 1
        scene.items.append({"kind": "line", "x1": a, "y1": y, "x2": end - direction * 8, "y2": y, "stroke": LINE, "dash": reply})
        scene.items.append({"kind": "poly", "points": _arrow_head(end, y, 0 if direction == 1 else math.pi), "fill": LINE, "stroke": LINE})
        if label:
            scene.items.append({"kind": "text", "x": (a + b) / 2, "y": y - 9, "text": label, "size": 11, "anchor": "middle", "fill": INK})
            half = _text_width(label) / 2
            bounds.add((a + b) / 2 - half, y)
            bounds.add((a + b) / 2 + half, y)
    return _shift(scene, bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y)


# Class names may include Mermaid generics: Square~Shape~
_CLASS_NAME = r"[A-Za-z_][\w]*(?:~[^~\s]+~)?"
_CLASS_REL = re.compile(
    rf'^({_CLASS_NAME})\s+(?:"([^"]*)"\s+)?'
    r"([^\s\"]+?)"
    rf'\s+(?:"([^"]*)"\s+)?({_CLASS_NAME})(?:\s*:\s*(.*))?$'
)
_CLASS_MEMBER = re.compile(rf"^({_CLASS_NAME})\s*:\s*(.+)$")
_CLASS_DECL = re.compile(rf"^class\s+({_CLASS_NAME})(?:\s*\{{\s*)?$")
_CLASS_SKIP = re.compile(
    r"^(direction\b|note\b|click\b|link\b|style\b|cssClass\b|namespace\b|<<|title\b)",
    re.I,
)
# Known relationship tokens; unknown arrows still draw as a plain association.
_CLASS_ARROWS = {
    "<|--",
    "--|>",
    "<|..",
    "..|>",
    "<|--|>",
    "*--",
    "--*",
    "o--",
    "--o",
    "-->",
    "<--",
    "--",
    "..>",
    "<..",
    "..",
    "*..",
    "..*",
    "o..",
    "..o",
    "<--*",
    "*-->",
    "<--o",
    "o-->",
}


def _class_diagram_lines(source: str) -> list[str]:
    lines = [line.rstrip() for line in (source or "").replace("\r\n", "\n").replace("\r", "\n").splitlines()]
    return [line for line in lines if line.strip() and not line.strip().startswith("%%")]


def is_class_diagram(source: str) -> bool:
    lines = _class_diagram_lines(source)
    if not lines:
        return False
    head = lines[0].strip().lower()
    return head == "classdiagram" or head.startswith("classdiagram ")


def parse_class_diagram(source: str) -> dict | None:
    """Read a class diagram into classes and relations.

    Unknown lines (direction, notes, stereotypes, …) are skipped so a drawable subset still exports as a picture
    instead of falling back to the Mermaid source.
    """
    lines = _class_diagram_lines(source)
    if not lines or not is_class_diagram(source):
        return None
    classes: dict[str, dict] = {}
    relations: list[dict] = []

    def ensure(name: str) -> dict:
        key = name.strip()
        if key not in classes:
            classes[key] = {"name": key, "members": []}
        return classes[key]

    index = 1
    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if _CLASS_SKIP.match(line) or line in ("{", "}"):
            # Skip a `{ ... }` body that followed a stereotype / note we do not draw.
            if line.endswith("{") or line == "{":
                while index < len(lines) and lines[index].strip() != "}":
                    index += 1
                if index < len(lines) and lines[index].strip() == "}":
                    index += 1
            continue
        opened = _CLASS_DECL.match(line)
        if opened:
            entry = ensure(opened.group(1))
            if "{" in line or (index < len(lines) and lines[index].strip() == "{"):
                if "{" not in line:
                    index += 1
                while index < len(lines):
                    member = lines[index].strip()
                    index += 1
                    if member == "}":
                        break
                    if member and not _CLASS_SKIP.match(member):
                        entry["members"].append(member)
            continue
        member = _CLASS_MEMBER.match(line)
        if member:
            ensure(member.group(1))["members"].append(member.group(2).strip())
            continue
        rel = _CLASS_REL.match(line)
        if rel:
            left, left_card, arrow, right_card, right, label = rel.groups()
            # Relations must look like Mermaid connectors, not free text.
            if not re.fullmatch(r"[|o*<.\->]+", arrow):
                continue
            ensure(left)
            ensure(right)
            relations.append(
                {
                    "source": left,
                    "target": right,
                    "arrow": arrow if arrow in _CLASS_ARROWS else "-->",
                    "label": (label or "").strip(),
                    "left_card": left_card or "",
                    "right_card": right_card or "",
                }
            )
            continue
        # Bare class name on its own line (Mermaid allows this).
        bare = re.fullmatch(_CLASS_NAME, line)
        if bare:
            ensure(bare.group(0))
            continue
        # Anything else is ignored so the rest of the diagram still draws.
        continue
    if not classes:
        return None
    return {"classes": list(classes.values()), "relations": relations}


def class_scene(diagram: dict) -> Scene | None:
    classes = list((diagram or {}).get("classes") or [])
    if not classes:
        return None
    scene, bounds = Scene(), _Bounds()
    boxes: dict[str, dict] = {}
    gap_x, gap_y, start_x, start_y = 48, 40, 0.0, 0.0
    columns = 2 if len(classes) > 1 else 1
    row_heights: dict[int, float] = {}
    col_widths: dict[int, float] = {}
    prepared: list[dict] = []
    for index, item in enumerate(classes):
        name = item["name"]
        fields = [m for m in item.get("members") or [] if "(" not in m]
        methods = [m for m in item.get("members") or [] if "(" in m]
        name_w = _text_width(name) + 28
        member_w = max((_text_width(m) for m in fields + methods), default=0) + 28
        width = min(max(name_w, member_w, 120), 260)
        header_h = 28
        field_h = max(22, len(fields) * 16 + 8) if fields else 0
        method_h = max(22, len(methods) * 16 + 8) if methods else 0
        if not fields and not methods:
            field_h = 18
        height = header_h + field_h + method_h
        col, row = index % columns, index // columns
        prepared.append(
            {
                "name": name,
                "fields": fields,
                "methods": methods,
                "w": width,
                "h": height,
                "header_h": header_h,
                "field_h": field_h,
                "method_h": method_h,
                "col": col,
                "row": row,
            }
        )
        col_widths[col] = max(col_widths.get(col, 0), width)
        row_heights[row] = max(row_heights.get(row, 0), height)

    for item in prepared:
        x = start_x + sum(col_widths[c] + gap_x for c in range(item["col"]))
        y = start_y + sum(row_heights[r] + gap_y for r in range(item["row"]))
        w, h = item["w"], item["h"]
        boxes[item["name"]] = {"c": (x + w / 2, y + h / 2), "w": w, "h": h, "x": x, "y": y}
        bounds.box(x, y, w, h)
        scene.items.append({"kind": "rect", "x": x, "y": y, "w": w, "h": h, "r": 0, "fill": FILL, "stroke": LINE})
        scene.items.append({"kind": "text", "x": x + w / 2, "y": y + item["header_h"] / 2, "text": item["name"], "size": FONT, "anchor": "middle", "fill": INK})
        y_cursor = y + item["header_h"]
        if item["field_h"]:
            scene.items.append({"kind": "line", "x1": x, "y1": y_cursor, "x2": x + w, "y2": y_cursor, "stroke": LINE})
            top = y_cursor + 12
            for line in item["fields"] or [""]:
                scene.items.append({"kind": "text", "x": x + 10, "y": top, "text": line, "size": 11, "anchor": "start", "fill": INK})
                top += 16
            y_cursor += item["field_h"]
        if item["method_h"]:
            scene.items.append({"kind": "line", "x1": x, "y1": y_cursor, "x2": x + w, "y2": y_cursor, "stroke": LINE})
            top = y_cursor + 12
            for line in item["methods"]:
                scene.items.append({"kind": "text", "x": x + 10, "y": top, "text": line, "size": 11, "anchor": "start", "fill": INK})
                top += 16

    for edge in diagram.get("relations") or []:
        source, target = boxes.get(edge["source"]), boxes.get(edge["target"])
        if not source or not target:
            continue
        start = _clip(source["c"], target["c"], source["w"], source["h"], False)
        end = _clip(target["c"], source["c"], target["w"], target["h"], False)
        angle = math.atan2(end[1] - start[1], end[0] - start[0])
        arrow = edge["arrow"]
        dash = ".." in arrow
        # Leave room for a marker at the end.
        tip = end
        tail = (end[0] - 12 * math.cos(angle), end[1] - 12 * math.sin(angle))
        scene.items.append({"kind": "line", "x1": start[0], "y1": start[1], "x2": tail[0], "y2": tail[1], "stroke": LINE, "dash": dash})
        if "<|" in arrow or "|>" in arrow:
            # Inheritance / realization: hollow triangle at the generalisation end.
            head_at_target = "|>" in arrow or arrow.endswith("|>")
            hx, hy, hang = (tip[0], tip[1], angle) if head_at_target else (start[0], start[1], angle + math.pi)
            scene.items.append({"kind": "poly", "points": _arrow_head(hx, hy, hang, size=12), "fill": "#ffffff", "stroke": LINE})
        elif arrow.startswith("*") or arrow.endswith("*"):
            # Composition: filled diamond near the * end.
            at_source = arrow.startswith("*")
            dx, dy = (math.cos(angle), math.sin(angle)) if not at_source else (-math.cos(angle), -math.sin(angle))
            base = start if at_source else tip
            diamond = [
                (base[0], base[1]),
                (base[0] - 10 * dx + 6 * dy, base[1] - 10 * dy - 6 * dx),
                (base[0] - 20 * dx, base[1] - 20 * dy),
                (base[0] - 10 * dx - 6 * dy, base[1] - 10 * dy + 6 * dx),
            ]
            scene.items.append({"kind": "poly", "points": diamond, "fill": LINE, "stroke": LINE})
        elif arrow.startswith("o") or arrow.endswith("o"):
            at_source = arrow.startswith("o")
            dx, dy = (math.cos(angle), math.sin(angle)) if not at_source else (-math.cos(angle), -math.sin(angle))
            base = start if at_source else tip
            diamond = [
                (base[0], base[1]),
                (base[0] - 10 * dx + 6 * dy, base[1] - 10 * dy - 6 * dx),
                (base[0] - 20 * dx, base[1] - 20 * dy),
                (base[0] - 10 * dx - 6 * dy, base[1] - 10 * dy + 6 * dx),
            ]
            scene.items.append({"kind": "poly", "points": diamond, "fill": "#ffffff", "stroke": LINE})
        elif arrow.endswith(">") or arrow.startswith("<"):
            head_at_target = arrow.endswith(">")
            hx, hy, hang = (tip[0], tip[1], angle) if head_at_target else (start[0], start[1], angle + math.pi)
            scene.items.append({"kind": "poly", "points": _arrow_head(hx, hy, hang), "fill": LINE, "stroke": LINE})
        bounds.add(*start)
        bounds.add(*end)
        mid = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        bits = [bit for bit in (edge.get("left_card"), edge.get("label"), edge.get("right_card")) if bit]
        label = " ".join(bits)
        if label:
            width = _text_width(label) + 8
            scene.items.append({"kind": "rect", "x": mid[0] - width / 2, "y": mid[1] - 9, "w": width, "h": 18, "r": 2, "fill": "#ffffff", "stroke": "none"})
            scene.items.append({"kind": "text", "x": mid[0], "y": mid[1], "text": label, "size": 11, "anchor": "middle", "fill": INK})
            bounds.box(mid[0] - width / 2, mid[1] - 9, width, 18)
    return _shift(scene, bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y)


def scene_for_block(block: dict) -> Scene | None:
    """A picture of a diagram block, or None when its Mermaid cannot be drawn here (the caller prints the source)."""
    mermaid = str(block.get("mermaid") or "")
    stripped = mermaid.lstrip()
    if stripped.startswith("sequenceDiagram"):
        flow = mermaid_to_flow(mermaid)
        return sequence_scene(flow) if flow else None
    if is_class_diagram(mermaid):
        parsed = parse_class_diagram(mermaid)
        return class_scene(parsed) if parsed else None
    chart = mermaid_to_flowchart(mermaid)
    return flowchart_scene(chart) if chart else None


def _num(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def to_svg(scene: Scene, label: str = "Diagram") -> str:
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_num(scene.width)} {_num(scene.height)}" '
        f'width="{_num(scene.width)}" height="{_num(scene.height)}" role="img" aria-label="{html.escape(label, quote=True)}" '
        'style="max-width:100%;height:auto" font-family="Helvetica, Arial, sans-serif">'
    ]
    for item in scene.items:
        kind = item["kind"]
        if kind == "rect":
            parts.append(
                f'<rect x="{_num(item["x"])}" y="{_num(item["y"])}" width="{_num(item["w"])}" height="{_num(item["h"])}" '
                f'rx="{_num(item.get("r", 0))}" fill="{item["fill"]}" stroke="{item["stroke"]}"/>'
            )
        elif kind == "poly":
            points = " ".join(f"{_num(x)},{_num(y)}" for x, y in item["points"])
            parts.append(f'<polygon points="{points}" fill="{item["fill"]}" stroke="{item["stroke"]}"/>')
        elif kind == "line":
            dash = ' stroke-dasharray="5 4"' if item.get("dash") else ""
            parts.append(
                f'<line x1="{_num(item["x1"])}" y1="{_num(item["y1"])}" x2="{_num(item["x2"])}" y2="{_num(item["y2"])}" '
                f'stroke="{item["stroke"]}" stroke-width="1.3"{dash}/>'
            )
        elif kind == "text":
            parts.append(
                f'<text x="{_num(item["x"])}" y="{_num(item["y"])}" font-size="{item["size"]}" text-anchor="{item["anchor"]}" '
                f'dominant-baseline="central" fill="{item["fill"]}">{html.escape(item["text"])}</text>'
            )
    parts.append("</svg>")
    return "".join(parts)


def _rgb(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)


def _latin(text: str) -> str:
    """The built-in PDF fonts only cover Latin-1."""
    return text.encode("latin-1", "replace").decode("latin-1")


def draw_pdf(pdf, scene: Scene, max_width_mm: float) -> None:
    """Draw the scene at the cursor with FPDF, scaled down to fit the page width, on a new page when it does not fit."""
    px = 0.2646  # one CSS pixel in millimetres
    scale = min(px, max_width_mm / scene.width)
    height = scene.height * scale
    if pdf.get_y() + height > pdf.h - pdf.b_margin:
        pdf.add_page()
    left, top = pdf.l_margin, pdf.get_y()
    pdf.set_line_width(0.3 * scale / px)
    for item in scene.items:
        kind = item["kind"]
        if kind in ("rect", "poly"):
            fill, stroke = item["fill"], item["stroke"]
            pdf.set_fill_color(*_rgb(fill))
            if stroke != "none":
                pdf.set_draw_color(*_rgb(stroke))
            style = "FD" if stroke != "none" else "F"
            if kind == "rect":
                pdf.rect(left + item["x"] * scale, top + item["y"] * scale, item["w"] * scale, item["h"] * scale, style=style)
            else:
                pdf.polygon([(left + x * scale, top + y * scale) for x, y in item["points"]], style=style)
        elif kind == "line":
            pdf.set_draw_color(*_rgb(item["stroke"]))
            if item.get("dash"):
                pdf.set_dash_pattern(dash=1.4, gap=1.1)
            pdf.line(left + item["x1"] * scale, top + item["y1"] * scale, left + item["x2"] * scale, top + item["y2"] * scale)
            if item.get("dash"):
                pdf.set_dash_pattern()
        elif kind == "text":
            pdf.set_text_color(*_rgb(item["fill"]))
            pdf.set_font("Helvetica", size=max(item["size"] * scale / px * 0.75, 4))
            text = _latin(item["text"])
            width = pdf.get_string_width(text)
            x = left + item["x"] * scale - (width / 2 if item["anchor"] == "middle" else 0)
            pdf.text(x, top + item["y"] * scale + item["size"] * scale * 0.3, text)
    pdf.set_text_color(0, 0, 0)
    pdf.set_y(top + height + 4)
    pdf.set_x(pdf.l_margin)
