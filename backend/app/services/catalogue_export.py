"""Markdown and PDF downloads for a catalogue record. Diagrams are fenced Mermaid, drawn in the PDF."""

import re

from app.errors import AppError
from app.services import export


def filename(title: str) -> str:
    slug = "".join(char if char.isalnum() else "-" for char in title).strip("-")
    return slug or "download"


def _blocks(markdown: str) -> list[dict]:
    parts = re.split(r"```mermaid\n([\s\S]*?)\n```", markdown or "")
    blocks: list[dict] = []
    for index, part in enumerate(parts):
        if index % 2 == 0:
            text = part.strip()
            if text:
                blocks.append({"type": "prose", "markdown": text})
        elif part.strip():
            blocks.append({"type": "diagram", "sequence": False, "mermaid": part.strip()})
    if not blocks:
        blocks.append({"type": "prose", "markdown": ""})
    return blocks


def render_download(title: str, markdown: str, format: str) -> tuple[str | bytes, str, str]:
    """(body, media type, download filename)."""
    name = filename(title)
    if format == "md":
        body = f"# {title}\n\n{markdown}".rstrip() + "\n"
        return body, "text/markdown", f"{name}.md"
    if format == "pdf":
        templates = [{"template_id": "body", "section_name": "Details", "sequence_order": 0}]
        content = {"sections": {"body": {"blocks": _blocks(markdown)}}}
        return export.render_pdf_document(title, templates, content), "application/pdf", f"{name}.pdf"
    raise AppError(400, "Format must be md or pdf.")
