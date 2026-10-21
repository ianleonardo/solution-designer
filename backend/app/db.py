import json
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

import bcrypt
import duckdb

from app.config import DEFAULT_USERS, GLOBAL_PROMPT, LEGACY_GLOBAL_PROMPT, db_path, template_path
from app.permissions import LEGACY_ROLES, PREDEFINED_ROLES
from app.seed_layouts import (
    FMEA_LAYOUT_DESCRIPTION,
    FMEA_LAYOUT_ID,
    FMEA_LAYOUT_NAME,
    FMEA_SECTIONS,
    INTERFACE_LAYOUT_DESCRIPTION,
    INTERFACE_LAYOUT_ID,
    INTERFACE_LAYOUT_NAME,
    INTERFACE_SECTIONS,
    SDD_LAYOUT_ID,
    SDD_LAYOUT_NAME,
)
from app.template_parser import parse_template, slugify

_lock = threading.RLock()
_conn: duckdb.DuckDBPyConnection | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def reset() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None


def init() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            return
        path = db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(str(path))
        _migrate()
        _ensure_project_description()
        _ensure_columns()
        _seed()


def _require() -> duckdb.DuckDBPyConnection:
    init()
    assert _conn is not None
    return _conn


def exec_sql(sql: str, params: list | None = None) -> None:
    with _lock:
        _require().execute(sql, params or [])


def fetchall(sql: str, params: list | None = None) -> list[dict]:
    with _lock:
        cursor = _require().execute(sql, params or [])
        columns = [item[0] for item in cursor.description]
        return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]


def fetchone(sql: str, params: list | None = None) -> dict | None:
    rows = fetchall(sql, params)
    return rows[0] if rows else None


@contextmanager
def transaction():
    """All statements inside run as one: either every change is kept or none is."""
    with _lock:
        _require().execute("BEGIN TRANSACTION")
        try:
            yield
        except BaseException:
            _require().execute("ROLLBACK")
            raise
        _require().execute("COMMIT")


# A project may hold several documents of one layout when the layout allows it, so there is no
# UNIQUE (project_id, layout_id). `title` names a copy; empty means "use the layout name".
PROJECT_DOCUMENTS_DDL = """
        CREATE TABLE IF NOT EXISTS {table} (
            document_id VARCHAR PRIMARY KEY,
            project_id VARCHAR NOT NULL,
            layout_id VARCHAR NOT NULL,
            title VARCHAR NOT NULL DEFAULT '',
            content_json VARCHAR NOT NULL,
            status VARCHAR NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            generated_at TIMESTAMP,
            submitted_by VARCHAR,
            approved_by VARCHAR,
            approved_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL,
            structure_json VARCHAR
        )
"""


def _rebuild_project_documents_without_unique() -> None:
    """Older databases have UNIQUE (project_id, layout_id); DuckDB cannot drop it in place, so copy the table."""
    assert _conn is not None
    unique = _conn.execute(
        "SELECT count(*) FROM duckdb_constraints() WHERE table_name = 'project_documents' AND constraint_type = 'UNIQUE'"
    ).fetchone()[0]
    if not unique:
        return
    columns = [
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'project_documents' ORDER BY ordinal_position"
        ).fetchall()
    ]
    column_list = ", ".join(columns)
    _conn.execute("BEGIN TRANSACTION")
    try:
        _conn.execute("DROP TABLE IF EXISTS project_documents_rebuild")
        _conn.execute(PROJECT_DOCUMENTS_DDL.format(table="project_documents_rebuild"))
        _conn.execute(f"INSERT INTO project_documents_rebuild ({column_list}) SELECT {column_list} FROM project_documents")
        _conn.execute("DROP TABLE project_documents")
        _conn.execute("ALTER TABLE project_documents_rebuild RENAME TO project_documents")
        _conn.execute("COMMIT")
    except Exception:
        _conn.execute("ROLLBACK")
        raise


def _migrate() -> None:
    statements = [
        """
        CREATE TABLE IF NOT EXISTS roles (
            role_id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            description VARCHAR NOT NULL DEFAULT '',
            projects VARCHAR NOT NULL DEFAULT 'none',
            knowledge VARCHAR NOT NULL DEFAULT 'none',
            settings VARCHAR NOT NULL DEFAULT 'none',
            is_system BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id VARCHAR PRIMARY KEY,
            username VARCHAR NOT NULL,
            email VARCHAR UNIQUE NOT NULL,
            password_hash VARCHAR NOT NULL,
            role_name VARCHAR NOT NULL,
            created_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS projects (
            project_id VARCHAR PRIMARY KEY,
            project_name VARCHAR NOT NULL,
            description VARCHAR NOT NULL DEFAULT '',
            countries VARCHAR NOT NULL DEFAULT '',
            systems VARCHAR NOT NULL DEFAULT '',
            owner_id VARCHAR NOT NULL,
            status VARCHAR NOT NULL,
            created_at TIMESTAMP NOT NULL,
            last_modified TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS layout_templates (
            template_id VARCHAR PRIMARY KEY,
            parent_id VARCHAR,
            section_name VARCHAR NOT NULL,
            sequence_order INTEGER NOT NULL,
            system_prompt VARCHAR NOT NULL,
            temperature DOUBLE NOT NULL,
            max_words INTEGER NOT NULL,
            content_kind VARCHAR NOT NULL,
            schema_json VARCHAR NOT NULL,
            hint VARCHAR
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS generated_sdds (
            sdd_id VARCHAR PRIMARY KEY,
            project_id VARCHAR UNIQUE NOT NULL,
            content_json VARCHAR NOT NULL,
            status VARCHAR NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            generated_at TIMESTAMP,
            submitted_by VARCHAR,
            approved_by VARCHAR,
            approved_at TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS document_layouts (
            layout_id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            description VARCHAR NOT NULL DEFAULT '',
            is_system BOOLEAN NOT NULL DEFAULT FALSE,
            allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """,
        PROJECT_DOCUMENTS_DDL.format(table="project_documents"),
        """
        CREATE TABLE IF NOT EXISTS rag_inventory (
            rag_id VARCHAR PRIMARY KEY,
            inventory_type VARCHAR NOT NULL,
            system_name VARCHAR,
            source_name VARCHAR,
            raw_content VARCHAR,
            parsed_json VARCHAR,
            embedding FLOAT[],
            created_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS systems (
            system_code VARCHAR PRIMARY KEY,
            system_name VARCHAR NOT NULL,
            description VARCHAR NOT NULL DEFAULT '',
            upstreams VARCHAR NOT NULL DEFAULT '',
            downstreams VARCHAR NOT NULL DEFAULT '',
            has_batch BOOLEAN NOT NULL DEFAULT FALSE,
            has_report BOOLEAN NOT NULL DEFAULT FALSE,
            has_capability BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            embedding FLOAT[]
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS interfaces (
            interface_id VARCHAR PRIMARY KEY,
            channel VARCHAR NOT NULL,
            country VARCHAR NOT NULL,
            interface_name VARCHAR NOT NULL,
            endpoint VARCHAR NOT NULL DEFAULT '',
            description VARCHAR NOT NULL DEFAULT '',
            protocol VARCHAR NOT NULL,
            source VARCHAR NOT NULL,
            destination VARCHAR NOT NULL,
            created_at TIMESTAMP NOT NULL,
            embedding FLOAT[]
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS guidelines (
            guideline_id VARCHAR PRIMARY KEY,
            title VARCHAR NOT NULL,
            description VARCHAR NOT NULL DEFAULT '',
            file_name VARCHAR NOT NULL DEFAULT '',
            file_type VARCHAR NOT NULL DEFAULT '',
            storage_path VARCHAR NOT NULL DEFAULT '',
            extracted_text VARCHAR NOT NULL DEFAULT '',
            embedding_model VARCHAR NOT NULL DEFAULT '',
            chunk_count INTEGER NOT NULL DEFAULT 0,
            embedded_count INTEGER NOT NULL DEFAULT 0,
            created_by VARCHAR NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            indexed_at TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS guideline_chunks (
            chunk_id VARCHAR PRIMARY KEY,
            guideline_id VARCHAR NOT NULL,
            chunk_index INTEGER NOT NULL,
            content VARCHAR NOT NULL,
            embedding FLOAT[]
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS baseline_docs (
            doc_id VARCHAR PRIMARY KEY,
            project_id VARCHAR NOT NULL,
            file_name VARCHAR NOT NULL,
            file_type VARCHAR NOT NULL,
            uploaded_by VARCHAR NOT NULL,
            storage_path VARCHAR NOT NULL,
            extracted_text VARCHAR,
            uploaded_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS project_rag_chunks (
            chunk_id VARCHAR PRIMARY KEY,
            project_id VARCHAR NOT NULL,
            doc_id VARCHAR NOT NULL,
            chunk_index INTEGER NOT NULL,
            content VARCHAR NOT NULL,
            embedding FLOAT[],
            created_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            settings_id VARCHAR PRIMARY KEY,
            active_model VARCHAR NOT NULL,
            api_base_url VARCHAR NOT NULL,
            global_system_prompt VARCHAR NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS llm_providers (
            provider VARCHAR PRIMARY KEY,
            label VARCHAR NOT NULL,
            chat_model VARCHAR NOT NULL DEFAULT '',
            chat_base_url VARCHAR NOT NULL DEFAULT '',
            embedding_model VARCHAR NOT NULL DEFAULT '',
            embedding_base_url VARCHAR NOT NULL DEFAULT '',
            api_key_enc VARCHAR NOT NULL DEFAULT '',
            embedding_api_key_enc VARCHAR NOT NULL DEFAULT '',
            verify_ssl BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_tables (
            table_id VARCHAR PRIMARY KEY,
            country VARCHAR NOT NULL,
            database_name VARCHAR NOT NULL,
            schema_name VARCHAR NOT NULL,
            table_name VARCHAR NOT NULL,
            description VARCHAR NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            embedding FLOAT[],
            UNIQUE (country, database_name, schema_name, table_name)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_table_columns (
            column_id VARCHAR PRIMARY KEY,
            table_id VARCHAR NOT NULL,
            column_name VARCHAR NOT NULL,
            data_type VARCHAR NOT NULL,
            is_null VARCHAR NOT NULL DEFAULT 'N',
            primary_key VARCHAR NOT NULL DEFAULT '',
            foreign_key VARCHAR NOT NULL DEFAULT '',
            description VARCHAR NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            UNIQUE (table_id, column_name)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_reports (
            report_id VARCHAR PRIMARY KEY,
            country VARCHAR NOT NULL,
            system_code VARCHAR NOT NULL,
            report_code VARCHAR NOT NULL DEFAULT '',
            report_name VARCHAR NOT NULL,
            frequency VARCHAR NOT NULL DEFAULT '',
            frequency_other VARCHAR NOT NULL DEFAULT '',
            description VARCHAR NOT NULL DEFAULT '',
            layout VARCHAR NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            embedding FLOAT[],
            UNIQUE (country, system_code, report_name)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_batches (
            batch_id VARCHAR PRIMARY KEY,
            country VARCHAR NOT NULL,
            system_code VARCHAR NOT NULL,
            batch_name VARCHAR NOT NULL,
            batch_type VARCHAR NOT NULL,
            frequency VARCHAR NOT NULL DEFAULT '',
            frequency_other VARCHAR NOT NULL DEFAULT '',
            to_from_systems VARCHAR NOT NULL DEFAULT '',
            description VARCHAR NOT NULL DEFAULT '',
            batch_filename VARCHAR NOT NULL DEFAULT '',
            file_layout VARCHAR NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            embedding FLOAT[],
            UNIQUE (country, system_code, batch_name)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_capabilities (
            capability_id VARCHAR PRIMARY KEY,
            country VARCHAR NOT NULL,
            system_code VARCHAR NOT NULL,
            l1_capability VARCHAR NOT NULL,
            l2_capability VARCHAR NOT NULL,
            l3_capability VARCHAR NOT NULL,
            description VARCHAR NOT NULL DEFAULT '',
            sequence_diagrams VARCHAR NOT NULL DEFAULT '[]',
            processing_rules VARCHAR NOT NULL DEFAULT '',
            country_behavior VARCHAR NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            embedding FLOAT[],
            UNIQUE (country, system_code, l1_capability, l2_capability, l3_capability)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_bitbucket_repos (
            repo_id VARCHAR PRIMARY KEY,
            bitbucket_project VARCHAR NOT NULL,
            repo_name VARCHAR NOT NULL,
            description VARCHAR NOT NULL DEFAULT '',
            main_components VARCHAR NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            embedding FLOAT[],
            UNIQUE (bitbucket_project, repo_name)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_capability_interfaces (
            capability_id VARCHAR NOT NULL,
            interface_id VARCHAR NOT NULL,
            PRIMARY KEY (capability_id, interface_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_capability_tables (
            capability_id VARCHAR NOT NULL,
            table_id VARCHAR NOT NULL,
            PRIMARY KEY (capability_id, table_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_capability_batches (
            capability_id VARCHAR NOT NULL,
            batch_id VARCHAR NOT NULL,
            PRIMARY KEY (capability_id, batch_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS kb_capability_reports (
            capability_id VARCHAR NOT NULL,
            report_id VARCHAR NOT NULL,
            PRIMARY KEY (capability_id, report_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            audit_id VARCHAR PRIMARY KEY,
            occurred_at TIMESTAMP NOT NULL,
            user_id VARCHAR,
            username VARCHAR,
            login_id VARCHAR,
            role_name VARCHAR,
            action VARCHAR NOT NULL,
            method VARCHAR,
            path VARCHAR,
            entity_type VARCHAR,
            entity_id VARCHAR,
            summary VARCHAR NOT NULL,
            detail VARCHAR,
            ip_address VARCHAR
        )
        """,
    ]
    assert _conn is not None
    for statement in statements:
        _conn.execute(statement)


def _ensure_project_description() -> None:
    assert _conn is not None
    columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'projects'"
        ).fetchall()
    }
    if "description" not in columns:
        _conn.execute("ALTER TABLE projects ADD COLUMN description VARCHAR DEFAULT ''")
    # Project scope: comma lists of country and system codes; empty means every country / system.
    for name in ("countries", "systems"):
        if name not in columns:
            _conn.execute(f"ALTER TABLE projects ADD COLUMN {name} VARCHAR DEFAULT ''")
            _conn.execute(f"UPDATE projects SET {name} = '' WHERE {name} IS NULL")


def _ensure_columns() -> None:
    assert _conn is not None
    columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'app_settings'"
        ).fetchall()
    }
    template_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'layout_templates'"
        ).fetchall()
    }
    if "layout_id" not in template_columns:
        _conn.execute("ALTER TABLE layout_templates ADD COLUMN layout_id VARCHAR DEFAULT 'sdd'")
    _conn.execute("UPDATE layout_templates SET layout_id = 'sdd' WHERE layout_id IS NULL")
    document_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'project_documents'"
        ).fetchall()
    }
    if "structure_json" not in document_columns:
        _conn.execute("ALTER TABLE project_documents ADD COLUMN structure_json VARCHAR")
    _rebuild_project_documents_without_unique()
    document_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'project_documents'"
        ).fetchall()
    }
    if "title" not in document_columns:
        _conn.execute("ALTER TABLE project_documents ADD COLUMN title VARCHAR DEFAULT ''")
        _conn.execute("UPDATE project_documents SET title = '' WHERE title IS NULL")
    layout_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'document_layouts'"
        ).fetchall()
    }
    if "allow_multiple" not in layout_columns:
        _conn.execute("ALTER TABLE document_layouts ADD COLUMN allow_multiple BOOLEAN DEFAULT FALSE")
        _conn.execute("UPDATE document_layouts SET allow_multiple = FALSE WHERE allow_multiple IS NULL")
        # seeded default: a project can hold several Interface Specifications documents
        _conn.execute("UPDATE document_layouts SET allow_multiple = TRUE WHERE layout_id = ?", [INTERFACE_LAYOUT_ID])
    for table in ("systems", "interfaces"):
        present = {
            row[0]
            for row in _conn.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'").fetchall()
        }
        if "embedding" not in present:
            _conn.execute(f"ALTER TABLE {table} ADD COLUMN embedding FLOAT[]")
    system_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'systems'"
        ).fetchall()
    }
    if "has_batch" not in system_columns:
        _conn.execute("ALTER TABLE systems ADD COLUMN has_batch BOOLEAN DEFAULT FALSE")
        _conn.execute("UPDATE systems SET has_batch = FALSE WHERE has_batch IS NULL")
    if "has_report" not in system_columns:
        _conn.execute("ALTER TABLE systems ADD COLUMN has_report BOOLEAN DEFAULT FALSE")
        _conn.execute("UPDATE systems SET has_report = FALSE WHERE has_report IS NULL")
    if "has_capability" not in system_columns:
        _conn.execute("ALTER TABLE systems ADD COLUMN has_capability BOOLEAN DEFAULT FALSE")
        _conn.execute("UPDATE systems SET has_capability = FALSE WHERE has_capability IS NULL")
    user_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
        ).fetchall()
    }
    if "auth_provider" not in user_columns:
        _conn.execute("ALTER TABLE users ADD COLUMN auth_provider VARCHAR DEFAULT 'local'")
        _conn.execute("UPDATE users SET auth_provider = 'local' WHERE auth_provider IS NULL")
    batch_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'kb_batches'"
        ).fetchall()
    }
    if "to_from_systems" not in batch_columns:
        _conn.execute("ALTER TABLE kb_batches ADD COLUMN to_from_systems VARCHAR DEFAULT ''")
        _conn.execute("UPDATE kb_batches SET to_from_systems = '' WHERE to_from_systems IS NULL")
    for table in ("kb_batches", "kb_reports"):
        present = {
            row[0]
            for row in _conn.execute(
                f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'"
            ).fetchall()
        }
        if "frequency" not in present:
            _conn.execute(f"ALTER TABLE {table} ADD COLUMN frequency VARCHAR DEFAULT ''")
            _conn.execute(f"UPDATE {table} SET frequency = '' WHERE frequency IS NULL")
        if "frequency_other" not in present:
            _conn.execute(f"ALTER TABLE {table} ADD COLUMN frequency_other VARCHAR DEFAULT ''")
            _conn.execute(f"UPDATE {table} SET frequency_other = '' WHERE frequency_other IS NULL")
    report_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'kb_reports'"
        ).fetchall()
    }
    if "report_code" not in report_columns:
        _conn.execute("ALTER TABLE kb_reports ADD COLUMN report_code VARCHAR DEFAULT ''")
        _conn.execute("UPDATE kb_reports SET report_code = '' WHERE report_code IS NULL")
    capability_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'kb_capabilities'"
        ).fetchall()
    }
    if "sequence_diagrams" not in capability_columns:
        _conn.execute("ALTER TABLE kb_capabilities ADD COLUMN sequence_diagrams VARCHAR DEFAULT '[]'")
        _conn.execute("UPDATE kb_capabilities SET sequence_diagrams = '[]' WHERE sequence_diagrams IS NULL OR sequence_diagrams = ''")
    interface_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'interfaces'"
        ).fetchall()
    }
    if "endpoint" not in interface_columns:
        _conn.execute("ALTER TABLE interfaces ADD COLUMN endpoint VARCHAR DEFAULT ''")
        _conn.execute("UPDATE interfaces SET endpoint = '' WHERE endpoint IS NULL")
    if "indexed_embedding_signature" not in columns:
        _conn.execute("ALTER TABLE app_settings ADD COLUMN indexed_embedding_signature VARCHAR DEFAULT ''")
        _conn.execute("UPDATE app_settings SET indexed_embedding_signature = '' WHERE indexed_embedding_signature IS NULL")
    if "active_provider" not in columns:
        _conn.execute("ALTER TABLE app_settings ADD COLUMN active_provider VARCHAR DEFAULT 'spirare'")
        _conn.execute("UPDATE app_settings SET active_provider = 'spirare' WHERE active_provider IS NULL")
    provider_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'llm_providers'"
        ).fetchall()
    }
    if "verify_ssl" not in provider_columns:
        _conn.execute("ALTER TABLE llm_providers ADD COLUMN verify_ssl BOOLEAN DEFAULT TRUE")
        _conn.execute("UPDATE llm_providers SET verify_ssl = TRUE WHERE verify_ssl IS NULL")
    capability_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'kb_capabilities'"
        ).fetchall()
    }
    if "country_behavior" not in capability_columns:
        _conn.execute("ALTER TABLE kb_capabilities ADD COLUMN country_behavior VARCHAR DEFAULT ''")
        _conn.execute("UPDATE kb_capabilities SET country_behavior = '' WHERE country_behavior IS NULL")
    repo_columns = {
        row[0]
        for row in _conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'kb_bitbucket_repos'"
        ).fetchall()
    }
    # Repositories belong to a Bitbucket project, not a system. Rebuild so the unique key can change.
    if "system_code" in repo_columns:
        _conn.execute(
            """
            CREATE TABLE kb_bitbucket_repos_v2 (
                repo_id VARCHAR PRIMARY KEY,
                bitbucket_project VARCHAR NOT NULL,
                repo_name VARCHAR NOT NULL,
                description VARCHAR NOT NULL DEFAULT '',
                main_components VARCHAR NOT NULL DEFAULT '',
                created_at TIMESTAMP NOT NULL,
                last_modified TIMESTAMP NOT NULL,
                embedding FLOAT[],
                UNIQUE (bitbucket_project, repo_name)
            )
            """
        )
        _conn.execute(
            """
            INSERT INTO kb_bitbucket_repos_v2
            SELECT repo_id, bitbucket_project, repo_name, description, main_components, created_at, last_modified, embedding
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY bitbucket_project, repo_name ORDER BY last_modified DESC, repo_id
                ) AS rn
                FROM kb_bitbucket_repos
            )
            WHERE rn = 1
            """
        )
        _conn.execute("DROP TABLE kb_bitbucket_repos")
        _conn.execute("ALTER TABLE kb_bitbucket_repos_v2 RENAME TO kb_bitbucket_repos")


def _seed_llm_providers() -> None:
    defaults = [
        # provider, label, chat model, chat url, embedding model, embedding url
        ("gemini", "Gemini", "gemini-2.5-flash", "", "gemini-embedding-001", ""),
        ("anthropic", "Anthropic", "claude-sonnet-4-5", "https://api.anthropic.com", "", ""),
        (
            "spirare",
            "Spirare",
            "default",
            "https://s-egp.sg.uobnet.com/nlp/v1/chat/completions",
            "/data/genai/models/bge-m3",
            "https://s-egp.sg.uobnet.com/embedding/v1/embeddings",
        ),
    ]
    for provider, label, chat_model, chat_url, embedding_model, embedding_url in defaults:
        if fetchone("SELECT provider FROM llm_providers WHERE provider = ?", [provider]) is None:
            exec_sql(
                """
                INSERT INTO llm_providers (
                    provider, label, chat_model, chat_base_url, embedding_model, embedding_base_url, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [provider, label, chat_model, chat_url, embedding_model, embedding_url, _now()],
            )
    # Replace the old OpenAI placeholder on Spirare. A custom URL or model is left as saved.
    exec_sql(
        """
        UPDATE llm_providers
        SET chat_model = 'default',
            chat_base_url = 'https://is-egp.sg.uobnet.com/wip/v1/chat/completions',
            embedding_model = '/data/genai/models/bge-m3',
            embedding_base_url = 'https://is-egp.sg.uobnet.com/embedding/v1/embeddings'
        WHERE provider = 'spirare'
          AND chat_base_url IN ('', 'https://api.openai.com/v1')
          AND chat_model IN ('', 'gpt-4o-mini')
          AND embedding_model IN ('', 'text-embedding-3-small')
        """
    )


def _ensure_layout(layout_id: str, name: str, description: str, allow_multiple: bool = False) -> bool:
    """Create a system layout row if missing. Returns True when it was created."""
    if fetchone("SELECT layout_id FROM document_layouts WHERE layout_id = ?", [layout_id]):
        return False
    exec_sql(
        """
        INSERT INTO document_layouts (layout_id, name, description, is_system, allow_multiple, created_at, updated_at)
        VALUES (?, ?, ?, TRUE, ?, ?, ?)
        """,
        [layout_id, name, description, allow_multiple, _now(), _now()],
    )
    return True


def kind_from_blocks(blocks: list[dict]) -> str:
    kinds = {block.get("type") for block in blocks if block.get("type") not in {"header", "image"}}
    if len(kinds) == 1:
        return next(iter(kinds))
    return "mixed"


def insert_template(layout_id: str, row: dict) -> None:
    exec_sql(
        """
        INSERT INTO layout_templates (
            template_id, parent_id, section_name, sequence_order, system_prompt,
            temperature, max_words, content_kind, schema_json, hint, layout_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            row["template_id"],
            row["parent_id"],
            row["section_name"],
            row["sequence_order"],
            row["system_prompt"],
            row["temperature"],
            row["max_words"],
            row["content_kind"],
            json.dumps(row["schema_json"]),
            row.get("hint") or "",
            layout_id,
        ],
    )


def default_section_prompt(document_name: str, name: str, hint: str) -> str:
    prompt = f"Write the '{name}' section of the {document_name}."
    if hint:
        prompt += f" Guidance: {hint}"
    prompt += (
        " Use only the project references and knowledge-base inventory context. "
        "If a value is unknown, use an empty string. Return JSON with a blocks array matching the schema."
    )
    return prompt


def _seed_code_layout(layout_id: str, name: str, description: str, sections: list[dict], allow_multiple: bool = False) -> None:
    """Seed a built-in layout defined in seed_layouts.py (only when the layout does not exist yet)."""
    if not _ensure_layout(layout_id, name, description, allow_multiple):
        return
    used: set[str] = set()

    def template_id(section_name: str) -> str:
        base = f"{layout_id}--{slugify(section_name)}"
        candidate, counter = base, 2
        while candidate in used:
            candidate = f"{base}-{counter}"
            counter += 1
        used.add(candidate)
        return candidate

    def add(section: dict, parent_id: str | None, sequence: int) -> str:
        identifier = template_id(section["name"])
        insert_template(
            layout_id,
            {
                "template_id": identifier,
                "parent_id": parent_id,
                "section_name": section["name"],
                "sequence_order": sequence,
                "system_prompt": default_section_prompt(name, section["name"], section["hint"]),
                "temperature": 0.2,
                "max_words": 2000,
                "content_kind": kind_from_blocks(section["blocks"]),
                "schema_json": {"blocks": section["blocks"]},
                "hint": section["hint"],
            },
        )
        return identifier

    for index, section in enumerate(sections, start=1):
        parent = add(section, None, index * 100)
        for child_index, child in enumerate(section["children"], start=1):
            add(child, parent, index * 100 + child_index)


def _seed_interface_layout() -> None:
    _seed_code_layout(INTERFACE_LAYOUT_ID, INTERFACE_LAYOUT_NAME, INTERFACE_LAYOUT_DESCRIPTION, INTERFACE_SECTIONS, allow_multiple=True)


def _seed_fmea_layout() -> None:
    _seed_code_layout(FMEA_LAYOUT_ID, FMEA_LAYOUT_NAME, FMEA_LAYOUT_DESCRIPTION, FMEA_SECTIONS)


def _migrate_documents() -> None:
    """Move legacy generated_sdds rows into project_documents (once; the source rows are consumed)."""
    exec_sql(
        """
        INSERT INTO project_documents (
            document_id, project_id, layout_id, content_json, status, last_modified, generated_at,
            submitted_by, approved_by, approved_at, created_at
        )
        SELECT g.sdd_id, g.project_id, 'sdd', g.content_json, g.status, g.last_modified, g.generated_at,
               g.submitted_by, g.approved_by, g.approved_at, p.created_at
        FROM generated_sdds g JOIN projects p ON p.project_id = g.project_id
        WHERE NOT EXISTS (
            SELECT 1 FROM project_documents d WHERE d.project_id = g.project_id AND d.layout_id = 'sdd'
        )
        """
    )
    exec_sql("DELETE FROM generated_sdds")


def layout_snapshot(layout_id: str) -> list[dict]:
    """A copy of a layout's sections, ordered. Documents keep this copy so later layout edits do not reach them."""
    rows = fetchall("SELECT * FROM layout_templates WHERE layout_id = ? ORDER BY sequence_order", [layout_id])
    return [_template_row(row) for row in rows]


def _backfill_structures() -> None:
    """Give documents created before snapshots existed a copy of their layout as it is now."""
    for row in fetchall("SELECT document_id, layout_id FROM project_documents WHERE structure_json IS NULL"):
        exec_sql(
            "UPDATE project_documents SET structure_json = ? WHERE document_id = ?",
            [json.dumps(layout_snapshot(row["layout_id"])), row["document_id"]],
        )


def _is_redundant_intro_header(block: dict) -> bool:
    """The header block the Interface and FMEA layouts once put in Introduction; the section title already says it."""
    return block.get("type") == "header" and str(block.get("text") or "").strip().lower() in {"", "introduction"}


def _drop_intro_header_blocks() -> None:
    """Remove that header block (and its Large/Medium/Small size picker) from the layouts and their documents."""
    for layout_id in (INTERFACE_LAYOUT_ID, FMEA_LAYOUT_ID):
        template_id = f"{layout_id}--introduction"
        row = fetchone("SELECT schema_json FROM layout_templates WHERE template_id = ?", [template_id])
        if row is not None:
            schema = json.loads(row["schema_json"]) if isinstance(row["schema_json"], str) else row["schema_json"]
            blocks = (schema or {}).get("blocks") or []
            kept = [block for block in blocks if not _is_redundant_intro_header(block)]
            if len(kept) != len(blocks):
                exec_sql(
                    "UPDATE layout_templates SET schema_json = ?, content_kind = ? WHERE template_id = ?",
                    [json.dumps({**schema, "blocks": kept}), kind_from_blocks(kept), template_id],
                )
        for document in fetchall(
            "SELECT document_id, content_json, structure_json FROM project_documents WHERE layout_id = ?", [layout_id]
        ):
            content = json.loads(document["content_json"]) if document["content_json"] else None
            section = ((content or {}).get("sections") or {}).get(template_id)
            content_changed = False
            if section and any(_is_redundant_intro_header(block) for block in section.get("blocks") or []):
                section["blocks"] = [block for block in section["blocks"] if not _is_redundant_intro_header(block)]
                content_changed = True
            structure = json.loads(document["structure_json"]) if document.get("structure_json") else None
            structure_changed = False
            for entry in structure or []:
                if entry.get("template_id") != template_id:
                    continue
                schema = entry.get("schema_json") or {}
                blocks = schema.get("blocks") or []
                kept = [block for block in blocks if not _is_redundant_intro_header(block)]
                if len(kept) != len(blocks):
                    entry["schema_json"] = {**schema, "blocks": kept}
                    entry["content_kind"] = kind_from_blocks(kept)
                    structure_changed = True
            if content_changed:
                exec_sql("UPDATE project_documents SET content_json = ? WHERE document_id = ?", [json.dumps(content), document["document_id"]])
            if structure_changed:
                exec_sql("UPDATE project_documents SET structure_json = ? WHERE document_id = ?", [json.dumps(structure), document["document_id"]])


TEST_CASE_SECTION = "inventory-of-test-cases"
SPRINT_SECTIONS = ("sprint-1", "sprint-2")
OLD_TEST_CASE_COLUMNS = ["No", "App Name", "Action", "VAL ID"]


def _schema_dict(value) -> dict:
    if isinstance(value, str):
        return json.loads(value) if value else {}
    return value or {}


def _table_column_sets(schema: dict) -> list[list]:
    return [list(block.get("columns") or []) for block in (schema.get("blocks") or []) if block.get("type") == "table"]


def _test_case_inventory_is_old(schema: dict, section_ids: set[str]) -> bool:
    if section_ids & set(SPRINT_SECTIONS):
        return True
    return any(columns == OLD_TEST_CASE_COLUMNS for columns in _table_column_sets(schema))


def _migrate_test_case_inventory() -> None:
    """Replace the sprint tables with the single test-case inventory table, including its prompt."""
    fresh = next((item for item in parse_template(template_path()) if item["template_id"] == TEST_CASE_SECTION), None)
    if fresh is None:
        return
    row = fetchone(
        "SELECT schema_json FROM layout_templates WHERE template_id = ? AND layout_id = ?",
        [TEST_CASE_SECTION, SDD_LAYOUT_ID],
    )
    children = fetchall(
        "SELECT template_id FROM layout_templates WHERE parent_id = ? AND layout_id = ?",
        [TEST_CASE_SECTION, SDD_LAYOUT_ID],
    )
    child_ids = {item["template_id"] for item in children}
    if row is not None and _test_case_inventory_is_old(_schema_dict(row["schema_json"]), child_ids):
        exec_sql(
            """
            UPDATE layout_templates
            SET schema_json = ?, hint = ?, system_prompt = ?, content_kind = ?
            WHERE template_id = ? AND layout_id = ?
            """,
            [
                json.dumps(fresh["schema_json"]),
                fresh["hint"],
                fresh["system_prompt"],
                fresh["content_kind"],
                TEST_CASE_SECTION,
                SDD_LAYOUT_ID,
            ],
        )
        exec_sql(
            "DELETE FROM layout_templates WHERE template_id IN (?, ?) AND parent_id = ?",
            [*SPRINT_SECTIONS, TEST_CASE_SECTION],
        )
    from app.content import blocks_from_schema
    from app.missing import evaluate_missing

    blank_blocks = blocks_from_schema(fresh["schema_json"]["blocks"])
    for document in fetchall("SELECT document_id, content_json, structure_json FROM project_documents WHERE layout_id = ?", [SDD_LAYOUT_ID]):
        structure = json.loads(document["structure_json"]) if document.get("structure_json") else None
        if not isinstance(structure, list):
            continue
        ids = {entry.get("template_id") for entry in structure}
        parent = next((entry for entry in structure if entry.get("template_id") == TEST_CASE_SECTION), None)
        if parent is None or not _test_case_inventory_is_old(_schema_dict(parent.get("schema_json")), ids):
            continue
        kept = [entry for entry in structure if entry.get("template_id") not in SPRINT_SECTIONS]
        for entry in kept:
            if entry.get("template_id") != TEST_CASE_SECTION:
                continue
            entry["schema_json"] = fresh["schema_json"]
            entry["hint"] = fresh["hint"]
            entry["system_prompt"] = fresh["system_prompt"]
            entry["content_kind"] = fresh["content_kind"]
        content = json.loads(document["content_json"]) if document.get("content_json") else {"sections": {}}
        sections = content.setdefault("sections", {})
        for section_id in SPRINT_SECTIONS:
            sections.pop(section_id, None)
        section = sections.get(TEST_CASE_SECTION)
        if isinstance(section, dict):
            section["blocks"] = json.loads(json.dumps(blank_blocks))
        else:
            sections[TEST_CASE_SECTION] = {
                "template_id": TEST_CASE_SECTION,
                "title": fresh["section_name"],
                "blocks": json.loads(json.dumps(blank_blocks)),
                "missing": [],
            }
        content = evaluate_missing(content)
        exec_sql(
            "UPDATE project_documents SET content_json = ?, structure_json = ? WHERE document_id = ?",
            [json.dumps(content), json.dumps(kept), document["document_id"]],
        )


LONG_TEST_TYPE = "Test Type (Progression/Regression/Negative testing/Non-functional)"


def _rename_column_list(columns: list) -> tuple[list, bool]:
    if LONG_TEST_TYPE not in columns:
        return columns, False
    return ["Test Type" if item == LONG_TEST_TYPE else item for item in columns], True


def _rename_test_type_blocks(blocks: list) -> bool:
    changed = False
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "table":
            continue
        columns, renamed = _rename_column_list(list(block.get("columns") or []))
        if renamed:
            block["columns"] = columns
            changed = True
    return changed


def _rename_test_type_column() -> None:
    """Shorten the Test Type header. Cell values stay in place; the editor offers them as a dropdown."""
    row = fetchone(
        "SELECT schema_json FROM layout_templates WHERE template_id = ? AND layout_id = ?",
        [TEST_CASE_SECTION, SDD_LAYOUT_ID],
    )
    if row is not None:
        schema = _schema_dict(row["schema_json"])
        if _rename_test_type_blocks(schema.get("blocks") or []):
            exec_sql(
                "UPDATE layout_templates SET schema_json = ? WHERE template_id = ? AND layout_id = ?",
                [json.dumps(schema), TEST_CASE_SECTION, SDD_LAYOUT_ID],
            )
    for document in fetchall("SELECT document_id, content_json, structure_json FROM project_documents WHERE layout_id = ?", [SDD_LAYOUT_ID]):
        structure = json.loads(document["structure_json"]) if document.get("structure_json") else None
        content = json.loads(document["content_json"]) if document.get("content_json") else None
        structure_changed = False
        for entry in structure or []:
            schema = entry.get("schema_json") or {}
            if _rename_test_type_blocks(schema.get("blocks") or []):
                entry["schema_json"] = schema
                structure_changed = True
        content_changed = False
        if isinstance(content, dict):
            for section in (content.get("sections") or {}).values():
                if isinstance(section, dict) and _rename_test_type_blocks(section.get("blocks") or []):
                    content_changed = True
        if structure_changed or content_changed:
            exec_sql(
                "UPDATE project_documents SET content_json = ?, structure_json = ? WHERE document_id = ?",
                [
                    json.dumps(content) if content_changed and content is not None else document["content_json"],
                    json.dumps(structure) if structure_changed and structure is not None else document["structure_json"],
                    document["document_id"],
                ],
            )


# Tables that can be filled from the Knowledge Base, by section. Only set where a table has no `source` yet,
# so an admin who clears it in the layout editor keeps that choice.
KB_TABLE_SOURCES = {
    "inventory-of-capabilities": "capabilities",
    "interfaces-summary": "interfaces",
    "interfaces-details": "interfaces",
    "inventory-of-reports": "reports",
    "new-updated-tables": "tables",
    f"{INTERFACE_LAYOUT_ID}--interface-summary": "interfaces",
}


def _with_kb_source(schema: dict, source: str) -> dict | None:
    blocks = (schema or {}).get("blocks") or []
    first = next((block for block in blocks if block.get("type") == "table"), None)
    if first is None or "source" in first:
        return None
    first["source"] = source
    return schema


def _seed_kb_sources() -> None:
    for template_id, source in KB_TABLE_SOURCES.items():
        row = fetchone("SELECT schema_json FROM layout_templates WHERE template_id = ?", [template_id])
        if row is None:
            continue
        schema = json.loads(row["schema_json"]) if isinstance(row["schema_json"], str) else row["schema_json"]
        updated = _with_kb_source(schema, source)
        if updated is not None:
            exec_sql("UPDATE layout_templates SET schema_json = ? WHERE template_id = ?", [json.dumps(updated), template_id])
    for document in fetchall("SELECT document_id, structure_json FROM project_documents WHERE structure_json IS NOT NULL"):
        structure = json.loads(document["structure_json"])
        changed = False
        for entry in structure:
            source = KB_TABLE_SOURCES.get(entry.get("template_id"))
            if source and _with_kb_source(entry.get("schema_json") or {}, source) is not None:
                changed = True
        if changed:
            exec_sql("UPDATE project_documents SET structure_json = ? WHERE document_id = ?", [json.dumps(structure), document["document_id"]])


def _migrate_seed_login_ids() -> None:
    """Older databases seeded `admin@solutioncrafter.local`-style IDs; Login IDs are no longer emails."""
    for user in DEFAULT_USERS:
        row = fetchone("SELECT email FROM users WHERE user_id = ?", [user["user_id"]])
        if row is None or row["email"] != f"{user['login_id']}@solutioncrafter.local":
            continue
        if fetchone("SELECT 1 AS x FROM users WHERE lower(email) = ?", [user["login_id"]]) is None:
            exec_sql("UPDATE users SET email = ? WHERE user_id = ?", [user["login_id"], user["user_id"]])


def _seed_roles() -> None:
    """The predefined roles exist once; later edits to them are kept (Administrator cannot be edited)."""
    for role in PREDEFINED_ROLES:
        if fetchone("SELECT role_id FROM roles WHERE role_id = ?", [role["role_id"]]):
            continue
        exec_sql(
            """
            INSERT INTO roles (role_id, name, description, projects, knowledge, settings, is_system, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?)
            """,
            [role["role_id"], role["name"], role["description"], role["projects"], role["knowledge"], role["settings"], _now(), _now()],
        )


def _migrate_roles() -> None:
    """Users stored the old fixed role names (Admin, Analyst, Viewer ...); they now point at a role id."""
    for old, new in LEGACY_ROLES.items():
        exec_sql("UPDATE users SET role_name = ? WHERE role_name = ?", [new, old])


def _migrate_table_countries() -> None:
    """kb_tables used full country names; catalogs now use ISO-style codes."""
    mapping = {
        "Singapore": "SG",
        "Malaysia": "MY",
        "Thailand": "TH",
        "Indonesia": "ID",
        "Vietnam": "VN",
    }
    for old, new in mapping.items():
        exec_sql("UPDATE kb_tables SET country = ? WHERE country = ?", [new, old])
        exec_sql("UPDATE kb_reports SET country = ? WHERE country = ?", [new, old])
        exec_sql("UPDATE kb_batches SET country = ? WHERE country = ?", [new, old])
        exec_sql("UPDATE kb_capabilities SET country = ? WHERE country = ?", [new, old])


def _seed() -> None:
    if fetchone("SELECT user_id FROM users LIMIT 1") is None:
        for user in DEFAULT_USERS:
            login_id = __import__("os").environ.get(user["login_id_env"], user["login_id"])
            password = __import__("os").environ.get(user["password_env"], user["password"])
            hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            exec_sql(
                """
                INSERT INTO users (user_id, username, email, password_hash, role_name, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [user["user_id"], user["username"], login_id, hashed, user["role"], _now()],
            )
    _seed_roles()
    _migrate_roles()
    _migrate_seed_login_ids()
    _migrate_table_countries()
    _ensure_layout(SDD_LAYOUT_ID, SDD_LAYOUT_NAME, "Solution design for a project, built from the SDD template.")
    if fetchone("SELECT template_id FROM layout_templates WHERE layout_id = ? LIMIT 1", [SDD_LAYOUT_ID]) is None:
        for template in parse_template(template_path()):
            exec_sql(
                """
                INSERT INTO layout_templates (
                    template_id, parent_id, section_name, sequence_order, system_prompt,
                    temperature, max_words, content_kind, schema_json, hint, layout_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    template["template_id"],
                    template["parent_id"],
                    template["section_name"],
                    template["sequence_order"],
                    template["system_prompt"],
                    template["temperature"],
                    template["max_words"],
                    template["content_kind"],
                    json.dumps(template["schema_json"]),
                    template["hint"],
                    SDD_LAYOUT_ID,
                ],
            )
    exec_sql("UPDATE layout_templates SET max_words = 2000 WHERE max_words = 500")
    _seed_interface_layout()
    _seed_fmea_layout()
    _migrate_documents()
    _backfill_structures()
    _drop_intro_header_blocks()
    _seed_kb_sources()
    _migrate_test_case_inventory()
    _rename_test_type_column()
    if fetchone("SELECT settings_id FROM app_settings WHERE settings_id = 'default'") is None:
        exec_sql(
            """
            INSERT INTO app_settings (settings_id, active_model, api_base_url, global_system_prompt, updated_at)
            VALUES ('default', 'gpt-4o-mini', 'https://api.openai.com/v1', ?, ?)
            """,
            [GLOBAL_PROMPT, _now()],
        )
    # Upgrade the untouched previous default; a prompt an admin has edited is left as it is.
    exec_sql(
        "UPDATE app_settings SET global_system_prompt = ?, updated_at = ? WHERE global_system_prompt = ?",
        [GLOBAL_PROMPT, _now(), LEGACY_GLOBAL_PROMPT],
    )
    _seed_llm_providers()


def _template_row(row: dict) -> dict:
    schema = row.get("schema_json")
    if isinstance(schema, str):
        row = dict(row)
        row["schema_json"] = json.loads(schema)
    return row


def fetch_templates() -> list[dict]:
    rows = fetchall("SELECT * FROM layout_templates ORDER BY sequence_order")
    return [_template_row(row) for row in rows]


def fetch_settings() -> dict:
    row = fetchone("SELECT * FROM app_settings WHERE settings_id = 'default'")
    if row is None:
        raise RuntimeError("Application settings are not seeded")
    return row


def public_template(row: dict) -> dict:
    return {
        "layout_id": row.get("layout_id") or "sdd",
        "template_id": row["template_id"],
        "parent_id": row["parent_id"],
        "section_name": row["section_name"],
        "sequence_order": row["sequence_order"],
        "system_prompt": row["system_prompt"],
        "temperature": row["temperature"],
        "max_words": row["max_words"],
        "content_kind": row["content_kind"],
    }
