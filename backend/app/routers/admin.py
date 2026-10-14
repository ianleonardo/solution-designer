from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse

from app import cache, db
from app.deps import current_user, require_admin
from app.services import (
    audit,
    guidelines,
    interfaces,
    layouts,
    llm_settings,
    projects,
    reindex,
    systems,
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
        user, str(body.get("name") or ""), str(body.get("description") or ""), body.get("copy_from") or None
    )


@router.get("/layouts/{layout_id}")
def get_layout(layout_id: str, user: dict = Depends(require_admin)):
    del user
    return layouts.get_layout(layout_id)


@router.put("/layouts/{layout_id}")
def update_layout(layout_id: str, body: dict, user: dict = Depends(require_admin)):
    return layouts.update_layout(user, layout_id, body.get("name"), body.get("description"))


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
        str(body.get("role_name") or ""),
        str(body.get("username") or ""),
    )


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: dict, user: dict = Depends(require_admin)):
    return projects.update_user(
        user,
        user_id,
        str(body.get("username") or ""),
        str(body.get("role_name") or ""),
    )


@router.delete("/users/{user_id}")
def delete_user(user_id: str, user: dict = Depends(require_admin)):
    projects.delete_user(user, user_id)
    return {"ok": True}


@router.get("/rag")
def list_rag(user: dict = Depends(require_admin)):
    del user
    return projects.list_rag()


@router.post("/rag")
async def upload_rag(
    file: UploadFile = File(...),
    inventory_type: str | None = None,
    user: dict = Depends(require_admin),
):
    data = await file.read()
    return projects.add_rag(user, file.filename or "knowledge.md", data, inventory_type)


@router.delete("/rag/{rag_id}")
def delete_rag(rag_id: str, user: dict = Depends(require_admin)):
    projects.delete_rag(user, rag_id)
    return {"ok": True}


@router.get("/guidelines")
def list_guidelines(user: dict = Depends(require_admin)):
    del user
    return guidelines.list_guidelines()


@router.post("/guidelines")
async def add_guideline(
    title: str = Form(""),
    description: str = Form(""),
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    data = await file.read()
    return guidelines.create(user, title, description, file.filename or "", data)


@router.get("/guidelines/{guideline_id}/download")
def download_guideline(guideline_id: str, user: dict = Depends(require_admin)):
    path, name, media_type = guidelines.original_file(user, guideline_id)
    return FileResponse(path, media_type=media_type, filename=name)


@router.delete("/guidelines/{guideline_id}")
def delete_guideline(guideline_id: str, user: dict = Depends(require_admin)):
    guidelines.delete(user, guideline_id)
    return {"ok": True}


@router.get("/systems")
def list_systems(user: dict = Depends(require_admin)):
    del user
    return systems.list_systems()


@router.post("/systems")
def create_system(body: dict, user: dict = Depends(require_admin)):
    return systems.create_system(user, body)


@router.patch("/systems/{system_code}")
def update_system(system_code: str, body: dict, user: dict = Depends(require_admin)):
    return systems.update_system(user, system_code, body)


@router.delete("/systems/{system_code}")
def delete_system(system_code: str, user: dict = Depends(require_admin)):
    systems.delete_system(user, system_code)
    return {"ok": True}


@router.get("/interfaces/{channel}")
def list_interfaces(channel: str, user: dict = Depends(require_admin)):
    del user
    return interfaces.list_interfaces(channel)


@router.post("/interfaces/{channel}/upload")
async def upload_interfaces(channel: str, file: UploadFile = File(...), user: dict = Depends(require_admin)):
    data = await file.read()
    return interfaces.replace_from_excel(user, channel, file.filename or "interfaces.xlsx", data)
