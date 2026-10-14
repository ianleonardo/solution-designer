import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { type Column, DataTable } from "../components/DataTable";
import { GuidelinesPanel } from "../components/GuidelinesPanel";
import { InterfacesPanel } from "../components/InterfacesPanel";
import { SystemsPanel } from "../components/SystemsPanel";
import { KNOWLEDGE_KINDS } from "../knowledge";
import type { RagItem } from "../types";

export const KNOWLEDGE_PAGE_SIZE = 50;

function details(item: RagItem) {
  return Object.entries(item.parsed ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

export function KnowledgePage() {
  const { kind: slug } = useParams();
  // Guidelines, systems and interfaces are structured records, so they have their own screens.
  if (slug === "guidelines") return <GuidelinesPanel />;
  if (slug === "systems") return <SystemsPanel />;
  if (slug === "interfaces") return <InterfacesPanel />;
  return <InventoryPage />;
}

function InventoryPage() {
  const { kind: slug } = useParams();
  const kind = KNOWLEDGE_KINDS.find((item) => item.slug === slug);
  const [items, setItems] = useState<RagItem[]>([]);
  const [deleting, setDeleting] = useState<RagItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api<RagItem[]>("/api/rag")
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load the knowledge base"));
  }, [slug]);

  if (!kind) return <Navigate to={`/knowledge/${KNOWLEDGE_KINDS[0].slug}`} replace />;

  const rows = items.filter((item) => item.inventory_type === kind.inventoryType);

  async function upload(file: File) {
    if (!kind) return;
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const created = await api<RagItem[]>(`/api/rag?inventory_type=${encodeURIComponent(kind.inventoryType)}`, { method: "POST", body });
      setItems((current) => [...created, ...current]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    await api(`/api/rag/${deleting.rag_id}`, { method: "DELETE" });
    const id = deleting.rag_id;
    setItems((current) => current.filter((row) => row.rag_id !== id));
    setDeleting(null);
  }

  const columns: Column<RagItem>[] = [
    { key: "id", header: "ID", sortValue: (row) => row.rag_id, className: "font-label text-xs whitespace-nowrap", render: (row) => row.rag_id },
    { key: "system", header: "System", sortValue: (row) => row.system_name, render: (row) => row.system_name },
    { key: "source", header: "Source", sortValue: (row) => row.source_name, className: "text-muted", render: (row) => row.source_name },
    { key: "details", header: "Details", sortValue: (row) => details(row), className: "text-muted max-w-xl", render: (row) => <span className="line-clamp-2">{details(row)}</span> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.rag_id}`} title="Delete" onClick={() => setDeleting(row)}>
          <span className="material-symbols-outlined text-base">delete</span>
        </button>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">{kind.label}</h1>
        <p className="text-muted mt-0.5">Shared knowledge-base entries used to ground generated documents.</p>
      </div>
      {error && <p className="text-alert">{error}</p>}
      <DataTable
        key={kind.slug}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.rag_id}
        pageSize={KNOWLEDGE_PAGE_SIZE}
        emptyLabel={`No ${kind.label.toLowerCase()} found.`}
        searchText={(row) => `${row.rag_id} ${row.system_name} ${row.source_name} ${details(row)} ${row.raw_content ?? ""}`}
        searchLabel={`Search ${kind.label}`}
        searchPlaceholder={`Search ${kind.label.toLowerCase()}`}
        toolbar={
          <label className={`btn btn-primary cursor-pointer ${uploading ? "opacity-50" : ""}`}>
            <span className="material-symbols-outlined text-base">upload</span>
            {uploading ? "Uploading…" : "Upload"}
            <input
              className="hidden"
              type="file"
              aria-label={`Upload ${kind.label}`}
              accept=".md,.markdown,.pdf,.html,.htm"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        }
      />
      {deleting && (
        <ConfirmDialog title="Delete entry" message={`Delete ${deleting.rag_id}? This cannot be undone.`} onConfirm={remove} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
