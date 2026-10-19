export type Role = "Admin" | "Analyst" | "Viewer";

export type Block =
  | { type: "header"; text: string; level: number }
  | { type: "image"; url: string; caption: string; alt: string }
  | { type: "prose"; markdown: string }
  | { type: "table"; columns: string[]; rows: string[][] }
  /** `sequence` only picks the starter text of a new diagram; any Mermaid can be written in the block. */
  | { type: "diagram"; sequence: boolean; mermaid: string };

export type MissingInfo = { field: string; message: string };

export type Section = {
  template_id: string;
  title: string;
  blocks: Block[];
  missing: MissingInfo[];
};

export type Sdd = {
  sdd_id: string;
  document_id: string;
  project_id: string;
  layout_id: string;
  name: string;
  content_json: { sections: Record<string, Section> };
  last_modified: string;
  generated_at: string | null;
};

export type Template = {
  layout_id: string;
  template_id: string;
  parent_id: string | null;
  section_name: string;
  sequence_order: number;
  system_prompt: string;
  temperature: number;
  max_words: number;
  content_kind: string;
  /** Block layout and hint of the section. Present on a document's own sections. */
  blocks?: BlockSpec[];
  hint?: string;
};

export type Project = {
  project_id: string;
  project_name: string;
  description: string;
  owner_id: string;
  owner_name: string;
  owner_role: Role;
  created_at: string;
  last_modified: string;
};

export type Reference = {
  doc_id: string;
  file_name: string;
  file_type: string;
  uploaded_by: string;
  uploaded_at: string;
  size_bytes: number;
  extracted_text: string;
  chunk_count: number;
  indexed: boolean;
};

export type ProjectDocument = Sdd & { templates: Template[] };

export type BlockSpec =
  | { type: "header"; text: string; level: number }
  | { type: "prose" }
  | { type: "table"; columns: string[]; rows?: string[][] }
  | { type: "image"; caption: string }
  | { type: "diagram"; sequence: boolean };

export type LayoutSummary = {
  layout_id: string;
  name: string;
  description: string;
  is_system: boolean;
  section_count: number;
  document_count: number;
  created_at: string;
  updated_at: string;
};

export type LayoutTemplate = Template & { blocks: BlockSpec[]; hint: string };

export type LayoutDetail = LayoutSummary & { templates: LayoutTemplate[] };

export type WorkspaceData = {
  project: Project;
  documents: ProjectDocument[];
  layouts: LayoutSummary[];
  references: Reference[];
};

export type User = {
  user_id: string;
  username: string;
  login_id: string;
  role_name: Role;
  /** local stores a password here. ldap checks Active Directory and stores none. */
  auth_provider?: "local" | "ldap";
  created_at: string;
};

export type RagItem = {
  rag_id: string;
  inventory_type: string;
  system_name: string;
  source_name: string;
  raw_content: string;
  parsed: Record<string, string>;
  created_at: string;
};

export type GuidelineStatus = "embedded" | "keyword_only" | "outdated";

export type Guideline = {
  guideline_id: string;
  title: string;
  description: string;
  file_name: string;
  file_type: string;
  /** False for entries converted from the old inventory, which have no stored original. */
  has_file: boolean;
  chunk_count: number;
  embedded_count: number;
  embedding_model: string;
  status: GuidelineStatus;
  created_by: string;
  created_at: string;
  indexed_at: string | null;
  /** Only on the response to add, re-embed and re-tokenize. */
  warning?: string;
};

export type KbCountryStats = {
  country: string;
  capabilities: number;
  interfaces: number;
  tables: number;
  batches: number;
  reports: number;
};

export type Dashboard = {
  total_projects: number;
  total_documents: number;
  kb_by_country: KbCountryStats[];
};

export type LlmProvider = {
  provider: "gemini" | "anthropic" | "spirare";
  label: string;
  chat_model: string;
  chat_base_url: string;
  embedding_model: string;
  embedding_base_url: string;
  api_key_configured: boolean;
  embedding_api_key_configured: boolean;
  verify_ssl?: boolean;
  updated_at: string;
};

export type Settings = {
  active_provider: LlmProvider["provider"];
  global_system_prompt: string;
  updated_at: string;
  providers: LlmProvider[];
};

export type SystemRecord = {
  system_code: string;
  system_name: string;
  description: string;
  upstreams: string;
  downstreams: string;
  has_batch: boolean;
  has_report: boolean;
  has_capability: boolean;
  created_at: string;
  last_modified: string;
};

export type InterfaceChannel = string;

export type InterfaceRecord = {
  interface_id: string;
  channel: InterfaceChannel;
  country: string;
  interface_name: string;
  description: string;
  protocol: string;
  source: string;
  destination: string;
};

export type Catalogs = {
  countries: string[];
  databases: string[];
  interface_channels: string[];
  bitbucket_projects: string[];
};

export type ReindexStatus = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  started_at: string | null;
  finished_at: string | null;
  message: string;
};

export type AuditEntry = {
  audit_id: string;
  occurred_at: string;
  user_id: string | null;
  username: string | null;
  login_id: string | null;
  role_name: string | null;
  action: string;
  method: string | null;
  path: string | null;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
};

export type KbColumnRecord = {
  column_id: string;
  table_id: string;
  column_name: string;
  data_type: string;
  is_null: string;
  primary_key: string;
  foreign_key: string;
  description: string;
  created_at: string;
  last_modified: string;
};

export type KbTableRecord = {
  table_id: string;
  country: string;
  database_name: string;
  schema_name: string;
  table_name: string;
  description: string;
  column_count: number;
  created_at: string;
  last_modified: string;
  columns?: KbColumnRecord[];
};

export type TableCompareResult = {
  database: string;
  schema: string;
  countries: string[];
  missing_tables: { table_name: string; present_in: string[]; missing_in: string[] }[];
  column_diffs: {
    table_name: string;
    column_name: string;
    data_types: Record<string, string>;
    missing_in: string[];
  }[];
};

export type KbBitbucketRepoRecord = {
  repo_id: string;
  bitbucket_project: string;
  repo_name: string;
  description: string;
  main_components: string;
  created_at: string;
  last_modified: string;
};

export type KbReportRecord = {
  report_id: string;
  country: string;
  system_code: string;
  report_name: string;
  frequency: string;
  frequency_other: string;
  description: string;
  layout: string;
  created_at: string;
  last_modified: string;
};

export type KbBatchRecord = {
  batch_id: string;
  country: string;
  system_code: string;
  batch_name: string;
  batch_type: string;
  frequency: string;
  frequency_other: string;
  to_from_systems: string;
  description: string;
  batch_filename: string;
  file_layout: string;
  created_at: string;
  last_modified: string;
};

export type KbCapabilityLinkInterface = {
  interface_id: string;
  channel: string;
  country: string;
  interface_name: string;
  description: string;
  protocol: string;
  source: string;
  destination: string;
};

export type KbCapabilityLinkTable = {
  table_id: string;
  country: string;
  database_name: string;
  schema_name: string;
  table_name: string;
  description: string;
};

export type KbCapabilityLinkBatch = {
  batch_id: string;
  country: string;
  system_code: string;
  batch_name: string;
  batch_type: string;
  description: string;
};

export type KbCapabilityLinkReport = {
  report_id: string;
  country: string;
  system_code: string;
  report_name: string;
  description: string;
};

export type KbCapabilityRecord = {
  capability_id: string;
  country: string;
  system_code: string;
  l1_capability: string;
  l2_capability: string;
  l3_capability: string;
  description: string;
  processing_rules: string;
  country_behavior?: string;
  created_at: string;
  last_modified: string;
  interfaces?: KbCapabilityLinkInterface[];
  tables?: KbCapabilityLinkTable[];
  batches?: KbCapabilityLinkBatch[];
  reports?: KbCapabilityLinkReport[];
};

export type MissingColumnItem = {
  column_id: string;
  table_id: string;
  table_name: string;
  column_name: string;
  data_type: string;
  description: string;
};

export type TablesUploadResponse = {
  tables: KbTableRecord[];
  uploaded_tables: number;
  uploaded_columns: number;
  missing_columns: MissingColumnItem[];
};
