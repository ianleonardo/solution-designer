import contextlib
import html
import io
import logging
import os
import re
import sys

from markdown_it import MarkdownIt

from app.errors import AppError
from app.services import diagrams, images, mermaid_render

logger = logging.getLogger(__name__)

# Raw HTML in the text is escaped, so only Markdown formatting reaches the page.
_MARKDOWN = MarkdownIt("commonmark", {"html": False}).enable("strikethrough")


def _restore_underline(html_text: str) -> str:
    """TipTap stores underline as <u>…</u>; keep that tag after Markdown escapes other HTML."""
    return html_text.replace("&lt;u&gt;", "<u>").replace("&lt;/u&gt;", "</u>").replace("&lt;U&gt;", "<u>").replace("&lt;/U&gt;", "</u>")


def _html_text(markdown: str) -> str:
    """Prose written with the rich text editor, as HTML."""
    return _restore_underline(_MARKDOWN.render(markdown or ""))


def _html_cell(markdown: str) -> str:
    """A table cell: inline formatting for one line, full blocks (lists, paragraphs) for several."""
    text = (markdown or "").strip()
    rendered = _MARKDOWN.render(text) if "\n" in text else _MARKDOWN.renderInline(text)
    return _restore_underline(rendered)


_LIST_ITEM = re.compile(r"^(\s*)[-*+]\s+")


def _markdown_cell(cell: str) -> str:
    """One table cell on one line. A Markdown table cannot hold a list, so bullets become a bullet character per line."""
    lines = [_LIST_ITEM.sub(lambda match: f"{match.group(1)}\u2022 ", line) for line in (cell or "").split("\n")]
    return "<br>".join(lines).replace("|", "\\|")


def _cells(row: list[str]) -> str:
    return " | ".join(_markdown_cell(cell) for cell in row)


def heading_level(templates: list[dict], template: dict) -> int:
    """Main sections are h2. Each nesting level goes one deeper, and h6 is the deepest heading."""
    from app.services.layouts import section_depth

    return min(2 + max(section_depth(templates, template.get("template_id")), 0), 6)


def render_markdown(project_name: str, templates: list[dict], content: dict) -> str:
    lines = [f"# {project_name}", ""]
    sections = content.get("sections") or {}
    ordered = sorted(templates, key=lambda item: item["sequence_order"])
    for template in ordered:
        level = "#" * heading_level(ordered, template)
        lines.append(f"{level} {template['section_name']}")
        lines.append("")
        section = sections.get(template["template_id"]) or {}
        for block in section.get("blocks") or []:
            if block.get("type") == "header":
                if block.get("text"):
                    lines.append(f"{'#' * (3 + min(max(int(block.get('level') or 1), 1), 3))} {block['text']}")
                    lines.append("")
            elif block.get("type") == "image":
                source = images.data_uri(block.get("url") or "")
                if source:
                    lines.append(f"![{block.get('alt') or block.get('caption') or ''}]({source})")
                    if block.get("caption"):
                        lines.append(f"*{block['caption']}*")
                    lines.append("")
            elif block.get("type") == "prose":
                if block.get("markdown"):
                    lines.append(block["markdown"])
                    lines.append("")
            elif block.get("type") == "table":
                columns = block.get("columns") or []
                if block.get("table_name"):
                    lines.append(f"**Table Name:** {block['table_name']}")
                    lines.append("")
                lines.append(f"| {_cells(columns)} |")
                lines.append(f"| {_cells(['---'] * len(columns))} |")
                for row in block.get("rows") or []:
                    padded = list(row) + [""] * max(0, len(columns) - len(row))
                    lines.append(f"| {_cells(padded[: len(columns)])} |")
                lines.append("")
            elif block.get("type") == "diagram" and block.get("mermaid"):
                lines.append("```mermaid")
                lines.append(block["mermaid"])
                lines.append("```")
                lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_html(project_name: str, templates: list[dict], content: dict) -> str:
    return _render_html(project_name, templates, content)[0]


_PLACEHOLDER = re.compile(r"<p>@@DIAGRAM(\d+)@@</p>")

# The PDF sets its text at 75% of the size the HTML page uses (body 16px, table cells 14px, code 13px).
PDF_FONT_SCALE = 0.75


def _px(size: float) -> str:
    return f"{size * PDF_FONT_SCALE:g}px"


def _pdf_css() -> str:
    return f"body{{font-size:{_px(16)};}}th,td{{font-size:{_px(14)};}}pre{{font-size:{_px(13)};}}"


def _mermaid_sources(templates: list[dict], content: dict) -> list[str]:
    sources: list[str] = []
    sections = content.get("sections") or {}
    for template in sorted(templates, key=lambda item: item["sequence_order"]):
        section = sections.get(template["template_id"]) or {}
        for block in section.get("blocks") or []:
            if block.get("type") == "diagram" and block.get("mermaid"):
                sources.append(str(block["mermaid"]))
    return sources


def _render_html(
    project_name: str, templates: list[dict], content: dict, placeholders: bool = False, pdf: bool = False
) -> tuple[str, list]:
    """The page as HTML. Diagrams are Mermaid pictures; with `placeholders` they are marked for the FPDF fallback.

    With `pdf` the text is set smaller, and diagram labels are SVG text so they survive WeasyPrint.
    The HTML page keeps Mermaid's HTML labels, matching the Markdown preview.
    """
    scenes: list = []
    sources = _mermaid_sources(templates, content)
    pictures = (
        [None] * len(sources)
        if placeholders
        else mermaid_render.render_svgs(sources, html_labels=not pdf)
    )
    cursor = 0
    parts = [
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>",
        html.escape(project_name),
        "</title><style>",
        "body{font-family:Inter,sans-serif;background:#fafcff;color:#131b2e;margin:2rem auto;max-width:920px;}",
        "h1,h2,h3,h4,h5,h6{font-family:'Plus Jakarta Sans',sans-serif;color:#1a4b8c;}",
        "table{border-collapse:collapse;width:100%;margin:1rem 0;}",
        "th,td{border:1px solid #c3c6d2;padding:6px 8px;vertical-align:top;font-size:14px;}",
        "th{background:#f0f4f8;text-align:left;}",
        "pre{background:#0e1626;color:#dbe1ff;padding:1rem;overflow:auto;}",
        "figure.diagram{margin:0.75rem auto;text-align:center;}",
        "figure.diagram svg{max-width:100%;height:auto;}",
        _pdf_css() if pdf else "",
        "</style></head><body>",
        f"<h1>{html.escape(project_name)}</h1>",
    ]
    sections = content.get("sections") or {}
    ordered = sorted(templates, key=lambda item: item["sequence_order"])
    for template in ordered:
        tag = f"h{heading_level(ordered, template)}"
        parts.append(f"<{tag}>{html.escape(template['section_name'])}</{tag}>")
        section = sections.get(template["template_id"]) or {}
        for block in section.get("blocks") or []:
            if block.get("type") == "header" and block.get("text"):
                level = 3 + min(max(int(block.get("level") or 1), 1), 3)
                parts.append(f"<h{level}>{html.escape(block['text'])}</h{level}>")
            elif block.get("type") == "image":
                source = images.data_uri(block.get("url") or "")
                if source:
                    caption = html.escape(block.get("caption") or "")
                    alt = html.escape(block.get("alt") or block.get("caption") or "")
                    parts.append(
                        f'<figure><img src="{source}" alt="{alt}" style="max-width:100%">'
                        + (f"<figcaption>{caption}</figcaption>" if caption else "")
                        + "</figure>"
                    )
            elif block.get("type") == "prose" and block.get("markdown"):
                parts.append(_html_text(str(block["markdown"])))
            elif block.get("type") == "table":
                columns = block.get("columns") or []
                if block.get("table_name"):
                    parts.append(f"<p><strong>Table Name:</strong> {html.escape(str(block['table_name']))}</p>")
                parts.append("<table><thead><tr>")
                parts.extend(f"<th>{html.escape(column)}</th>" for column in columns)
                parts.append("</tr></thead><tbody>")
                for row in block.get("rows") or []:
                    parts.append("<tr>")
                    padded = list(row) + [""] * max(0, len(columns) - len(row))
                    parts.extend(f"<td>{_html_cell(cell)}</td>" for cell in padded[: len(columns)])
                    parts.append("</tr>")
                parts.append("</tbody></table>")
            elif block.get("type") == "diagram" and block.get("mermaid"):
                picture = pictures[cursor] if cursor < len(pictures) else None
                cursor += 1
                if picture and not placeholders:
                    parts.append(f'<figure class="diagram">{picture}</figure>')
                    continue
                scene = diagrams.scene_for_block(block)
                if scene is None:
                    # Mermaid the app cannot draw is kept as text rather than dropped.
                    parts.append(f"<pre>{html.escape(block['mermaid'])}</pre>")
                elif placeholders:
                    parts.append(f"<p>@@DIAGRAM{len(scenes)}@@</p>")
                    scenes.append(scene)
                else:
                    parts.append(f'<figure class="diagram">{diagrams.to_svg(scene, template["section_name"])}</figure>')
    parts.append("</body></html>")
    return "".join(parts), scenes


def render_pdf_document(project_name: str, templates: list[dict], content: dict) -> bytes:
    """The PDF of a document. WeasyPrint draws the Mermaid pictures; the FPDF fallback draws the plainer shapes."""
    page, _ = _render_html(project_name, templates, content, pdf=True)
    rendered = _render_pdf_weasyprint(page)
    if rendered is not None:
        return rendered
    page, scenes = _render_html(project_name, templates, content, placeholders=True, pdf=True)
    return _render_pdf_fallback(page, scenes)


def render_pdf(page: str) -> bytes:
    rendered = _render_pdf_weasyprint(page)
    if rendered is not None:
        return rendered
    return _render_pdf_fallback(page)


def _find_native_libraries() -> None:
    """WeasyPrint needs Pango. Homebrew puts it where a virtualenv's Python does not look, so point macOS at it."""
    if sys.platform != "darwin":
        return
    folders = [folder for folder in ("/opt/homebrew/lib", "/usr/local/lib") if os.path.isdir(folder)]
    known = [folder for folder in os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "").split(":") if folder]
    missing = [folder for folder in folders if folder not in known]
    if missing:
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = ":".join(known + missing)


def _render_pdf_weasyprint(page: str) -> bytes | None:
    captured = io.StringIO()
    _find_native_libraries()
    try:
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            from weasyprint import HTML

            return HTML(string=page).write_pdf()
    except Exception as exc:
        logger.warning("WeasyPrint is not available (%s); the PDF is built with the plainer fallback.", exc)
        return None


_BLOCKS = {"p", "div", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6"}


def _cell_text(cell) -> str:
    """A table cell as plain text with line breaks: FPDF only takes a single run of text inside a cell."""
    lines: list[str] = []
    buffer: list[str] = []
    state = {"indent": "", "bullet": ""}

    def flush() -> None:
        text = " ".join("".join(buffer).split())
        buffer.clear()
        if text:
            lines.append(f"{state['indent']}{state['bullet']}{text}")
            state["bullet"] = ""

    def emit_list(items, indent: str) -> None:
        ordered = items.name == "ol"
        for number, item in enumerate(items.find_all("li", recursive=False), start=1):
            flush()
            state["indent"], state["bullet"] = indent, f"{number}. " if ordered else "- "
            walk(item, indent + "  ")
            flush()
            state["indent"], state["bullet"] = "", ""

    def walk(node, indent: str = "") -> None:
        for child in node.children:
            name = getattr(child, "name", None)
            if name is None:
                buffer.append(str(child))
            elif name == "br":
                flush()
            elif name in ("ul", "ol"):
                flush()
                emit_list(child, indent)
            elif name in _BLOCKS:
                flush()
                walk(child, indent)
                flush()
            else:
                walk(child, indent)

    walk(cell)
    flush()
    return "\n".join(lines)


_TYPOGRAPHY = str.maketrans(
    {
        "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-", "\u2026": "...",
        "\u2022": "-", "\u2192": "->", "\u2190": "<-", "\u00a0": " ", "\u2713": "v", "\u2714": "v", "\u2717": "x",
    }
)


def _latin1(text: str) -> str:
    """The built-in PDF fonts only cover Latin-1: swap common typography for plain characters, and anything else for '?'."""
    return text.translate(_TYPOGRAPHY).encode("latin-1", "replace").decode("latin-1")


def _flatten_cells(soup) -> None:
    for table in soup.find_all("table"):
        table["border"] = "1"
        table["width"] = "100%"
    for cell in soup.find_all(["td", "th"]):
        text = _cell_text(cell)
        cell.clear()
        if text:
            cell.append(text)


BODY_PT = 10 * PDF_FONT_SCALE
HEADING_PT = 14 * PDF_FONT_SCALE
SUBHEADING_PT = 11 * PDF_FONT_SCALE


def _scaled_tag_styles() -> dict:
    """FPDF's built-in heading sizes (h1 24pt, h2 18pt, ...), scaled down with the rest of the text."""
    from fpdf.html import DEFAULT_TAG_STYLES

    return {
        tag: style.replace(font_size_pt=style.size_pt * PDF_FONT_SCALE)
        for tag, style in DEFAULT_TAG_STYLES.items()
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6", "title"} and style.size_pt
    }


def _render_pdf_fallback(page: str, scenes: list | None = None) -> bytes:
    from bs4 import BeautifulSoup
    from fpdf import FPDF
    from fpdf.errors import FPDFException

    soup = BeautifulSoup(page, "html.parser")
    _flatten_cells(soup)
    fragment = _latin1(soup.body.decode_contents() if soup.body else page)
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", size=BODY_PT)
    try:
        pieces = _PLACEHOLDER.split(fragment)
        for index, piece in enumerate(pieces):
            if index % 2 == 0:
                if piece.strip():
                    pdf.write_html(piece, tag_styles=_scaled_tag_styles())
            elif scenes and int(piece) < len(scenes):
                pdf.ln(2)
                diagrams.draw_pdf(pdf, scenes[int(piece)], pdf.w - pdf.l_margin - pdf.r_margin)
    except (FPDFException, NotImplementedError):
        # HTML FPDF cannot lay out should not lose the whole export: fall back to the document's plain text.
        return _render_pdf_plain(soup)
    return bytes(pdf.output())


def _render_pdf_plain(soup) -> bytes:
    from fpdf import FPDF
    from fpdf.errors import FPDFException

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", size=BODY_PT)
    body = soup.body or soup
    for element in body.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "tr", "pre"]):
        if element.name == "tr":
            text = " | ".join(cell.get_text(" ", strip=True) for cell in element.find_all(["td", "th"]))
        else:
            text = element.get_text(" ", strip=True)
        text = _latin1(text)
        if not text:
            continue
        if element.name.startswith("h"):
            pdf.set_font("Helvetica", style="B", size=HEADING_PT if element.name in ("h1", "h2") else SUBHEADING_PT)
        else:
            pdf.set_font("Helvetica", size=BODY_PT)
        try:
            pdf.multi_cell(0, 5 * PDF_FONT_SCALE, text, new_x="LMARGIN", new_y="NEXT")
        except FPDFException as exc:
            raise AppError(500, "Could not build the PDF.") from exc
    return bytes(pdf.output())
