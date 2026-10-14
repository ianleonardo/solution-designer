import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import cache, db
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


app = FastAPI(title="SolutionCrafter", lifespan=lifespan)
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
