export type Role = "Admin" | "Checker" | "Maker" | "Viewer";

export type SequenceNode = {
  id: string;
  position: { x: number; y: number };
  data: { label: string; actor: boolean };
};

export type SequenceEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  data: { kind: "request" | "reply" };
};

export type SequenceFlow = { nodes: SequenceNode[]; edges: SequenceEdge[] };

export type FlowchartShape = "rect" | "round" | "decision";

export type FlowchartNode = {
  id: string;
  position: { x: number; y: number };
  data: { label: string; shape: FlowchartShape };
};

export type FlowchartEdge = { id: string; source: string; target: string; label: string };

export type Flowchart = { direction: "LR" | "TB"; nodes: FlowchartNode[]; edges: FlowchartEdge[] };

/** What a diagram block stores next to its Mermaid text: a sequence flow, or a drawn flowchart. */
export type DiagramFlow = SequenceFlow | Flowchart;

export type Block =
  | { type: "header"; text: string; level: number }
  | { type: "image"; url: string; caption: string; alt: string }
  | { type: "prose"; markdown: string }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "diagram"; sequence: boolean; mermaid: string; flow: DiagramFlow | null };

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
  status: "draft" | "pending_approval" | "approved";
  last_modified: string;
  generated_at: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
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
  status: string;
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

export type Dashboard = {
  total_projects: number;
  documents_generated: number;
  pending_approvals: number;
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
  created_at: string;
  last_modified: string;
};

export type InterfaceChannel = "SPL" | "DGE" | "PIB" | "WSM" | "EAI";

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

export type ReindexStatus = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  started_at: string | null;
  finished_at: string | null;
  message: string;
};
