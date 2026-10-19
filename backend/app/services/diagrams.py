"""Draws a diagram block as a picture for the HTML and PDF exports.

Mermaid needs a browser to draw, which an export does not have, so the diagram is drawn from the Mermaid text when
it is simple enough to read (flowcharts, sequence diagrams, class diagrams, state diagrams, entity relationships,
Gantt charts and pie charts). The result is a `Scene`: a list of simple shapes that become an inline SVG for HTML
(and WeasyPrint) or are drawn with FPDF when WeasyPrint is not available. Diagrams that cannot be read are left to
the caller, which prints the Mermaid source.
"""

import html
import math
import re
import textwrap
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.flow import _layout, mermaid_to_flow, mermaid_to_flowchart, normalize_flowchart

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


_PIE_COLORS = ("#1a4b8c", "#c47b2b", "#1f7a4d", "#8c3a6e", "#3d6b8c", "#8c1a1a", "#5c6b2f", "#6b4c9a")
_PIE_SLICE = re.compile(r'^(?:"([^"]+)"|([^:]+?))\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*$')
_STATE_ARROW = re.compile(r"^(\[\*\]|[A-Za-z_][\w]*)\s+-->\s+(\[\*\]|[A-Za-z_][\w]*)(?:\s*:\s*(.*))?$")
_STATE_ALIAS = re.compile(r'^state\s+"([^"]+)"\s+as\s+([A-Za-z_][\w]*)\s*$', re.I)
_STATE_OPEN = re.compile(r'^state\s+(?:"([^"]+)"\s+as\s+)?([A-Za-z_][\w]*)\s*\{\s*$', re.I)
_ER_REL = re.compile(
    r"^([A-Za-z_][\w]*)\s+([|o}][|o{])(--|\.\.)([|o}][|o{])\s+([A-Za-z_][\w]*)(?:\s*:\s*(.*))?$"
)
_ER_CARD = {"||": "1", "o|": "0..1", "|o": "0..1", "}|": "1..*", "|{": "1..*", "}o": "0..*", "o{": "0..*"}
_GANTT_STATUS = {"done", "active", "crit", "milestone"}


def _diagram_lines(source: str) -> list[str]:
    lines = [line.strip() for line in (source or "").replace("\r\n", "\n").replace("\r", "\n").splitlines()]
    return [line for line in lines if line and not line.startswith("%%")]


def _head(source: str) -> str:
    lines = _diagram_lines(source)
    return lines[0].lower() if lines else ""


def is_pie(source: str) -> bool:
    head = _head(source)
    return head == "pie" or head.startswith("pie ")


def is_state_diagram(source: str) -> bool:
    head = _head(source)
    return head == "statediagram" or head.startswith("statediagram-v2") or head.startswith("statediagram ")


def is_er_diagram(source: str) -> bool:
    head = _head(source)
    return head == "erdiagram" or head.startswith("erdiagram ")


def is_gantt(source: str) -> bool:
    head = _head(source)
    return head == "gantt" or head.startswith("gantt ")


def _wedge(cx: float, cy: float, radius: float, start: float, end: float) -> list[tuple[float, float]]:
    span = end - start
    steps = max(2, int(abs(span) / (math.pi / 18)))
    points = [(cx, cy)]
    for step in range(steps + 1):
        angle = start + span * step / steps
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def pie_scene(source: str) -> Scene | None:
    """A pie chart: slices around a circle and a legend with each share."""
    if not is_pie(source):
        return None
    lines = _diagram_lines(source)
    rest = lines[0][3:].strip()
    title = ""
    if rest.lower().startswith("showdata"):
        rest = rest[8:].strip()
    if rest.lower().startswith("title"):
        title = rest[5:].strip().strip('"')
    slices: list[tuple[str, float]] = []
    for line in lines[1:]:
        if line.lower().startswith("title ") and not title:
            title = line[6:].strip().strip('"')
            continue
        if line.lower() in {"showdata", "showdata true"}:
            continue
        matched = _PIE_SLICE.match(line)
        if not matched:
            continue
        label = (matched.group(1) or matched.group(2) or "").strip()
        slices.append((label or "—", float(matched.group(3))))
    total = sum(value for _, value in slices)
    if total <= 0:
        return None
    scene, bounds = Scene(), _Bounds()
    cx, cy, radius = 0.0, 0.0, 78.0
    if title:
        scene.items.append({"kind": "text", "x": cx, "y": -radius - 18, "text": title, "size": FONT, "anchor": "middle", "fill": INK})
        bounds.box(-_text_width(title) / 2, -radius - 26, _text_width(title), 16)
    angle = -math.pi / 2
    legend_x = radius + 28
    legend_top = -radius
    for index, (label, value) in enumerate(slices):
        sweep = 2 * math.pi * value / total
        color = _PIE_COLORS[index % len(_PIE_COLORS)]
        points = _wedge(cx, cy, radius, angle, angle + sweep)
        scene.items.append({"kind": "poly", "points": points, "fill": color, "stroke": "#ffffff"})
        for point in points:
            bounds.add(*point)
        angle += sweep
        row_y = legend_top + index * 22
        share = f"{label} ({value:g})"
        scene.items.append({"kind": "rect", "x": legend_x, "y": row_y - 6, "w": 12, "h": 12, "r": 2, "fill": color, "stroke": color})
        scene.items.append({"kind": "text", "x": legend_x + 18, "y": row_y, "text": share, "size": 11, "anchor": "start", "fill": INK})
        bounds.box(legend_x, row_y - 8, 18 + _text_width(share), 16)
    return _shift(scene, bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y)


def state_scene(source: str) -> Scene | None:
    """States and the arrows between them, including the start and end marks."""
    if not is_state_diagram(source):
        return None
    lines = _diagram_lines(source)
    labels: dict[str, str] = {}
    order: list[str] = []
    edges: list[tuple[str, str, str]] = []
    direction = "TB"

    def ensure(name: str, label: str | None = None) -> None:
        if name not in labels:
            labels[name] = label or name
            order.append(name)
        elif label:
            labels[name] = label

    for line in lines[1:]:
        lowered = line.lower()
        if lowered.startswith("direction "):
            token = line.split()[-1].upper()
            direction = "TB" if token in {"TB", "TD"} else "LR"
            continue
        if lowered.startswith(("note ", "style ", "classdef ", "class ", "hide ")):
            continue
        alias = _STATE_ALIAS.match(line)
        if alias:
            ensure(alias.group(2), alias.group(1))
            continue
        opened = _STATE_OPEN.match(line)
        if opened:
            ensure(opened.group(2), opened.group(1))
            continue
        if line in {"{", "}"}:
            continue
        arrow = _STATE_ARROW.match(line)
        if not arrow:
            continue
        source_id, target_id, label = arrow.group(1), arrow.group(2), (arrow.group(3) or "").strip()
        if source_id == "[*]":
            source_id = "__start__"
            ensure(source_id, "Start")
        else:
            ensure(source_id)
        if target_id == "[*]":
            target_id = "__end__"
            ensure(target_id, "End")
        else:
            ensure(target_id)
        edges.append((source_id, target_id, label))
    if not order:
        return None
    positions = _layout(order, [(source_id, target_id) for source_id, target_id, _label in edges], direction)
    nodes = []
    for name in order:
        shape = "round" if name in {"__start__", "__end__"} else "rect"
        nodes.append({"id": name, "position": positions[name], "data": {"label": labels[name], "shape": shape}})
    chart_edges = [
        {"id": f"e{index}", "source": source_id, "target": target_id, "label": label}
        for index, (source_id, target_id, label) in enumerate(edges, start=1)
    ]
    return flowchart_scene({"direction": direction, "nodes": nodes, "edges": chart_edges})


def er_scene(source: str) -> Scene | None:
    """Entities, their attributes, and the relationships between them."""
    if not is_er_diagram(source):
        return None
    entities: dict[str, dict] = {}
    relations: list[dict] = []

    def ensure(name: str) -> dict:
        if name not in entities:
            entities[name] = {"name": name, "attrs": []}
        return entities[name]

    lines = _diagram_lines(source)
    index = 1
    while index < len(lines):
        line = lines[index]
        index += 1
        if line.endswith("{") and not _ER_REL.match(line):
            name = line[:-1].strip()
            if not re.fullmatch(r"[A-Za-z_][\w]*", name):
                continue
            ensure(name)
            while index < len(lines) and lines[index] != "}":
                attr = lines[index].strip().strip('"')
                if attr:
                    ensure(name)["attrs"].append(attr)
                index += 1
            if index < len(lines) and lines[index] == "}":
                index += 1
            continue
        rel = _ER_REL.match(line)
        if not rel:
            continue
        left, left_card, line_kind, right_card, right, label = rel.groups()
        ensure(left)
        ensure(right)
        text = " ".join(
            bit for bit in (_ER_CARD.get(left_card, left_card), (label or "").strip(), _ER_CARD.get(right_card, right_card)) if bit
        )
        relations.append(
            {
                "source": left,
                "target": right,
                "arrow": "..>" if line_kind == ".." else "-->",
                "label": text,
                "left_card": "",
                "right_card": "",
            }
        )
    if not entities:
        return None
    classes = [{"name": item["name"], "members": item["attrs"]} for item in entities.values()]
    return class_scene({"classes": classes, "relations": relations})


def _gantt_date_format(fmt: str) -> str:
    return fmt.replace("YYYY", "%Y").replace("YY", "%y").replace("MM", "%m").replace("DD", "%d").replace("HH", "%H").replace("mm", "%M").replace("ss", "%S")


def _gantt_date(text: str, fmt: str) -> datetime | None:
    try:
        return datetime.strptime(text.strip(), fmt)
    except ValueError:
        return None


def gantt_scene(source: str) -> Scene | None:
    """Tasks as bars on a timeline, grouped by section."""
    if not is_gantt(source):
        return None
    lines = _diagram_lines(source)
    title = ""
    date_fmt = "%Y-%m-%d"
    sections: list[dict] = []
    current = {"name": "", "tasks": []}
    sections.append(current)
    for line in lines[1:]:
        lowered = line.lower()
        if lowered.startswith("title "):
            title = line[6:].strip()
            continue
        if lowered.startswith("dateformat "):
            date_fmt = _gantt_date_format(line.split(None, 1)[1].strip())
            continue
        if lowered.startswith("section "):
            current = {"name": line.split(None, 1)[1].strip(), "tasks": []}
            sections.append(current)
            continue
        if lowered.startswith(("axisformat ", "excludes ", "includes ", "todaymarker ", "weekday ", "tickinterval ", "inclusiveenddates")):
            continue
        if ":" not in line:
            continue
        name, spec = line.split(":", 1)
        name = " ".join(name.split())
        if not name:
            continue
        tags: set[str] = set()
        task_id = ""
        after = ""
        start_date = None
        end_date = None
        duration = None
        for part in (piece.strip() for piece in spec.split(",")):
            if not part:
                continue
            low = part.lower()
            if low in _GANTT_STATUS:
                tags.add(low)
                continue
            if low.startswith("after "):
                after = part.split(None, 1)[1].strip()
                continue
            days = re.fullmatch(r"(\d+)\s*([dw])", low)
            if days:
                duration = int(days.group(1)) * (7 if days.group(2) == "w" else 1)
                continue
            parsed = _gantt_date(part, date_fmt)
            if parsed is not None:
                if start_date is None:
                    start_date = parsed
                else:
                    end_date = parsed
                continue
            if not task_id and re.fullmatch(r"[A-Za-z_][\w]*", part):
                task_id = part
        current["tasks"].append(
            {
                "name": name,
                "id": task_id,
                "after": after,
                "start_date": start_date,
                "end_date": end_date,
                "duration": duration,
                "milestone": "milestone" in tags,
                "crit": "crit" in tags,
                "done": "done" in tags,
            }
        )
    tasks = [task for section in sections for task in section["tasks"]]
    if not tasks:
        return None
    known: dict[str, dict] = {}
    cursor = None
    origin = next((task["start_date"] for task in tasks if task["start_date"]), datetime(2026, 1, 1))
    for task in tasks:
        start = task["start_date"]
        if start is None and task["after"] and task["after"] in known:
            start = known[task["after"]]["end"]
        if start is None:
            start = cursor or origin
        if task["end_date"] and task["end_date"] >= start:
            end = task["end_date"]
        else:
            days = 0 if task["duration"] == 0 or task["milestone"] and task["duration"] in (None, 0) else task["duration"] if task["duration"] is not None else 1
            end = start + timedelta(days=days)
        task["start"] = start
        task["end"] = end
        if task["id"]:
            known[task["id"]] = task
        cursor = end
    first = min(task["start"] for task in tasks)
    last = max(task["end"] for task in tasks)
    span = max((last - first).days, 1)
    label_w = min(max(_text_width(task["name"]) for task in tasks) + 16, 180)
    chart_w = 420
    row_h = 26
    scene, bounds = Scene(), _Bounds()
    y = 0.0
    if title:
        scene.items.append({"kind": "text", "x": 0, "y": 8, "text": title, "size": FONT, "anchor": "start", "fill": INK})
        bounds.box(0, 0, _text_width(title), 16)
        y = 28
    axis_y = y + 8
    scene.items.append({"kind": "line", "x1": label_w, "y1": axis_y, "x2": label_w + chart_w, "y2": axis_y, "stroke": "#9aa5b8"})
    for fraction, moment in ((0, first), (1, last)):
        x = label_w + chart_w * fraction
        stamp = moment.strftime("%d %b")
        scene.items.append({"kind": "text", "x": x, "y": axis_y - 10, "text": stamp, "size": 10, "anchor": "middle" if fraction else "start", "fill": INK})
        bounds.box(x - 24, axis_y - 16, 48, 14)
    bounds.box(label_w, axis_y - 2, chart_w, 4)
    y = axis_y + 16
    for section in sections:
        if not section["tasks"]:
            continue
        if section["name"]:
            scene.items.append({"kind": "text", "x": 0, "y": y + 8, "text": section["name"], "size": 11, "anchor": "start", "fill": LINE})
            bounds.box(0, y, _text_width(section["name"]), row_h)
            y += row_h
        for task in section["tasks"]:
            scene.items.append({"kind": "text", "x": 0, "y": y + row_h / 2, "text": task["name"], "size": 11, "anchor": "start", "fill": INK})
            start_x = label_w + chart_w * (task["start"] - first).days / span
            end_x = label_w + chart_w * max((task["end"] - first).days, (task["start"] - first).days) / span
            if task["milestone"] or task["end"] == task["start"]:
                size = 8
                diamond = [
                    (start_x, y + row_h / 2 - size),
                    (start_x + size, y + row_h / 2),
                    (start_x, y + row_h / 2 + size),
                    (start_x - size, y + row_h / 2),
                ]
                scene.items.append({"kind": "poly", "points": diamond, "fill": "#c47b2b", "stroke": "#c47b2b"})
                for point in diamond:
                    bounds.add(*point)
            else:
                fill = "#1f7a4d" if task["done"] else "#8c1a1a" if task["crit"] else "#1a4b8c"
                width = max(end_x - start_x, 6)
                scene.items.append(
                    {"kind": "rect", "x": start_x, "y": y + 6, "w": width, "h": row_h - 12, "r": 3, "fill": fill, "stroke": fill}
                )
                bounds.box(start_x, y + 6, width, row_h - 12)
            bounds.box(0, y, label_w, row_h)
            y += row_h
    return _shift(scene, bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y)


def scene_for_block(block: dict) -> Scene | None:
    """A picture of a diagram block, or None when its Mermaid cannot be drawn here (the caller prints the source)."""
    mermaid = str(block.get("mermaid") or "")
    stripped = mermaid.lstrip()
    if is_pie(stripped):
        return pie_scene(mermaid)
    if is_state_diagram(stripped):
        return state_scene(mermaid)
    if is_er_diagram(stripped):
        return er_scene(mermaid)
    if is_gantt(stripped):
        return gantt_scene(mermaid)
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


# Larger than the reduced export size, and still capped so a diagram does not take the page over.
EXPORT_SCALE = 0.9375
MAX_DISPLAY_WIDTH = 900
MAX_DISPLAY_HEIGHT = 525


def display_scale(scene: Scene) -> float:
    """How much to shrink a diagram on the HTML page and in the PDF. The picture itself is unchanged."""
    if scene.width <= 0 or scene.height <= 0:
        return EXPORT_SCALE
    return min(EXPORT_SCALE, MAX_DISPLAY_WIDTH / scene.width, MAX_DISPLAY_HEIGHT / scene.height)


def to_svg(scene: Scene, label: str = "Diagram") -> str:
    scale = display_scale(scene)
    width, height = scene.width * scale, scene.height * scale
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_num(scene.width)} {_num(scene.height)}" '
        f'width="{_num(width)}" height="{_num(height)}" role="img" aria-label="{html.escape(label, quote=True)}" '
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
    scale = min(px * display_scale(scene), max_width_mm / scene.width) if scene.width else px
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
