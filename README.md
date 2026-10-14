# SolutionCrafter

SolutionCrafter generates enterprise documents, such as **Solution Design Documents (SDDs)** and **Interface Specifications**, with an LLM. It works from each project's own reference documents (BRD, FSD, epic/story lists) and a shared architecture knowledge base. Generated documents can be edited section by section, and exported as Markdown, HTML or PDF.

---

## Features

### Projects, documents and generation
- A project holds several documents, one per document layout: the **Solution Design Document** and the **Interface Specifications Document** are built in. Documents appear as tabs in the project workspace. Write users can add or remove them.
- **A document keeps its own copy of the layout.** Its sections are copied from the layout when the document is created (older documents are copied once on upgrade). Changing, deleting or reordering sections in **Settings > Document Layouts** later does not touch documents that already exist; only documents created afterwards use the new layout. There is no re-sync from the layout.
- **Editing a document's structure.** Write users can use **Edit structure** in the outline to rename, add, delete and reorder sections and sub-sections (two levels), indent or outdent a sub-section, and open a section's settings (name, blocks, hint, prompt, temperature, word limit). Content stays with the blocks that remain; a removed block type loses its content. Admin can still change a section's prompt, temperature and word limit, but nothing else.
- **Project references.** Write users upload reference documents to a project (**PDF, Markdown, Excel**). Each file is split into chunks, embedded when an embedding model is configured, and searched only for that project. Admin and Read users can see the list but not change it. Without an embedding model the chunks are searched by keyword only.
- **Auto fill** (Write). *Auto fill document* streams progress section by section and, by default, fills only the empty sections so your edits are kept; choose *Regenerate every section* to replace everything. *Auto fill* on a single section accepts an optional extra instruction that applies to that run only. A confirmation warns before content is replaced. A section counts as empty when it holds only blanks, the layout's starter table rows or the starter diagram.
- Each section is built from the global system prompt, the section prompt, the most relevant project reference chunks and the most relevant knowledge-base entries (hybrid keyword + embedding retrieval).
- **Missing information alerts** flag mandatory SDD content the references don't supply, such as NFR volumetrics and DB growth estimates.
- Exporting and generating apply to the open document. There is no approval workflow and documents have no status.

### Interactive editor (3-pane workspace)
- **Left:** the document outline. It follows the document's own layout and shows missing-information warnings.
- **Center:** section editors.
  - A WYSIWYG prose editor (TipTap) with headings, bold, italic, strike, lists, quotes, links, code and rules. It is stored as Markdown.
  - Editable data grids for tables. Cells are rich text too (click a cell to format it), and rows can be added and deleted, and moved by dragging the handle at the start of the row (or with the arrow keys while the handle has focus). A table whose first column is **SN** (also `S/N`, `No`, `#` or `Serial No`) numbers its rows automatically: the column is read-only and the numbers update when you add, delete or move a row.
  - Diagrams are edited as **Mermaid** text. The editor has line numbers, a live preview that shows the error and its line when the syntax is wrong, a *Diagram template* picker (flowchart, sequence, class, state, ER, Gantt, pie) and a *Syntax help* panel. Any Mermaid diagram type is allowed in any diagram block. **HTML and PDF exports draw flowcharts and sequence diagrams as pictures** from the Mermaid text; other diagram types are printed as their Mermaid source. Markdown export keeps a `mermaid` code fence.
  - Header blocks (with a size picker), and image blocks you upload (PNG, JPEG, GIF or WEBP, up to 5 MB). The model never writes headers or images.
- **Right (Admin):** tune a section's prompt, temperature and word limit.

### Workflow and roles (RBAC)

| Role | Capabilities |
|---|---|
| **Admin** | Settings, users, document layouts, knowledge base. Admin does not create, edit or delete projects or documents; Admin only tunes a section's prompt, temperature and word limit. |
| **Write** | Create, edit and delete projects and documents, upload project references, generate (auto fill) and edit content and structure |
| **Read** | Read-only access to the dashboard, projects and documents |

Admin does not create, edit or delete projects or documents. There is no approval workflow: Write users edit documents directly and documents have no status.

Existing databases are migrated on start: `Maker` and `Checker` users become `Write` and `Viewer` users become `Read`.

### Audit log (Admin only)
Every change by every user is recorded: who (user and role), when (UTC), what (action, project or other entity and a short summary) and from which IP address. This covers projects, documents, references, knowledge base, layouts, users, settings and exports, plus **sign-ins and failed sign-ins**. Requests that fail are not logged as changes. Passwords, API keys and tokens are never stored, and large content (document text, table rows, diagram blocks) is left out of the details. Admin opens **Settings > Audit Log** to filter by action and date range, search and expand an entry for its details. The API is `GET /api/audit` (Admin only).

### Knowledge base (RAG): Admin only
- The **Knowledge Base** menu has one screen per type: **Systems, Capabilities, Interfaces, Table Definitions, Screens, Batches, Reports, Guidelines**. Capabilities, Table Definitions, Screens, Batches and Reports each have an upload, search, and a sortable table with 50 rows per page.
- **Systems** is a catalogue you add, edit and delete by hand: System Code, System Name, Description, Upstreams and Downstreams. Upstreams and Downstreams are system codes separated by commas; they can be empty, but every code you enter must already exist. The code is fixed after it is created. A system cannot be deleted while another system lists it, or an interface uses it.
- **Interfaces** has one tab per channel: **SPL, DGE, PIB, WSM, EAI**. Each tab takes an Excel (.xlsx) upload with the columns `Country, Interface name, Description, Protocol, Source, Destination`. Country must be SG, MY, TH, VN, ID, CN or All. Protocol must be API, MQ, Kafka, gRPC, FTP, SMTP or SMPP. Source and Destination must be existing system codes. If any row is invalid the whole file is rejected with the row and column of each problem; a valid upload replaces that tab's interfaces.
- **Guidelines** are documents rather than extracted entries. **Add** opens a form with a title, a description and a file (`.md`, `.pdf` or `.txt`, up to 20 MB). The text is split into chunks (about 800 characters with overlap) and each chunk is embedded for RAG together with the title and description, so generation and chat can use it. The table shows the chunk count and an embedding status: **Embedded**, **Keyword only** (no embedding model configured, or embedding failed) or **Outdated model** (embedded with a different embedding model than the active one). There are no per-guideline re-embed buttons: changing the embedding model re-indexes everything automatically (see **LLM** below). Per row:
  - **Download** saves the original uploaded file. Files are kept under `DATA_DIR/uploads/guidelines` and, when `GCS_BUCKET` is set, copied to the bucket under `uploads/guidelines/`. If the local copy is gone (for example after a Cloud Run restart) it is fetched back from the bucket. Entries converted from the old inventory have no original file, so they have no Download button.
  - **Delete** removes the guideline, its chunks and the stored file (locally and in the bucket).
  Guidelines saved without embeddings are still searched by keyword. Guidelines uploaded before this feature are converted automatically on start-up, with the entry's name as the title and no description. They get vectors at the next re-index. Only Admin can manage guidelines.
- Upload **.md, .pdf, .html** files. The app extracts inventory entries and gives each a unique ID (for example `SC-001` for a screen). A screen's upload files everything under that screen's type.
- Extraction uses the LLM when one is configured, and heuristic parsing otherwise.
- Embeddings are stored in DuckDB for semantic retrieval.

### Admin settings (Admin only)
- **LLM:** three providers, **Gemini**, **Anthropic** and **Spirare** (OpenAI-compatible). Each has its own chat model and URL, embedding model and URL, and API keys. One provider is active at a time. Settings are stored in the database. API keys are encrypted at rest and write-only: the API never returns them, and a blank field keeps the saved key. Anthropic has no embeddings API, so its embeddings use a Voyage-style endpoint (`POST {embedding URL}/embeddings`) with its own key. Leave it blank to search by keyword only.
  - **Re-index.** Stored vectors belong to one embedding setup (active provider, embedding model, URL and key). When you switch the active provider or save a different embedding model, URL or key for it, the app re-makes **every** stored vector in the background: knowledge base entries, guideline chunks, systems, interfaces and every project's reference chunks. The LLM page shows progress (`Re-indexing the knowledge base… 120 of 840`) and the result. With no embedding model configured the vectors are cleared and search uses keywords only. Items that fail to embed are counted and searched by keyword. The work runs in a background thread, so on Cloud Run keep CPU allocated after the response; an interrupted run is repeated at the next save because the new setup is only recorded when a run finishes.
- **Document Layouts:** a table of layouts (sortable, searchable). A layout has a document name and sections with sub-sections. Each section is built from blocks (**header, text, table, image, diagram**) and has its own auto-generation prompt, temperature and word limit. Sections can be added, deleted and reordered by drag and drop or arrows, and a sub-section can move to another section. The Interface Specifications layout is seeded from `backend/app/seed_layouts.py`. Built-in layouts can be edited but not deleted, and a layout used by a project document cannot be deleted. Layout changes apply only to documents created afterwards.
- **Users:** add a user with Login ID, name, password and role. You can edit only the name and role. Delete asks for confirmation. The list is searchable, sortable and shows 20 per page. The last admin cannot be demoted or deleted.
- Changes take effect right away without a server restart, through an in-process cache that is cleared on update.

### Other
- **Export:** Markdown, HTML, PDF. PDF uses WeasyPrint and falls back to fpdf2 if WeasyPrint isn't available. PDF text is set at 75% of the size used in the HTML export.
- **Chat with analyst:** opened from the round button at the bottom right. It answers IT solutioning and architecture questions. General questions are answered from the model's own knowledge. Questions about specific systems, interfaces, capabilities, tables and similar are answered from everything in the knowledge base: systems (with their upstream and downstream systems), interfaces, capabilities, table definitions, screens, batches, reports and guidelines. The model also gets a summary of what the knowledge base holds. The current project's documents and references are added when you chat inside a project. Messages first pass guardrails against prompt injection, unethical requests and off-topic questions.
- **Global system prompt (Settings > LLM):** sets the shared role and grounding rules for both generation and chat. It no longer contains an output format. The app adds the JSON and grounding rules when generating sections, and plain-text rules for chat. A prompt you have edited is never overwritten. An unedited copy of the old default is upgraded on start-up.
- **Dashboard:** total projects, total documents and documents generated.
- **Projects list:** sortable columns, search and 30 projects per page.
- **Themes:** dark by default. The theme button in the top bar (and on the login page) cycles **dark, light, jade green**, and the choice is remembered in the browser.

---

## Technical specs

| Layer | Stack |
|---|---|
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 3, React Router 6, TipTap 2, Mermaid 11 |
| Frontend tests and lint | Vitest + Testing Library (jsdom), ESLint 9 |
| Backend | Python 3.12, FastAPI, Uvicorn |
| Database | DuckDB (a single file: `$DATA_DIR/solutioncrafter.duckdb`) |
| LLM / embeddings | LangChain `ChatOpenAI` / `OpenAIEmbeddings` (`text-embedding-3-small`). Works with any OpenAI-compatible endpoint. |
| Auth | JWT (HS256, 12-hour expiry), bcrypt password hashes |
| File parsing | pdfplumber, pandas + openpyxl/xlrd, BeautifulSoup/lxml |
| Export | WeasyPrint (PDF), fpdf2 fallback |
| Backend tests and lint | pytest, ruff |
| Serving | nginx serves the built SPA and proxies `/api/` to the backend (SSE-friendly: buffering off, 1h read timeout) |
| Cloud | Google Cloud Run (two services), Artifact Registry, Secret Manager, Cloud Storage (DuckDB persistence) |
| CI/CD | GitHub Actions: `ci.yml` (lint, test, build, image build) and `cloud-run.yml` (deploy) |

### Repository layout

```
backend/
  app/
    main.py              FastAPI app, lifespan (GCS download → DB init → GCS upload)
    config.py            env config, seed users, role sets
    db.py                DuckDB connection, schema, seeding
    template_parser.py   turns the SDD template markdown into section schemas
    content.py, missing.py, flow.py
    seed_layouts.py      the seeded Interface Specifications layout
    crypto.py            Fernet encryption for stored API keys
    routers/             auth, projects, sdd (document generate/export), admin (settings, layouts, users), chat
    services/            llm (facade) + llm_adapters (gemini, anthropic, spirare), llm_settings, generate,
                         retrieve, project_rag, documents, layouts, images, files, export, guardrails, gcs, projects
  tests/
frontend/
  src/                   pages/, components/, api.ts, auth.tsx, flow.ts
  nginx.conf, Dockerfile
specs/
  solution_design_document.md        the default SDD template (sections, tables, hints)
  Solution Design Document Generator.md  product requirements
  UI/                    UI mockups and design-system notes
```

### SDD template

The section structure comes from `specs/solution_design_document.md`:
- `##` headings become top-level sections and `###` headings become sub-sections.
- Markdown tables become editable tables with fixed columns.
- Italic `<<...>>` lines become generation hints.

The template is loaded into the database **only when the SDD layout has no sections**. After editing the file, delete the local DuckDB file so it gets re-seeded. Other layouts are managed in the app under **Settings > Document Layouts**.

---

## Local setup

### Prerequisites
- **Python 3.12+**
- **Node.js 22** and npm
- An **API key** for Gemini, Anthropic or an OpenAI-compatible provider (Spirare). You can log in and edit without one, but generation and chat need it.
- Optional, for high-quality PDF export: Pango, needed by WeasyPrint. On macOS: `brew install pango`. On Debian/Ubuntu: `apt install libpango-1.0-0 libpangocairo-1.0-0`.
- Optional: Docker and Docker Compose.

### 1. Configure the environment

The repository includes a ready-to-use `.env` in the project root. The backend reads it at startup, and Docker Compose reads it too. It is git-ignored, so keep it out of version control and create your own copy on any other machine. Edit `.env`:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Secret used to sign JWTs. Use a long random string. |
| `DATA_DIR` | Where the DuckDB file and uploads are stored (default `./data`) |
| `SETTINGS_ENCRYPTION_KEY` | Optional. Encrypts the provider API keys stored in the database. Defaults to a value derived from `JWT_SECRET`. Changing it makes saved keys unreadable, so they must be entered again. |
| `LLM_API_KEY` | Optional fallback key for the Spirare provider. A key saved in **Settings > LLM** takes precedence. |
| `EMBEDDING_API_KEY` | Optional fallback embedding key for Spirare. Defaults to `LLM_API_KEY`. |
| `GCS_BUCKET`, `GCS_DB_PATH` | Leave `GCS_BUCKET` empty for local development |
| `SEED_*_LOGIN_ID` / `SEED_*_PASSWORD` | Login ID and password for the three users created on first start |

Models, URLs and API keys are **not** required in the environment. An Admin sets them for each provider under **Settings > LLM** after logging in. Spirare starts with `gpt-4o-mini` at `https://api.openai.com/v1`.

### 2. Run the backend

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

On first start the backend creates `data/solutioncrafter.duckdb`. It also seeds the users, the SDD template, the Interface Specifications layout and the default settings. An existing database is upgraded in place: each project's SDD becomes its first document, and existing reference files are indexed for project search. Health check: <http://localhost:8000/api/health>. API docs: <http://localhost:8000/docs>.

### 3. Run the frontend

From the repository root (npm workspaces):

```bash
npm ci
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to `127.0.0.1:8000`.

### 4. Log in

Default seed accounts (unless you overrode them in `.env`):

| Role | Login ID | Password |
|---|---|---|
| Admin | admin | AdminPass123! |
| Write | writer | WritePass123! |
| Read | reader | ReadPass123! |

Login IDs are plain IDs, not emails: 3-64 letters or numbers, no spaces or special characters, and unique regardless of case (`Maya` and `maya` are the same ID). Sign-in is also case-insensitive. Databases seeded earlier with `admin@solutioncrafter.local`-style IDs are renamed to plain IDs on the next start. Users are seeded only on an empty database, so an existing database keeps its users (their old roles are migrated to Write or Read). Change these passwords in any shared environment.

### Alternative: Docker Compose

```bash
docker compose up --build
```

- Frontend: <http://localhost:8080>
- Backend: <http://localhost:8000>

Data is kept in the `sdddata` Docker volume. Compose reads `JWT_SECRET`, `LLM_API_KEY` and the other variables from your shell or `.env`.

### Tests and lint

```bash
# backend (from backend/)
ruff check app tests
pytest
pytest tests/test_flow.py            # single file

# frontend (from repo root)
npm test
npm run lint
npm run build
```

The backend tests use a temporary data directory and run with no LLM key set.

---

## Cloud deployment (Google Cloud Run)

The app deploys as two Cloud Run services:
- **`solutioncrafter-backend`:** the FastAPI container. It runs with `--max-instances 1` because DuckDB is a single-writer file database.
- **`solutioncrafter-frontend`:** nginx serving the SPA and proxying `/api/`.

Cloud Run's filesystem is ephemeral, so the DuckDB file is synced to **Cloud Storage**. On startup it is downloaded from `gs://$GCS_BUCKET/$GCS_DB_PATH`. It is uploaded after every write and again at shutdown.

### 1. One-time GCP setup

```bash
PROJECT=my-gcp-project
REGION=asia-southeast1
BUCKET=my-solutioncrafter-bucket

gcloud config set project $PROJECT
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com

# Bucket for DuckDB persistence
gcloud storage buckets create gs://$BUCKET --location=$REGION

# Secrets used by the backend
printf '%s' "sk-..."                    | gcloud secrets create LLM_API_KEY --data-file=-
printf '%s' "$(openssl rand -hex 32)"   | gcloud secrets create JWT_SECRET  --data-file=-

# The Cloud Run runtime service account (default compute SA unless you set another)
RUNTIME_SA="$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member="serviceAccount:$RUNTIME_SA" --role=roles/storage.objectAdmin
for s in LLM_API_KEY JWT_SECRET; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
done
```

Create a **deployer service account** for GitHub Actions and download a JSON key for it. Give it these roles:
- `roles/run.admin`
- `roles/artifactregistry.admin` (or `writer` if the repository already exists)
- `roles/iam.serviceAccountUser`

### 2. GitHub repository secrets

| Secret | Required | Description |
|---|---|---|
| `GCP_PROJECT_ID` | yes | GCP project ID |
| `GCP_SA_KEY` | yes | JSON key of the deployer service account |
| `GCS_BUCKET` | yes | Bucket for DuckDB persistence |
| `GCP_REGION` | no | Defaults to `asia-southeast1` |
| `GAR_REPO` | no | Artifact Registry repository. Defaults to `solutioncrafter` and is created if missing. |

### 3. Deploy

Push to `main`, or run the **cloud-run** workflow manually from the Actions tab. The workflow:
1. Creates the Artifact Registry repository if needed.
2. Builds and pushes `backend` and `frontend` images tagged with the commit SHA.
3. Deploys the backend with 4 GiB memory and max 1 instance. It sets `DATA_DIR`, `SDD_TEMPLATE_PATH`, `GCS_BUCKET` and `GCS_DB_PATH`, and mounts `LLM_API_KEY` and `JWT_SECRET` from Secret Manager.
4. Deploys the frontend with `BACKEND_URL` set to the backend's URL.

If `GCP_PROJECT_ID` or `GCP_SA_KEY` is missing, the deploy job is skipped. CI (`ci.yml`) still runs on every push.

### 4. Post-deploy checks

> **Note:** Two gaps in the current setup need attention before the deployed frontend can reach the backend:
>
> 1. **nginx upstream:** `frontend/nginx.conf` proxies to the hard-coded `http://backend:8000`. That host only resolves inside Docker Compose. The workflow passes `BACKEND_URL`, but nothing reads it yet. On Cloud Run, make the config use the variable instead. One way is to rename the file to `/etc/nginx/templates/default.conf.template` and use `proxy_pass ${BACKEND_URL};` with `proxy_set_header Host <backend-host>`. The official nginx image runs `envsubst` on templates when it starts.
> 2. **Access:** the deploy command doesn't pass `--allow-unauthenticated`. To make the frontend public, run:
>    ```bash
>    gcloud run services add-iam-policy-binding solutioncrafter-frontend \
>      --region $REGION --member=allUsers --role=roles/run.invoker
>    ```
>    The frontend also has to be able to call the backend. Either make the backend public the same way and rely on the app's JWT auth, or have nginx send an identity token.

Then:
1. Open the frontend URL (`gcloud run services describe solutioncrafter-frontend --region $REGION --format='value(status.url)'`).
2. Log in as Admin and **change the seeded passwords** in Settings.
3. Set the active model and API base URL.

### Manual deploy (without GitHub Actions)

```bash
IMAGE_BASE=$REGION-docker.pkg.dev/$PROJECT/solutioncrafter
gcloud artifacts repositories create solutioncrafter --repository-format docker --location $REGION
gcloud auth configure-docker $REGION-docker.pkg.dev

docker build --platform linux/amd64 -f backend/Dockerfile  -t $IMAGE_BASE/backend:latest  .
docker build --platform linux/amd64 -f frontend/Dockerfile -t $IMAGE_BASE/frontend:latest .
docker push $IMAGE_BASE/backend:latest && docker push $IMAGE_BASE/frontend:latest

gcloud run deploy solutioncrafter-backend --image $IMAGE_BASE/backend:latest --region $REGION \
  --memory 4Gi --max-instances 1 \
  --set-env-vars "DATA_DIR=/data,SDD_TEMPLATE_PATH=/app/specs/solution_design_document.md,GCS_BUCKET=$BUCKET,GCS_DB_PATH=duckdb/solutioncrafter.duckdb" \
  --set-secrets "LLM_API_KEY=LLM_API_KEY:latest,JWT_SECRET=JWT_SECRET:latest"

BACKEND_URL=$(gcloud run services describe solutioncrafter-backend --region $REGION --format='value(status.url)')
gcloud run deploy solutioncrafter-frontend --image $IMAGE_BASE/frontend:latest --region $REGION \
  --set-env-vars "BACKEND_URL=$BACKEND_URL"
```

### Operational notes
- **Single instance:** keep the backend at `--max-instances 1`. Several instances would each hold their own copy of the DuckDB file and overwrite each other's GCS uploads.
- **Reference and image files:** uploaded files are saved under `DATA_DIR/uploads/`. Their extracted text and chunks are stored in DuckDB, so generation and chat keep working even if the originals are lost when a Cloud Run instance restarts.
- **Backups:** turn on Object Versioning on the bucket so earlier database snapshots can be restored: `gcloud storage buckets update gs://$BUCKET --versioning`.
