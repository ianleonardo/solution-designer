"""Draw diagrams with Mermaid, the same library the Markdown preview uses."""

import json
import logging
import re
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# backend/app/services/mermaid_render.py -> repository root is three levels up.
_SCRIPT = Path(__file__).resolve().parents[3] / "frontend" / "scripts" / "render-mermaid.mjs"
_SCRIPT_TAG = re.compile(r"<script\b[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL)
_HANDLER = re.compile(r"""\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
_SVG_OPEN = re.compile(r"<svg\b([^>]*)>", re.IGNORECASE)
_VIEWBOX = re.compile(r"""\bviewBox=(?:"([^"]+)"|'([^']+)')""")
_DIMENSION = re.compile(r"""\s(?:width|height)=(?:"[^"]*"|'[^']*')""", re.IGNORECASE)
_MAX_WIDTH = re.compile(r"max-width:\s*[\d.]+px")

# The Markdown preview draws diagrams at half of Mermaid's natural size.
DISPLAY_SCALE = 0.5


def render_svgs(sources: list[str], *, html_labels: bool = True) -> list[str | None]:
    """One SVG per source. None where Mermaid could not draw it, so the caller can use its own picture."""
    if not sources:
        return []
    if not _SCRIPT.is_file() or shutil.which("node") is None:
        return [None] * len(sources)
    try:
        completed = subprocess.run(
            ["node", str(_SCRIPT)],
            input=json.dumps({"sources": sources, "htmlLabels": html_labels}),
            text=True,
            capture_output=True,
            timeout=45,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("Mermaid could not be drawn (%s); the plainer picture is used instead.", exc)
        return [None] * len(sources)
    if completed.returncode != 0 or not completed.stdout.strip():
        detail = (completed.stderr or "").strip()[:300]
        logger.warning("Mermaid could not be drawn (%s); the plainer picture is used instead.", detail or completed.returncode)
        return [None] * len(sources)
    try:
        drawn = json.loads(completed.stdout)
    except json.JSONDecodeError:
        logger.warning("Mermaid returned something that is not a picture.")
        return [None] * len(sources)
    if not isinstance(drawn, list):
        return [None] * len(sources)
    pictures = [_picture(item) for item in drawn]
    if len(pictures) < len(sources):
        pictures.extend([None] * (len(sources) - len(pictures)))
    return pictures[: len(sources)]


def _picture(item: object) -> str | None:
    if not isinstance(item, dict):
        return None
    svg = item.get("svg")
    if not isinstance(svg, str) or "<svg" not in svg:
        return None
    cleaned = _fit(_HANDLER.sub("", _SCRIPT_TAG.sub("", svg)).strip())
    if "<svg" not in cleaned:
        return None
    return cleaned


def _fit(svg: str) -> str:
    """Give the picture a real pixel size. Mermaid's width of 100% otherwise stretches it to the page."""
    box = _VIEWBOX.search(svg)
    if not box:
        return svg
    parts = (box.group(1) or box.group(2) or "").split()
    if len(parts) != 4:
        return svg
    try:
        width = float(parts[2]) * DISPLAY_SCALE
        height = float(parts[3]) * DISPLAY_SCALE
    except ValueError:
        return svg
    if width <= 0 or height <= 0:
        return svg

    def resize(match: re.Match) -> str:
        attrs = _MAX_WIDTH.sub(f"max-width: {width:g}px", _DIMENSION.sub("", match.group(1)), count=1)
        return f'<svg{attrs} width="{width:g}" height="{height:g}">'

    return _SVG_OPEN.sub(resize, svg, count=1)
