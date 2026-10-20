import { useEffect, useState } from "react";
import MarkdownIt from "markdown-it";
import { api, ApiError, authHeaders, downloadFile, formatBytes } from "../api";
import type { Reference } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileDrop } from "./FileDrop";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

type Props = {
  projectId: string;
  references: Reference[];
  canEdit: boolean;
  onChange: (references: Reference[]) => void;
  onClose: () => void;
};

function ReferencePreview({
  projectId,
  reference,
  onClose,
}: {
  projectId: string;
  reference: Reference;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const fileType = (reference.file_type || "").toLowerCase();
  const isPdf = fileType === "pdf";
  const isMarkdown = fileType === "md" || fileType === "markdown" || fileType === "txt";
  const isSpreadsheet = fileType === "xlsx" || fileType === "xls";

  useEffect(() => {
    let revoked = "";
    setLoading(true);
    setError("");
    fetch(`/api/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(reference.doc_id)}/download?inline=1`, {
      headers: authHeaders(),
    })
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
        } else if (isSpreadsheet) {
          setText(reference.extracted_text || "Spreadsheet uploaded. Download the file to view it in Excel.");
        } else {
          setText(await response.text());
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load preview"))
      .finally(() => setLoading(false));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [projectId, reference.doc_id, reference.extracted_text, isPdf, isSpreadsheet]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Preview ${reference.file_name}`} className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg border border-hairline bg-panel shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-headline text-lg font-semibold truncate">{reference.file_name}</h2>
            <p className="text-xs text-muted truncate">{formatBytes(reference.size_bytes)}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close preview" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 min-h-[50vh]">
          {loading && <p className="text-muted">Loading preview…</p>}
          {error && <p className="text-alert">{error}</p>}
          {!loading && !error && isPdf && url && <iframe title={reference.file_name} src={url} className="w-full h-[65vh] rounded border border-hairline bg-white" />}
          {!loading && !error && isMarkdown && fileType !== "txt" && (
            <div className="md-preview rounded-lg border border-hairline bg-inset p-5" aria-label="Rendered markdown" dangerouslySetInnerHTML={{ __html: markdown.render(text) }} />
          )}
          {!loading && !error && (fileType === "txt" || isSpreadsheet) && (
            <pre className="whitespace-pre-wrap text-sm font-mono bg-inset rounded-lg p-4 border border-hairline">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReferencesPanel({ projectId, references, canEdit, onChange, onClose }: Props) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<Reference | null>(null);
  const [previewing, setPreviewing] = useState<Reference | null>(null);

  async function upload(file: File) {
    setError("");
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const created = await api<Reference>(`/api/projects/${projectId}/references`, { method: "POST", body });
      onChange([...references, created]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function download(reference: Reference) {
    setError("");
    try {
      await downloadFile(
        `/api/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(reference.doc_id)}/download`,
        reference.file_name,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Download failed");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-label="Project references" className="bg-panel border border-hairline rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
          <div>
            <h2 className="font-headline text-lg font-semibold">Project references</h2>
            <p className="text-xs text-muted">Documents here are indexed for this project only and used when generating its documents.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-4 overflow-auto space-y-3">
          {error && <p className="text-alert">{error}</p>}
          {references.length === 0 ? (
            <p className="text-muted">No references uploaded yet.</p>
          ) : (
            <ul>
              {references.map((reference) => (
                <li key={reference.doc_id} className="py-2 flex items-center gap-3 border-b border-hairline last:border-b-0">
                  <span className="material-symbols-outlined text-muted">description</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{reference.file_name}</p>
                    <p className="text-xs text-muted">
                      {formatBytes(reference.size_bytes)} · {reference.chunk_count} chunks
                    </p>
                  </div>
                  <span
                    className="rounded-full border border-hairline px-2 py-0.5 text-xs"
                    title={reference.indexed ? "Chunks are embedded for semantic search" : "Searched by keyword. Configure an embedding model for semantic search."}
                  >
                    {reference.indexed ? "Indexed" : "Keyword only"}
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Preview ${reference.file_name}`} title="Preview" onClick={() => setPreviewing(reference)}>
                    <span className="material-symbols-outlined text-base">visibility</span>
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Download ${reference.file_name}`} title="Download" onClick={() => void download(reference)}>
                    <span className="material-symbols-outlined text-base">download</span>
                  </button>
                  {canEdit && (
                    <button type="button" className="icon-btn icon-btn-danger" aria-label={`Remove ${reference.file_name}`} onClick={() => setRemoving(reference)}>
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-hairline">
          {canEdit ? (
            <FileDrop
              primary
              accept=".md,.markdown,.pdf,.xlsx,.xls"
              ariaLabel="Upload reference"
              disabled={uploading}
              idleLabel="Drop file"
              buttonLabel={uploading ? "Uploading…" : "Upload reference"}
              onFile={(file) => void upload(file)}
            />
          ) : (
            <span className="text-xs text-muted">Only Analyst users can change references.</span>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {removing && (
        <ConfirmDialog
          title="Remove reference"
          message={`Remove ${removing.file_name} and its indexed chunks from this project?`}
          confirmLabel="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/api/projects/${projectId}/references/${removing.doc_id}`, { method: "DELETE" });
            onChange(references.filter((item) => item.doc_id !== removing.doc_id));
            setRemoving(null);
          }}
        />
      )}
      {previewing && <ReferencePreview projectId={projectId} reference={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}
