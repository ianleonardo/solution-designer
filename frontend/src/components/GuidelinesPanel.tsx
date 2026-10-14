import { useEffect, useState } from "react";
import { api, ApiError, downloadFile, formatDate } from "../api";
import type { Guideline, GuidelineStatus } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { type Column, DataTable } from "./DataTable";
import { GuidelineDialog } from "./GuidelineDialog";

export const GUIDELINES_PAGE_SIZE = 50;

const STATUS: Record<GuidelineStatus, { label: string; tip: string; className: string }> = {
  embedded: { label: "Embedded", tip: "All chunks are embedded with the active embedding model.", className: "text-accent" },
  keyword_only: { label: "Keyword only", tip: "No embeddings yet. Searched by keyword. Configure an embedding model under Settings > LLM; everything is re-indexed automatically.", className: "text-muted" },
  outdated: { label: "Outdated model", tip: "Embeddings were made with a different embedding model, or are incomplete. They are re-made at the next re-index.", className: "text-alert" },
};

export function GuidelinesPanel() {
  const [items, setItems] = useState<Guideline[]>([]);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Guideline | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<Guideline[]>("/api/guidelines")
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load guidelines"));
  }, []);

  async function download(row: Guideline) {
    setError("");
    try {
      await downloadFile(`/api/guidelines/${encodeURIComponent(row.guideline_id)}/download`, row.file_name || `${row.guideline_id}.${row.file_type}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Download failed");
    }
  }

  async function remove() {
    if (!deleting) return;
    await api(`/api/guidelines/${encodeURIComponent(deleting.guideline_id)}`, { method: "DELETE" });
    const id = deleting.guideline_id;
    setItems((current) => current.filter((item) => item.guideline_id !== id));
    setDeleting(null);
  }

  const columns: Column<Guideline>[] = [
    { key: "id", header: "ID", sortValue: (row) => row.guideline_id, className: "font-label text-xs whitespace-nowrap", render: (row) => row.guideline_id },
    { key: "title", header: "Title", sortValue: (row) => row.title, className: "font-medium", render: (row) => row.title },
    { key: "description", header: "Description", sortValue: (row) => row.description, className: "text-muted max-w-md", render: (row) => <span className="line-clamp-2">{row.description || "—"}</span> },
    { key: "file", header: "File", sortValue: (row) => row.file_name, className: "text-muted", render: (row) => row.file_name || "—" },
    { key: "chunks", header: "Chunks", sortValue: (row) => row.chunk_count, className: "whitespace-nowrap", render: (row) => `${row.embedded_count}/${row.chunk_count}` },
    {
      key: "embedding",
      header: "Embedding",
      sortValue: (row) => STATUS[row.status].label,
      className: "whitespace-nowrap",
      render: (row) => (
        <span className={`rounded-full border border-hairline px-2 py-0.5 text-xs ${STATUS[row.status].className}`} title={`${STATUS[row.status].tip}${row.embedding_model ? ` Model: ${row.embedding_model}.` : ""}`}>
          {STATUS[row.status].label}
        </span>
      ),
    },
    { key: "added", header: "Added", sortValue: (row) => row.created_at, className: "text-muted whitespace-nowrap", render: (row) => formatDate(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "whitespace-nowrap",
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.has_file && (
            <button type="button" className="icon-btn" aria-label={`Download ${row.title}`} title={`Download the original file (${row.file_name})`} onClick={() => void download(row)}>
              <span className="material-symbols-outlined text-base">download</span>
            </button>
          )}
          <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.title}`} title="Delete" onClick={() => setDeleting(row)}>
            <span className="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">Guidelines</h1>
        <p className="text-muted mt-0.5">Guideline documents are split into chunks and embedded so generated documents and chat can draw on them.</p>
      </div>
      {error && <p className="text-alert">{error}</p>}
      {notice && <p className="text-accent" role="status">{notice}</p>}
      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row) => row.guideline_id}
        pageSize={GUIDELINES_PAGE_SIZE}
        emptyLabel="No guidelines found."
        searchText={(row) => `${row.guideline_id} ${row.title} ${row.description} ${row.file_name}`}
        searchLabel="Search Guidelines"
        searchPlaceholder="Search guidelines"
        toolbar={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <span className="material-symbols-outlined text-base">add</span>
            Add
          </button>
        }
      />
      {adding && (
        <GuidelineDialog
          onClose={() => setAdding(false)}
          onAdded={(saved) => {
            setItems((current) => [saved, ...current]);
            setNotice(saved.warning || `${saved.title} was added: ${saved.chunk_count} chunks embedded.`);
            setAdding(false);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog title="Delete guideline" message={`Delete "${deleting.title}" and its ${deleting.chunk_count} chunks? This cannot be undone.`} onConfirm={remove} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
