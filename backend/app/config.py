import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", str(ROOT / "data")))


def template_path() -> Path:
    configured = os.environ.get("SDD_TEMPLATE_PATH")
    if configured:
        return Path(configured)
    return ROOT / "specs" / "solution_design_document.md"


def jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "dev-only-change-me")


def settings_encryption_key() -> str:
    """Secret used to encrypt provider API keys stored in the database."""
    configured = os.environ.get("SETTINGS_ENCRYPTION_KEY")
    if configured:
        return configured
    return f"solutioncrafter-settings:{jwt_secret()}"


def llm_api_key() -> str:
    return os.environ.get("LLM_API_KEY", "")


def embedding_api_key() -> str:
    return os.environ.get("EMBEDDING_API_KEY") or llm_api_key()


DEFAULT_USERS = [
    {
        "user_id": "user-admin",
        "username": "Admin",
        "login_id_env": "SEED_ADMIN_LOGIN_ID",
        "login_id": "admin",
        "password_env": "SEED_ADMIN_PASSWORD",
        "password": "AdminPass123!",
        "role": "Admin",
    },
    {
        "user_id": "user-write",
        "username": "Writer",
        "login_id_env": "SEED_WRITE_LOGIN_ID",
        "login_id": "writer",
        "password_env": "SEED_WRITE_PASSWORD",
        "password": "WritePass123!",
        "role": "Write",
    },
    {
        "user_id": "user-read",
        "username": "Reader",
        "login_id_env": "SEED_READ_LOGIN_ID",
        "login_id": "reader",
        "password_env": "SEED_READ_PASSWORD",
        "password": "ReadPass123!",
        "role": "Read",
    },
]

CONTENT_AUTHORS = {"Write"}
GLOBAL_PROMPT = (
    "You are a senior enterprise solution architect covering IT system solutioning and architecture: "
    "integration and interfaces, data and databases, security, resiliency, deployment, performance and "
    "non-functional requirements. "
    "Use general IT and architecture knowledge to explain, advise and compare options. "
    "When the topic is specific to this organisation's systems, interfaces, capabilities, table definitions, "
    "screens, batches, reports or guidelines, base the answer on the knowledge base inventory and on the "
    "project documents and references when they are provided. If the inventory does not cover it, say so and "
    "do not invent system names, volumes or numbers. "
    "Be concise and practical, and state any assumptions."
)
# The default before the prompt became format-neutral. Stored prompts equal to this are upgraded on start-up.
LEGACY_GLOBAL_PROMPT = (
    "You are an enterprise solution architect. Produce factual Solution Design Document "
    "content grounded only in the supplied baseline documents and knowledge-base inventory. "
    "If information is missing, return empty strings rather than inventing numbers, volumes, "
    "or system names. Respond with JSON only."
)
# Section generation parses JSON and must stay grounded, so the app adds these rules itself.
GENERATION_RULES = (
    "Facts, numbers, volumes, system names and interface names must come from the supplied project references and "
    "knowledge-base inventory. Never invent them: leave a table cell empty or write 'To be confirmed' instead. "
    "Descriptive prose is still expected. When the references are thin, write a short, useful draft from the project "
    "name and description, the section prompt and any additional instruction rather than returning nothing. "
    "Respond with JSON only."
)
DIAGRAM_RULES = (
    "Write diagrams using only syntax the editor can draw. "
    "Flowchart: first line `flowchart LR` (or `TB`); nodes `id[\"Label\"]`, `id(\"Label\")` or `id{\"Label\"}` with the label always in double quotes (it may then contain brackets or commas); arrows `A --> B` or "
    "`A -->|label| B`; no subgraphs, styles, classes or other arrow types. "
    "Sequence diagram: first line `sequenceDiagram`; `actor X as Label` or `participant X as Label`; messages `A->>B: text` and "
    "`B-->>A: text`; no notes, loops, alt blocks, activations or autonumber."
)
# Chat answers are read by people, so the format rule differs from generation.
CHAT_RULES = (
    "Answer the question directly in plain conversational text (Markdown is fine). "
    "Do not reply with JSON or code fences. "
    "For general IT solutioning and architecture questions, answer from your general knowledge. "
    "For questions about specific systems (with their upstream and downstream systems), interfaces (by channel, "
    "country, protocol, source and destination), capabilities, tables, screens, batches, reports or guidelines, "
    "rely on the KNOWLEDGE BASE sections and the project context provided: use every relevant entry, name the "
    "system codes and interfaces you rely on, and say briefly when they do not contain the answer. "
    "Decline questions that are not about IT solutioning or architecture."
)


def load_dotenv() -> None:
    for candidate in (Path.cwd() / ".env", ROOT / ".env"):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())
        break
