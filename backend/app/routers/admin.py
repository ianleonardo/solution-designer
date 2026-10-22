from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, Response

from app import cache, db
from app.config import kb_bitbucket_projects, kb_countries, kb_databases, kb_interface_channels
from app.deps import current_user, require_admin, require_kb_editor
from app.services import (
    audit,
    batches,
    bitbucket_repos,
    catalogue_export,
    capabilities,
    guidelines,
    interfaces,
    layouts,
    llm_settings,
    projects,
    reindex,
    reports,
    roles,
    systems,
    tables,
)

router = APIRouter(tags=["admin"])


@router.get("/templates")
def list_templates(layout_id: str = "sdd", user: dict = Depends(current_user)):
    del user
    return [db.public_template(item) for item in cache.get_templates(layout_id)]


@router.put("/templates/order")
def reorder(body: dict, user: dict = Depends(require_admin)):
    return layouts.reorder_top_level(user, list(body.get("template_ids") or []))


@router.put("/templates/{template_id}")
def update_template(template_id: str, body: dict, user: dict = Depends(require_admin)):
    return layouts.update_template(user, template_id, body)


@router.delete("/templates/{template_id}")
def delete_template(template_id: str, user: dict = Depends(require_admin)):
    layouts.delete_template(user, template_id)
    return {"ok": True}


@router.get("/layouts")
def list_layouts(user: dict = Depends(current_user)):
    del user
    return layouts.list_layouts()


@router.post("/layouts")
def create_layout(body: dict, user: dict = Depends(require_admin)):
    return layouts.create_layout(
        user,
        str(body.get("name") or ""),
        str(body.get("description") or ""),
        body.get("copy_from") or None,
        bool(body.get("allow_multiple")),
    )


@router.get("/layouts/{layout_id}")
def get_layout(layout_id: str, user: dict = Depends(require_admin)):
    del user
    return layouts.get_layout(layout_id)


@router.put("/layouts/{layout_id}")
def update_layout(layout_id: str, body: dict, user: dict = Depends(require_admin)):
    allow_multiple = body.get("allow_multiple")
    return layouts.update_layout(
        user, layout_id, body.get("name"), body.get("description"), None if allow_multiple is None else bool(allow_multiple)
    )


@router.delete("/layouts/{layout_id}")
def delete_layout(layout_id: str, user: dict = Depends(require_admin)):
    layouts.delete_layout(user, layout_id)
    return {"ok": True}


@router.post("/layouts/{layout_id}/templates")
def add_template(layout_id: str, body: dict, user: dict = Depends(require_admin)):
    return layouts.add_template(user, layout_id, body)


@router.put("/layouts/{layout_id}/order")
def reorder_layout(layout_id: str, body: dict, user: dict = Depends(require_admin)):
    return layouts.reorder_layout(user, layout_id, body.get("sections") or [])


@router.get("/settings")
def get_settings(user: dict = Depends(require_admin)):
    del user
    return llm_settings.settings_payload()


@router.put("/settings")
def put_settings(body: dict, user: dict = Depends(require_admin)):
    return llm_settings.update_settings(
        user,
        str(body.get("active_provider") or ""),
        str(body.get("global_system_prompt") or ""),
    )


@router.get("/audit")
def audit_log(
    user_filter: str = Query("", alias="user"),
    action: str = "",
    entity_type: str = "",
    since: str = "",
    until: str = "",
    limit: int = 2000,
    user: dict = Depends(require_admin),
):
    del user
    return audit.list_entries(user_filter, action, entity_type, since, until, limit)


@router.get("/audit/actions")
def audit_actions(user: dict = Depends(require_admin)):
    del user
    return audit.known_actions()


@router.post("/audit/purge")
def purge_audit(body: dict, user: dict = Depends(require_admin)):
    del user
    removed = audit.purge_entries(str(body.get("since") or ""), str(body.get("until") or ""))
    return {"removed": removed}


@router.get("/reindex/status")
def reindex_status(user: dict = Depends(require_admin)):
    del user
    return reindex.status()


@router.put("/settings/providers/{provider}")
def put_provider(provider: str, body: dict, user: dict = Depends(require_admin)):
    return llm_settings.update_provider(user, provider, body)


@router.get("/users")
def list_users(user: dict = Depends(require_admin)):
    return projects.list_users(user)


@router.post("/users")
def create_user(body: dict, user: dict = Depends(require_admin)):
    return projects.create_user(
        user,
        str(body.get("login_id") or body.get("email") or ""),
        str(body.get("password") or ""),
        str(body.get("role_id") or body.get("role_name") or ""),
        str(body.get("username") or ""),
        str(body.get("auth_provider") or "local"),
    )


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: dict, user: dict = Depends(require_admin)):
    raw_provider = body.get("auth_provider")
    return projects.update_user(
        user,
        user_id,
        str(body.get("username") or ""),
        str(body.get("role_id") or body.get("role_name") or ""),
        str(body.get("password") or ""),
        None if raw_provider is None else str(raw_provider),
    )


@router.delete("/users/{user_id}")
def delete_user(user_id: str, user: dict = Depends(require_admin)):
    projects.delete_user(user, user_id)
    return {"ok": True}


@router.get("/roles")
def list_roles(user: dict = Depends(require_admin)):
    return roles.list_roles(user)


@router.post("/roles")
def create_role(body: dict, user: dict = Depends(require_admin)):
    return roles.create_role(user, body)


@router.get("/roles/{role_id}")
def get_role(role_id: str, user: dict = Depends(require_admin)):
    return roles.get_role(user, role_id)


@router.patch("/roles/{role_id}")
def update_role(role_id: str, body: dict, user: dict = Depends(require_admin)):
    return roles.update_role(user, role_id, body)


@router.delete("/roles/{role_id}")
def delete_role(role_id: str, user: dict = Depends(require_admin)):
    roles.delete_role(user, role_id)
    return {"ok": True}


@router.get("/rag")
def list_rag(user: dict = Depends(current_user)):
    del user
    return projects.list_rag()


@router.post("/rag")
async def upload_rag(
    file: UploadFile = File(...),
    inventory_type: str | None = None,
    user: dict = Depends(require_kb_editor),
):
    data = await file.read()
    return projects.add_rag(user, file.filename or "knowledge.md", data, inventory_type)


@router.delete("/rag/{rag_id}")
def delete_rag(rag_id: str, user: dict = Depends(require_kb_editor)):
    projects.delete_rag(user, rag_id)
    return {"ok": True}


@router.get("/guidelines")
def list_guidelines(user: dict = Depends(current_user)):
    del user
    return guidelines.list_guidelines()


@router.post("/guidelines")
async def add_guideline(
    title: str = Form(""),
    description: str = Form(""),
    file: UploadFile = File(...),
    user: dict = Depends(require_kb_editor),
):
    data = await file.read()
    return guidelines.create(user, title, description, file.filename or "", data)


@router.get("/guidelines/{guideline_id}/download")
def download_guideline(
    guideline_id: str,
    inline: bool = Query(False),
    user: dict = Depends(current_user),
):
    path, name, media_type = guidelines.original_file(user, guideline_id)
    if inline:
        return FileResponse(path, media_type=media_type, content_disposition_type="inline", filename=name)
    return FileResponse(path, media_type=media_type, filename=name)


@router.delete("/guidelines/{guideline_id}")
def delete_guideline(guideline_id: str, user: dict = Depends(require_kb_editor)):
    guidelines.delete(user, guideline_id)
    return {"ok": True}


@router.get("/systems")
def list_systems(user: dict = Depends(current_user)):
    del user
    return systems.list_systems()


@router.post("/systems")
def create_system(body: dict, user: dict = Depends(require_kb_editor)):
    return systems.create_system(user, body)


@router.patch("/systems/{system_code}")
def update_system(system_code: str, body: dict, user: dict = Depends(require_kb_editor)):
    return systems.update_system(user, system_code, body)


@router.get("/systems/{system_code}/delete-impact")
def system_delete_impact(system_code: str, user: dict = Depends(current_user)):
    return systems.delete_impact(user, system_code)


@router.delete("/systems/{system_code}")
def delete_system(system_code: str, confirm: str = "", user: dict = Depends(require_kb_editor)):
    """Deletes the system and its capabilities, batches and reports (interfaces and tables are kept). `confirm` repeats the code."""
    return systems.delete_system(user, system_code, confirm)


@router.post("/systems/upload")
async def upload_systems(file: UploadFile = File(...), user: dict = Depends(require_kb_editor)):
    data = await file.read()
    return systems.upload_from_excel(user, file.filename or "systems.xlsx", data)


@router.get("/catalogs")
def get_catalogs(user: dict = Depends(current_user)):
    del user
    return {
        "countries": list(kb_countries()),
        "databases": list(kb_databases()),
        "interface_channels": list(kb_interface_channels()),
        "bitbucket_projects": list(kb_bitbucket_projects()),
    }


@router.get("/interfaces/{channel}")
def list_interfaces(channel: str, user: dict = Depends(current_user)):
    del user
    return interfaces.list_interfaces(channel)


@router.get("/interfaces/{channel}/{interface_id}")
def get_interface(channel: str, interface_id: str, user: dict = Depends(current_user)):
    del user
    return interfaces.get_interface(channel, interface_id)


@router.get("/interfaces/{channel}/{interface_id}/export")
def export_interface(channel: str, interface_id: str, format: str = "md", user: dict = Depends(current_user)):
    del user
    title, markdown = interfaces.markdown_body(interfaces.get_interface(channel, interface_id))
    return _catalogue_download(title, markdown, format)


@router.post("/interfaces/{channel}")
def create_interface(channel: str, body: dict, user: dict = Depends(require_kb_editor)):
    return interfaces.create_interface(user, channel, body)


@router.patch("/interfaces/{channel}/{interface_id}")
def update_interface(channel: str, interface_id: str, body: dict, user: dict = Depends(require_kb_editor)):
    return interfaces.update_interface(user, channel, interface_id, body)


@router.delete("/interfaces/{channel}/{interface_id}")
def delete_interface(channel: str, interface_id: str, user: dict = Depends(require_kb_editor)):
    interfaces.delete_interface(user, channel, interface_id)
    return {"ok": True}


@router.post("/interfaces/{channel}/fields/upload")
async def upload_interface_fields(
    channel: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_kb_editor),
):
    data = await file.read()
    return interfaces.preview_fields_from_excel(user, channel, file.filename or "fields.xlsx", data)


@router.post("/interfaces/{channel}/upload")
async def upload_interfaces(
    channel: str,
    file: UploadFile = File(...),
    country: str = Form(""),
    user: dict = Depends(require_kb_editor),
):
    data = await file.read()
    return interfaces.replace_from_excel(user, channel, country, file.filename or "interfaces.xlsx", data)


@router.get("/tables")
def list_tables(user: dict = Depends(current_user)):
    del user
    return tables.list_tables()


@router.get("/tables/compare")
def compare_tables(
    database: str = Query(""),
    schema: str = Query(""),
    user: dict = Depends(current_user),
):
    del user
    return tables.compare_tables(database, schema)


@router.post("/tables")
def create_table(body: dict, user: dict = Depends(require_kb_editor)):
    return tables.create_table(user, body)


@router.post("/tables/upload")
async def upload_tables(
    country: str = Form(""),
    database: str = Form(""),
    schema: str = Form(""),
    file: UploadFile = File(...),
    user: dict = Depends(require_kb_editor),
):
    data = await file.read()
    return tables.upload_from_excel(user, country, database, schema, file.filename or "tables.xlsx", data)


@router.post("/tables/columns/delete-batch")
def delete_table_columns_batch(body: dict, user: dict = Depends(require_kb_editor)):
    return tables.delete_columns_batch(user, list(body.get("column_ids") or []))


@router.get("/tables/{table_id}")
def get_table(table_id: str, user: dict = Depends(current_user)):
    del user
    return tables.get_table(table_id)


@router.patch("/tables/{table_id}")
def update_table(table_id: str, body: dict, user: dict = Depends(require_kb_editor)):
    return tables.update_table(user, table_id, body)


@router.delete("/tables/{table_id}")
def delete_table(table_id: str, user: dict = Depends(require_kb_editor)):
    tables.delete_table(user, table_id)
    return {"ok": True}


@router.post("/tables/{table_id}/columns")
def add_table_column(table_id: str, body: dict, user: dict = Depends(require_kb_editor)):
    return tables.add_column(user, table_id, body)


@router.patch("/tables/{table_id}/columns/{column_id}")
def update_table_column(table_id: str, column_id: str, body: dict, user: dict = Depends(require_kb_editor)):
    return tables.update_column(user, table_id, column_id, body)


@router.delete("/tables/{table_id}/columns/{column_id}")
def delete_table_column(table_id: str, column_id: str, user: dict = Depends(require_kb_editor)):
    tables.delete_column(user, table_id, column_id)
    return {"ok": True}


@router.get("/reports")
def list_reports(user: dict = Depends(current_user)):
    del user
    return reports.list_reports()


@router.post("/reports")
def create_report(body: dict, user: dict = Depends(require_kb_editor)):
    return reports.create_report(user, body)


@router.post("/reports/upload")
async def upload_reports(
    country: str = Form(""),
    system: str = Form(""),
    file: UploadFile = File(...),
    user: dict = Depends(require_kb_editor),
):
    data = await file.read()
    return reports.upload_from_excel(user, country, system, file.filename or "reports.xlsx", data)


@router.get("/reports/{report_id}")
def get_report(report_id: str, user: dict = Depends(current_user)):
    del user
    return reports.get_report(report_id)


@router.patch("/reports/{report_id}")
def update_report(report_id: str, body: dict, user: dict = Depends(require_kb_editor)):
    return reports.update_report(user, report_id, body)


@router.delete("/reports/{report_id}")
def delete_report(report_id: str, user: dict = Depends(require_kb_editor)):
    reports.delete_report(user, report_id)
    return {"ok": True}


@router.get("/batches")
def list_batches(user: dict = Depends(current_user)):
    del user
    return batches.list_batches()


@router.post("/batches")
def create_batch(body: dict, user: dict = Depends(require_kb_editor)):
    return batches.create_batch(user, body)


@router.post("/batches/upload")
async def upload_batches(
    country: str = Form(""),
    system: str = Form(""),
    file: UploadFile = File(...),
    user: dict = Depends(require_kb_editor),
):
    data = await file.read()
    return batches.upload_from_excel(user, country, system, file.filename or "batches.xlsx", data)


@router.get("/batches/{batch_id}")
def get_batch(batch_id: str, user: dict = Depends(current_user)):
    del user
    return batches.get_batch(batch_id)


@router.patch("/batches/{batch_id}")
def update_batch(batch_id: str, body: dict, user: dict = Depends(require_kb_editor)):
    return batches.update_batch(user, batch_id, body)


@router.delete("/batches/{batch_id}")
def delete_batch(batch_id: str, user: dict = Depends(require_kb_editor)):
    batches.delete_batch(user, batch_id)
    return {"ok": True}


@router.get("/bitbucket-repos/{project}")
def list_bitbucket_repos(project: str, user: dict = Depends(current_user)):
    del user
    return bitbucket_repos.list_repos(project)


@router.post("/bitbucket-repos/{project}")
def create_bitbucket_repo(project: str, body: dict, user: dict = Depends(require_kb_editor)):
    return bitbucket_repos.create_repo(user, project, body)


@router.post("/bitbucket-repos/{project}/upload")
async def upload_bitbucket_repos(project: str, file: UploadFile = File(...), user: dict = Depends(require_kb_editor)):
    data = await file.read()
    return bitbucket_repos.upload_from_excel(user, project, file.filename or "bitbucket.xlsx", data)


@router.patch("/bitbucket-repos/{project}/{repo_id}")
def update_bitbucket_repo(project: str, repo_id: str, body: dict, user: dict = Depends(require_kb_editor)):
    return bitbucket_repos.update_repo(user, project, repo_id, body)


@router.get("/bitbucket-repos/{project}/{repo_id}/export")
def export_bitbucket_repo(project: str, repo_id: str, format: str = "md", user: dict = Depends(current_user)):
    del user
    title, markdown = bitbucket_repos.markdown_body(bitbucket_repos.get_repo(project, repo_id))
    return _catalogue_download(title, markdown, format)


@router.delete("/bitbucket-repos/{project}/{repo_id}")
def delete_bitbucket_repo(project: str, repo_id: str, user: dict = Depends(require_kb_editor)):
    bitbucket_repos.delete_repo(user, project, repo_id)
    return {"ok": True}


@router.get("/capabilities")
def list_capabilities(user: dict = Depends(current_user)):
    del user
    return capabilities.list_capabilities()


@router.post("/capabilities")
def create_capability(body: dict, user: dict = Depends(require_kb_editor)):
    return capabilities.create_capability(user, body)


@router.post("/capabilities/upload")
async def upload_capabilities(
    system: str = Form(""),
    file: UploadFile = File(...),
    user: dict = Depends(require_kb_editor),
):
    data = await file.read()
    return capabilities.upload_from_excel(user, system, file.filename or "capabilities.xlsx", data)


def _catalogue_download(title: str, markdown: str, format: str) -> Response:
    body, media_type, name = catalogue_export.render_download(title, markdown, format)
    return Response(content=body, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/capabilities/{capability_id}/export")
def export_capability(capability_id: str, format: str = "md", user: dict = Depends(current_user)):
    del user
    title, markdown = capabilities.markdown_body(capabilities.get_capability(capability_id))
    return _catalogue_download(title, markdown, format)


@router.get("/capabilities/{capability_id}")
def get_capability(capability_id: str, user: dict = Depends(current_user)):
    del user
    return capabilities.get_capability(capability_id)


@router.patch("/capabilities/{capability_id}")
def update_capability(capability_id: str, body: dict, user: dict = Depends(require_kb_editor)):
    return capabilities.update_capability(user, capability_id, body)


@router.delete("/capabilities/{capability_id}")
def delete_capability(capability_id: str, user: dict = Depends(require_kb_editor)):
    capabilities.delete_capability(user, capability_id)
    return {"ok": True}


@router.post("/capabilities/{capability_id}/interfaces/{interface_id}")
def link_capability_interface(capability_id: str, interface_id: str, user: dict = Depends(require_kb_editor)):
    return capabilities.link_interface(user, capability_id, interface_id)


@router.delete("/capabilities/{capability_id}/interfaces/{interface_id}")
def unlink_capability_interface(capability_id: str, interface_id: str, user: dict = Depends(require_kb_editor)):
    return capabilities.unlink_interface(user, capability_id, interface_id)


@router.post("/capabilities/{capability_id}/tables/{table_id}")
def link_capability_table(capability_id: str, table_id: str, user: dict = Depends(require_kb_editor)):
    return capabilities.link_table(user, capability_id, table_id)


@router.delete("/capabilities/{capability_id}/tables/{table_id}")
def unlink_capability_table(capability_id: str, table_id: str, user: dict = Depends(require_kb_editor)):
    return capabilities.unlink_table(user, capability_id, table_id)


@router.post("/capabilities/{capability_id}/batches/{batch_id}")
def link_capability_batch(capability_id: str, batch_id: str, user: dict = Depends(require_kb_editor)):
    return capabilities.link_batch(user, capability_id, batch_id)


@router.delete("/capabilities/{capability_id}/batches/{batch_id}")
def unlink_capability_batch(capability_id: str, batch_id: str, user: dict = Depends(require_kb_editor)):
    return capabilities.unlink_batch(user, capability_id, batch_id)


@router.post("/capabilities/{capability_id}/reports/{report_id}")
def link_capability_report(capability_id: str, report_id: str, user: dict = Depends(require_kb_editor)):
    return capabilities.link_report(user, capability_id, report_id)


@router.delete("/capabilities/{capability_id}/reports/{report_id}")
def unlink_capability_report(capability_id: str, report_id: str, user: dict = Depends(require_kb_editor)):
    return capabilities.unlink_report(user, capability_id, report_id)
