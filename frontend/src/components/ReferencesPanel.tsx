import { useState } from "react";
import { api, ApiError, formatBytes } from "../api";
import type { Reference } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  projectId: string;
  references: Reference[];
  canEdit: boolean;
  onChange: (references: Reference[]) => void;
  onClose: () => void;
};

export function ReferencesPanel({ projectId, references, canEdit, onChange, onClose }: Props) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<Reference | null>(null);

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
            <label className="btn btn-primary cursor-pointer">
              {uploading ? "Uploading…" : "Upload reference"}
              <input
                className="hidden"
                type="file"
                aria-label="Upload reference"
                accept=".md,.markdown,.pdf,.xlsx,.xls"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
            </label>
          ) : (
            <span className="text-xs text-muted">Only Makers and Checkers can change references.</span>
          )}
          <button type="button" className="btn" onClick={onClose}>Close</button>
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
    </div>
  );
}
