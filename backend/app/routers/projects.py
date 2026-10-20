from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse, Response

from app.deps import current_user
from app.services import images, projects

router = APIRouter(tags=["projects"])


@router.get("/dashboard")
def dashboard(user: dict = Depends(current_user)):
    del user
    return projects.dashboard()


@router.get("/projects")
def list_projects(user: dict = Depends(current_user)):
    del user
    return projects.list_projects()


@router.post("/projects")
def create_project(body: dict, user: dict = Depends(current_user)):
    return projects.create_project(
        user,
        str(body.get("project_name") or ""),
        str(body.get("description") or ""),
        body.get("countries"),
        body.get("systems"),
    )


@router.get("/projects/{project_id}")
def get_project(project_id: str, user: dict = Depends(current_user)):
    del user
    return projects.project_row(projects._require_project(project_id))


@router.patch("/projects/{project_id}")
def update_project(project_id: str, body: dict, user: dict = Depends(current_user)):
    name = body.get("project_name")
    description = body.get("description")
    return projects.update_project(
        user,
        project_id,
        None if name is None else str(name),
        None if description is None else str(description),
        body.get("countries"),
        body.get("systems"),
    )


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, user: dict = Depends(current_user)):
    projects.delete_project(user, project_id)
    return {"ok": True}


@router.get("/projects/{project_id}/workspace")
def workspace(project_id: str, user: dict = Depends(current_user)):
    del user
    return projects.workspace(project_id)


@router.get("/projects/{project_id}/references")
@router.get("/projects/{project_id}/baselines", include_in_schema=False)
def list_references(project_id: str, user: dict = Depends(current_user)):
    del user
    return projects.list_baselines(project_id)


@router.post("/projects/{project_id}/references")
@router.post("/projects/{project_id}/baselines", include_in_schema=False)
async def upload_reference(
    project_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    data = await file.read()
    return projects.add_baseline(user, project_id, file.filename or "reference.md", data)


@router.get("/projects/{project_id}/references/{doc_id}/download")
@router.get("/projects/{project_id}/baselines/{doc_id}/download", include_in_schema=False)
def download_reference(
    project_id: str,
    doc_id: str,
    inline: bool = Query(False),
    user: dict = Depends(current_user),
):
    del user
    path, name, media_type = projects.original_baseline_file(project_id, doc_id)
    if inline:
        return FileResponse(path, media_type=media_type, content_disposition_type="inline", filename=name)
    return FileResponse(path, media_type=media_type, filename=name)


@router.delete("/projects/{project_id}/references/{doc_id}")
@router.delete("/projects/{project_id}/baselines/{doc_id}", include_in_schema=False)
def delete_reference(project_id: str, doc_id: str, user: dict = Depends(current_user)):
    projects.delete_baseline(user, project_id, doc_id)
    return {"ok": True}


@router.post("/projects/{project_id}/images")
async def upload_image(
    project_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    data = await file.read()
    return images.save_image(user, project_id, data)


@router.get("/projects/{project_id}/images/{name}")
def get_image(project_id: str, name: str, user: dict = Depends(current_user)):
    del user
    data, media_type = images.read_image(project_id, name)
    return Response(data, media_type=media_type, headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})
