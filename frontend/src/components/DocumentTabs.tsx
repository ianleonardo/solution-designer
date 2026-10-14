import { useEffect, useState } from "react";
import { ApiError } from "../api";
import type { LayoutSummary, ProjectDocument } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

function AddDocumentDialog({
  layouts,
  onAdd,
  onClose,
}: {
  layouts: LayoutSummary[];
  onAdd: (layoutId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [layoutId, setLayoutId] = useState(layouts[0]?.layout_id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Add document"
        className="w-full max-w-md rounded-lg border border-hairline bg-panel p-6 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          onAdd(layoutId).catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : "Could not add the document");
            setBusy(false);
          });
        }}
      >
        <h2 className="font-headline text-xl font-semibold mb-4">Add document</h2>
        {layouts.length === 0 ? (
          <p className="text-muted mb-4">This project already has every available document.</p>
        ) : (
          <label className="block mb-4">
            <span className="font-label text-[10px] uppercase text-muted">Document type</span>
            <select className="field mt-1" aria-label="Document type" value={layoutId} onChange={(event) => setLayoutId(event.target.value)}>
              {layouts.map((layout) => (
                <option key={layout.layout_id} value={layout.layout_id}>
                  {layout.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="text-alert mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || layouts.length === 0}>Add</button>
        </div>
      </form>
    </div>
  );
}

export function DocumentTabs({
  documents,
  activeId,
  layouts,
  canManage,
  onSelect,
  onAdd,
  onRemove,
}: {
  documents: ProjectDocument[];
  activeId: string;
  layouts: LayoutSummary[];
  canManage: boolean;
  onSelect: (documentId: string) => void;
  onAdd: (layoutId: string) => Promise<void>;
  onRemove: (document: ProjectDocument) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProjectDocument | null>(null);
  const used = new Set(documents.map((item) => item.layout_id));
  const available = layouts.filter((layout) => !used.has(layout.layout_id) && layout.section_count > 0);
  const active = documents.find((item) => item.document_id === activeId);

  return (
    <div className="px-4 border-b border-hairline flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Documents" className="flex flex-wrap items-end gap-1">
        {documents.map((item) => {
          const selected = item.document_id === activeId;
          return (
            <button
              key={item.document_id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`px-3 py-2 text-sm border-b-2 -mb-px ${selected ? "border-[var(--accent,currentColor)] font-semibold" : "border-transparent text-muted hover:text-inherit"}`}
              onClick={() => onSelect(item.document_id)}
            >
              {item.name}
              {item.status !== "draft" && (
                <span className="ml-2 rounded-full border border-hairline px-1.5 py-0.5 text-[10px] uppercase text-gold">
                  {item.status === "pending_approval" ? "Pending" : "Approved"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {canManage && (
        <div className="flex gap-1 py-1">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <span className="material-symbols-outlined">add</span>
            Add document
          </button>
          {documents.length > 1 && active && (
            <button type="button" className="icon-btn icon-btn-danger" aria-label={`Remove ${active.name}`} title="Remove document" onClick={() => setRemoving(active)}>
              <span className="material-symbols-outlined">delete</span>
            </button>
          )}
        </div>
      )}
      {adding && (
        <AddDocumentDialog
          layouts={available}
          onClose={() => setAdding(false)}
          onAdd={async (layoutId) => {
            await onAdd(layoutId);
            setAdding(false);
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove document"
          message={`Remove ${removing.name} from this project? Its content will be deleted.`}
          confirmLabel="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await onRemove(removing);
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
