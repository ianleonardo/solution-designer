import json
from datetime import datetime

from fastapi import APIRouter, Body, Depends
from fastapi.responses import Response, StreamingResponse

from app import cache, db
from app.content import section_is_empty
from app.deps import current_user
from app.errors import AppError, LLMNotConfigured
from app.missing import evaluate_missing
from app.permissions import require
from app.services import documents, export, gcs, kb_links, llm
from app.services.generate import generate_section

router = APIRouter(tags=["documents"])

# Every document route also has a legacy twin without the document id that targets the project's first document.
DOC = "/projects/{project_id}/documents/{document_id}"
LEGACY = "/projects/{project_id}"


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, default=lambda value: value.isoformat() if isinstance(value, datetime) else str(value))}\n\n"


def _baselines(project_id: str) -> list[dict]:
    return db.fetchall("SELECT file_name, extracted_text FROM baseline_docs WHERE project_id = ?", [project_id])


@router.get("/projects/{project_id}/documents")
def list_documents(project_id: str, user: dict = Depends(current_user)):
    del user
    return documents.list_documents(project_id)


@router.post("/projects/{project_id}/documents")
def create_document(project_id: str, body: dict, user: dict = Depends(current_user)):
    return documents.create_document(user, project_id, str(body.get("layout_id") or ""), str(body.get("title") or ""))


@router.get(DOC)
def get_document(project_id: str, document_id: str, user: dict = Depends(current_user)):
    del user
    return documents.payload(documents.document_row(project_id, document_id), with_templates=True)


@router.delete(DOC)
def delete_document(project_id: str, document_id: str, user: dict = Depends(current_user)):
    documents.delete_document(user, project_id, document_id)
    return {"ok": True}


@router.put(DOC)
@router.put(f"{LEGACY}/sdd")
def save_document(project_id: str, body: dict, document_id: str | None = None, user: dict = Depends(current_user)):
    return documents.save(user, project_id, document_id, body.get("content_json") or {})


@router.post(f"{DOC}/sections")
def add_section(project_id: str, document_id: str, body: dict, user: dict = Depends(current_user)):
    return documents.add_section(user, project_id, document_id, body)


@router.put(f"{DOC}/sections-order")
def reorder_sections(project_id: str, document_id: str, body: dict, user: dict = Depends(current_user)):
    return documents.reorder_sections(user, project_id, document_id, body.get("sections") or [])


@router.patch(f"{DOC}/sections/{{section_id}}")
def update_section(project_id: str, document_id: str, section_id: str, body: dict, user: dict = Depends(current_user)):
    return documents.update_section(user, project_id, document_id, section_id, body)


@router.delete(f"{DOC}/sections/{{section_id}}")
def delete_section(project_id: str, document_id: str, section_id: str, user: dict = Depends(current_user)):
    return documents.delete_section(user, project_id, document_id, section_id)


@router.get(f"{LEGACY}/sdd")
def get_first_document(project_id: str, user: dict = Depends(current_user)):
    del user
    return documents.payload(documents.document_row(project_id))


@router.post(f"{DOC}/validate")
@router.post(f"{LEGACY}/validate")
def validate_document(project_id: str, document_id: str | None = None, user: dict = Depends(current_user)):
    return documents.validate(user, project_id, document_id)


@router.get(f"{DOC}/export")
@router.get(f"{LEGACY}/export")
def export_document(project_id: str, document_id: str | None = None, format: str = "md", user: dict = Depends(current_user)):
    del user
    row = documents.document_row(project_id, document_id)
    project = db.fetchone("SELECT project_name FROM projects WHERE project_id = ?", [project_id])
    project_name = project["project_name"] if project else "Project"
    title = project_name if row["layout_id"] == "sdd" else f"{project_name} - {row['name']}"
    result = documents.payload(row)
    templates = documents.document_templates(row)
    filename = "".join(ch if ch.isalnum() else "-" for ch in title).strip("-") or "document"
    if format == "md":
        body = export.render_markdown(title, templates, result["content_json"])
        return Response(
            body,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{filename}.md"'},
        )
    if format == "html":
        body = export.render_html(title, templates, result["content_json"])
        return Response(
            body,
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="{filename}.html"'},
        )
    if format == "pdf":
        pdf = export.render_pdf_document(title, templates, result["content_json"])
        return Response(
            pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}.pdf"'},
        )
    raise AppError(400, "Format must be md, html, or pdf")


def _require_author(user: dict) -> None:
    require(user, "projects", "write")


def _generate_into(row: dict, templates: list[dict], user: dict, instruction: str = "") -> dict:
    if not llm.configured():
        raise LLMNotConfigured()
    content = documents.payload(row)["content_json"]
    settings = cache.get_settings()
    baselines = _baselines(row["project_id"])
    for template in templates:
        existing = content["sections"].get(template["template_id"])
        section = generate_section(template, baselines, settings, row["project_id"], existing, instruction)
        content["sections"][template["template_id"]] = section
        evaluate_missing(content)
        documents.save_generated(row, content)
    gcs.upload_db()
    return documents.payload(documents.document_row(row["project_id"], row["document_id"]))


@router.post(f"{DOC}/generate")
@router.post(f"{LEGACY}/generate")
def generate_document(
    project_id: str,
    document_id: str | None = None,
    only_empty: bool = False,
    user: dict = Depends(current_user),
):
    _require_author(user)
    if not llm.configured():
        raise LLMNotConfigured()
    row = documents.document_row(project_id, document_id)
    templates = documents.document_templates(row)

    def stream():
        content = documents.payload(row)["content_json"]
        settings = cache.get_settings()
        baselines = _baselines(project_id)
        try:
            for template in templates:
                if only_empty and not section_is_empty(content["sections"].get(template["template_id"]), template):
                    yield _sse({"event": "section_skipped", "section_id": template["template_id"], "name": template["section_name"]})
                    continue
                yield _sse(
                    {
                        "event": "section_start",
                        "section_id": template["template_id"],
                        "name": template["section_name"],
                    }
                )
                existing = content["sections"].get(template["template_id"])
                section = generate_section(template, baselines, settings, project_id, existing)
                content["sections"][template["template_id"]] = section
                evaluate_missing(content)
                documents.save_generated(row, content)
                yield _sse(
                    {
                        "event": "section_done",
                        "section_id": template["template_id"],
                        "section": content["sections"][template["template_id"]],
                    }
                )
        except LLMNotConfigured as exc:
            yield _sse({"event": "error", "message": exc.detail})
            return
        except Exception as exc:
            yield _sse({"event": "error", "message": str(exc)})
            return
        gcs.upload_db()
        fresh = documents.payload(documents.document_row(project_id, row["document_id"]))
        yield _sse({"event": "complete", "sdd": fresh, "document": fresh})

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post(f"{DOC}/sections/{{section_id}}/regenerate")
@router.post(f"{LEGACY}/sections/{{section_id}}/regenerate")
def regenerate_section(
    project_id: str,
    section_id: str,
    document_id: str | None = None,
    body: dict | None = Body(default=None),
    user: dict = Depends(current_user),
):
    _require_author(user)
    if not llm.configured():
        raise LLMNotConfigured()
    row = documents.document_row(project_id, document_id)
    template = next((item for item in documents.document_templates(row) if item["template_id"] == section_id), None)
    if template is None:
        raise AppError(404, "Section not found")
    return _generate_into(row, [template], user, str((body or {}).get("instruction") or ""))


# --- Knowledge Base links ---------------------------------------------------------------------------------------------


@router.post(f"{DOC}/sections/{{section_id}}/kb-links")
def add_kb_links(project_id: str, document_id: str, section_id: str, body: dict = Body(...), user: dict = Depends(current_user)):
    """Add Knowledge Base items as linked rows: {ids} for capabilities / interfaces / reports, or {table_id, column_ids}."""
    return kb_links.link_items(user, project_id, document_id, section_id, body)


@router.post(f"{DOC}/sections/{{section_id}}/kb-refresh")
def refresh_kb_links(project_id: str, document_id: str, section_id: str, user: dict = Depends(current_user)):
    return kb_links.refresh(user, project_id, document_id, section_id)


@router.post(f"{DOC}/sections/{{section_id}}/kb-related")
def related_kb_items(project_id: str, document_id: str, section_id: str, body: dict = Body(...), user: dict = Depends(current_user)):
    del user
    return kb_links.related(project_id, document_id, section_id, body)
