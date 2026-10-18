import json
import threading
from datetime import datetime, timezone

import bcrypt
import duckdb

from app.config import DEFAULT_USERS, GLOBAL_PROMPT, LEGACY_GLOBAL_PROMPT, data_dir, template_path
from app.seed_layouts import (
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
        path = data_dir() / "solutioncrafter.duckdb"
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


def _migrate() -> None:
    statements = [
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
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS project_documents (
            document_id VARCHAR PRIMARY KEY,
            project_id VARCHAR NOT NULL,
            layout_id VARCHAR NOT NULL,
            content_json VARCHAR NOT NULL,
            status VARCHAR NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            generated_at TIMESTAMP,
            submitted_by VARCHAR,
            approved_by VARCHAR,
            approved_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL,
            structure_json VARCHAR,
            UNIQUE (project_id, layout_id)
        )
        """,
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
            processing_rules VARCHAR NOT NULL DEFAULT '',
            country_behavior VARCHAR NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL,
            last_modified TIMESTAMP NOT NULL,
            embedding FLOAT[],
            UNIQUE (country, system_code, l1_capability, l2_capability, l3_capability)
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


def _seed_llm_providers() -> None:
    defaults = [
        # provider, label, chat model, chat url, embedding model, embedding url
        ("gemini", "Gemini", "gemini-2.5-flash", "", "gemini-embedding-001", ""),
        ("anthropic", "Anthropic", "claude-sonnet-4-5", "https://api.anthropic.com", "", ""),
        (
            "spirare",
            "Spirare",
            "default",
            "https://is-egp.sg.uobnet.com/wip/v1/chat/completions",
            "/data/genai/models/bge-m3",
            "https://is-egp.sg.uobnet.com/embedding/v1/embeddings",
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


def _ensure_layout(layout_id: str, name: str, description: str) -> bool:
    """Create a system layout row if missing. Returns True when it was created."""
    if fetchone("SELECT layout_id FROM document_layouts WHERE layout_id = ?", [layout_id]):
        return False
    exec_sql(
        """
        INSERT INTO document_layouts (layout_id, name, description, is_system, created_at, updated_at)
        VALUES (?, ?, ?, TRUE, ?, ?)
        """,
        [layout_id, name, description, _now(), _now()],
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


def _seed_interface_layout() -> None:
    if not _ensure_layout(INTERFACE_LAYOUT_ID, INTERFACE_LAYOUT_NAME, INTERFACE_LAYOUT_DESCRIPTION):
        return
    used: set[str] = set()

    def template_id(name: str) -> str:
        base = f"{INTERFACE_LAYOUT_ID}--{slugify(name)}"
        candidate, counter = base, 2
        while candidate in used:
            candidate = f"{base}-{counter}"
            counter += 1
        used.add(candidate)
        return candidate

    def add(section: dict, parent_id: str | None, sequence: int) -> str:
        identifier = template_id(section["name"])
        insert_template(
            INTERFACE_LAYOUT_ID,
            {
                "template_id": identifier,
                "parent_id": parent_id,
                "section_name": section["name"],
                "sequence_order": sequence,
                "system_prompt": default_section_prompt(INTERFACE_LAYOUT_NAME, section["name"], section["hint"]),
                "temperature": 0.2,
                "max_words": 2000,
                "content_kind": kind_from_blocks(section["blocks"]),
                "schema_json": {"blocks": section["blocks"]},
                "hint": section["hint"],
            },
        )
        return identifier

    for index, section in enumerate(INTERFACE_SECTIONS, start=1):
        parent = add(section, None, index * 100)
        for child_index, child in enumerate(section["children"], start=1):
            add(child, parent, index * 100 + child_index)


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


def _migrate_seed_login_ids() -> None:
    """Older databases seeded `admin@solutioncrafter.local`-style IDs; Login IDs are no longer emails."""
    for user in DEFAULT_USERS:
        row = fetchone("SELECT email FROM users WHERE user_id = ?", [user["user_id"]])
        if row is None or row["email"] != f"{user['login_id']}@solutioncrafter.local":
            continue
        if fetchone("SELECT 1 AS x FROM users WHERE lower(email) = ?", [user["login_id"]]) is None:
            exec_sql("UPDATE users SET email = ? WHERE user_id = ?", [user["login_id"], user["user_id"]])


def _migrate_roles() -> None:
    """Legacy Maker/Checker/Write roles become Analyst; Read becomes Viewer."""
    exec_sql("UPDATE users SET role_name = 'Analyst' WHERE role_name IN ('Maker', 'Checker', 'Write')")
    exec_sql("UPDATE users SET role_name = 'Viewer' WHERE role_name = 'Read'")


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
    _migrate_documents()
    _backfill_structures()
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
