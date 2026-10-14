"""Draws a diagram block as a picture for the HTML and PDF exports.

Mermaid needs a browser to draw, which an export does not have, so the diagram is drawn from the stored drawing
(`flow`) instead, or from the Mermaid text when it is simple enough to read. The result is a `Scene`: a list of simple
shapes that become an inline SVG for HTML (and WeasyPrint) or are drawn with FPDF when WeasyPrint is not available.
Diagrams that cannot be read are left to the caller, which prints the Mermaid source.
"""

import html
import math
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


def scene_for_block(block: dict) -> Scene | None:
    """A picture of a diagram block, or None when its content cannot be drawn."""
    mermaid = str(block.get("mermaid") or "")
    flow = block.get("flow")
    if block.get("sequence"):
        if not (isinstance(flow, dict) and "direction" not in flow and flow.get("nodes")):
            flow = mermaid_to_flow(mermaid)
        return sequence_scene(flow) if flow else None
    chart = normalize_flowchart(flow) if isinstance(flow, dict) and "direction" in flow else None
    chart = chart or mermaid_to_flowchart(mermaid)
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
