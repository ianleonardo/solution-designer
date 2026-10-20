import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app import cache, db
from app.audit_middleware import AuditMiddleware
from app.config import load_dotenv
from app.errors import AppError
from app.routers import admin, chat, projects, sdd
from app.routers import auth as auth_routes
from app.services import gcs, guidelines, project_rag

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        load_dotenv()
    gcs.download_db_if_needed()
    db.init()
    project_rag.index_missing()
    guidelines.migrate_legacy()
    yield
    gcs.upload_db()
    db.reset()
    cache.invalidate()


app = FastAPI(title="SpecForge", lifespan=lifespan)
app.add_middleware(AuditMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
def app_error_handler(_request, exc: AppError):
    body: dict = {"detail": exc.detail}
    if exc.errors:
        body["errors"] = exc.errors
    return JSONResponse(body, status_code=exc.status)


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.include_router(auth_routes.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(sdd.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(chat.router, prefix="/api")


# In the container the built frontend is served from here, so one port serves the app and its API.
_frontend = Path(os.environ.get("FRONTEND_DIR", "")).resolve() if os.environ.get("FRONTEND_DIR") else None
if _frontend and (_frontend / "index.html").is_file():

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path == "api" or path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        target = (_frontend / path).resolve()
        if path and target.is_file() and _frontend in target.parents:
            return FileResponse(target)
        # every other path is a page of the single-page app
        return FileResponse(_frontend / "index.html", headers={"Cache-Control": "no-cache"})
