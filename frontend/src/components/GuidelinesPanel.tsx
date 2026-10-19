import { useEffect, useState } from "react";
import MarkdownIt from "markdown-it";
import { api, ApiError, authHeaders, downloadFile, formatDate } from "../api";
import { useOptionalAuth } from "../auth";
import type { Guideline } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { type Column, DataTable } from "./DataTable";
import { KB_PAGE_SIZES } from "./TablePager";
import { GuidelineDialog } from "./GuidelineDialog";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

export const GUIDELINES_PAGE_SIZE = 25;

function GuidelinePreview({ guideline, onClose }: { guideline: Guideline; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const isPdf = guideline.file_type === "pdf";
  const isMarkdown = ["md", "markdown"].includes((guideline.file_type || "").toLowerCase());

  useEffect(() => {
    let revoked = "";
    setLoading(true);
    setError("");
    fetch(`/api/guidelines/${encodeURIComponent(guideline.guideline_id)}/download?inline=1`, { headers: authHeaders() })
      .then(async (response) => {
        if (!response.ok) {
          let detail = response.statusText;
          try {
            const body = (await response.json()) as { detail?: string };
            if (body.detail) detail = body.detail;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }
        if (isPdf) {
          const blob = await response.blob();
          revoked = URL.createObjectURL(blob);
          setUrl(revoked);
        } else {
          setText(await response.text());
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load preview"))
      .finally(() => setLoading(false));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [guideline.guideline_id, isPdf]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Preview ${guideline.title}`} className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg border border-hairline bg-panel shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-headline text-lg font-semibold truncate">{guideline.title}</h2>
            <p className="text-xs text-muted truncate">{guideline.file_name}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close preview" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 min-h-[50vh]">
          {loading && <p className="text-muted">Loading preview…</p>}
          {error && <p className="text-alert">{error}</p>}
          {!loading && !error && isPdf && url && <iframe title={guideline.title} src={url} className="w-full h-[65vh] rounded border border-hairline bg-white" />}
          {!loading && !error && !isPdf && isMarkdown && (
            <div className="md-preview rounded-lg border border-hairline bg-inset p-5" aria-label="Rendered markdown" dangerouslySetInnerHTML={{ __html: markdown.render(text) }} />
          )}
          {!loading && !error && !isPdf && !isMarkdown && (
            <pre className="whitespace-pre-wrap text-sm font-mono bg-inset rounded-lg p-4 border border-hairline">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function GuidelinesPanel() {
  const auth = useOptionalAuth();
  const canEdit = auth?.user?.role_name !== "Viewer";
  const [items, setItems] = useState<Guideline[]>([]);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Guideline | null>(null);
  const [previewing, setPreviewing] = useState<Guideline | null>(null);
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
    { key: "added", header: "Added", sortValue: (row) => row.created_at, className: "text-muted whitespace-nowrap", render: (row) => formatDate(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "whitespace-nowrap",
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.has_file && (
            <>
              <button type="button" className="icon-btn" aria-label={`Preview ${row.title}`} title="Preview" onClick={() => setPreviewing(row)}>
                <span className="material-symbols-outlined text-base">visibility</span>
              </button>
              <button type="button" className="icon-btn" aria-label={`Download ${row.title}`} title={`Download the original file (${row.file_name})`} onClick={() => void download(row)}>
                <span className="material-symbols-outlined text-base">download</span>
              </button>
            </>
          )}
          {canEdit && (
            <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.title}`} title="Delete" onClick={() => setDeleting(row)}>
              <span className="material-symbols-outlined text-base">delete</span>
            </button>
          )}
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
        pageSizes={KB_PAGE_SIZES}
        emptyLabel="No guidelines found."
        searchText={(row) => `${row.guideline_id} ${row.title} ${row.description} ${row.file_name}`}
        searchLabel="Search Guidelines"
        searchPlaceholder="Search guidelines"
        toolbar={
          canEdit ? (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <span className="material-symbols-outlined text-base">add</span>
              Add
            </button>
          ) : undefined
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
      {previewing && <GuidelinePreview guideline={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}
