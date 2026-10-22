# syntax=docker/dockerfile:1
# SpecForge in one image: the API and the built frontend on port 8000.
# Built for RHEL servers (linux/amd64) with ./scripts/docker-build.sh; runs on Docker or Podman.
# The .env file and the DuckDB file stay outside the image and are mounted by ./scripts/docker-start.sh.

# ---- frontend build (runs on the build machine's own platform; the output is plain files) ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
ARG NPM_CONFIG_REGISTRY
WORKDIR /src
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci --no-audit --no-fund
COPY frontend ./frontend
RUN npm run build -w frontend

# ---- runtime ----
FROM python:3.12-slim-bookworm
ARG PIP_INDEX_URL
ARG PIP_TRUSTED_HOST

# Pango and fonts are needed by WeasyPrint for PDF export; curl is for the health check.
# Versions come from the pinned Debian release of the base image.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        shared-mime-info \
        fonts-dejavu-core \
        curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/tmp

WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY specs/solution_design_document.md ./specs/solution_design_document.md
COPY --from=frontend /src/frontend/dist ./frontend

# DATA_DIR holds uploads; DUCKDB_PATH (set by the start script) names the database file.
# The app reads /app/.env at start-up; variables set on the container win over the file.
ENV SDD_TEMPLATE_PATH=/app/specs/solution_design_document.md \
    DATA_DIR=/data \
    FRONTEND_DIR=/app/frontend

# The container runs as the host user's id (the start script passes --user), not root, so:
#  - the app files must be readable by everyone: COPY keeps the build machine's permissions, and a checkout
#    with owner-only files (-rw-------) would otherwise give "Permission denied: '/app/app/db.py'";
#  - /data is open to all, as the mounted data folder replaces it anyway.
RUN chmod -R a+rX /app && mkdir -p /data && chmod 0777 /data

EXPOSE 8000
# hadolint ignore=DL3025
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

# One worker: DuckDB allows a single writing process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
