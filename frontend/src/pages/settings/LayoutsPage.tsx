import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, formatDate } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { DataTable, type Column } from "../../components/DataTable";
import type { LayoutDetail, LayoutSummary } from "../../types";

export const LAYOUT_PAGE_SIZE = 20;

function LayoutDialog({
  layouts,
  onCreated,
  onClose,
}: {
  layouts: LayoutSummary[];
  onCreated: (layout: LayoutDetail) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await api<LayoutDetail>("/api/layouts", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim(), copy_from: copyFrom || null }),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the layout");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form role="dialog" aria-modal="true" aria-label="Add layout" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-xl font-semibold mb-4">Add layout</h2>
        <label className="block mb-3">
          <span className="font-label text-[10px] uppercase text-muted">Document name</span>
          <input className="field mt-1" aria-label="Document name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus maxLength={100} />
        </label>
        <label className="block mb-3">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[72px]" aria-label="Description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} />
        </label>
        <label className="block mb-4">
          <span className="font-label text-[10px] uppercase text-muted">Start from</span>
          <select className="field mt-1" aria-label="Start from" value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}>
            <option value="">Empty layout</option>
            {layouts.map((layout) => (
              <option key={layout.layout_id} value={layout.layout_id}>
                Copy of {layout.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-alert mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>Create layout</button>
        </div>
      </form>
    </div>
  );
}

export function LayoutsPage() {
  const navigate = useNavigate();
  const [layouts, setLayouts] = useState<LayoutSummary[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<LayoutSummary | null>(null);

  useEffect(() => {
    api<LayoutSummary[]>("/api/layouts")
      .then(setLayouts)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load layouts"));
  }, []);

  const columns: Column<LayoutSummary>[] = [
    {
      key: "name",
      header: "Document name",
      sortValue: (row) => row.name,
      render: (row) => (
        <button type="button" className="text-left font-medium hover:underline" onClick={() => navigate(`/settings/layouts/${row.layout_id}`)}>
          {row.name}
        </button>
      ),
    },
    { key: "description", header: "Description", sortValue: (row) => row.description, render: (row) => <span className="text-muted">{row.description}</span> },
    { key: "sections", header: "Sections", sortValue: (row) => row.section_count, render: (row) => row.section_count },
    { key: "used", header: "Used by", sortValue: (row) => row.document_count, render: (row) => `${row.document_count} document${row.document_count === 1 ? "" : "s"}` },
    { key: "updated", header: "Updated", sortValue: (row) => row.updated_at, render: (row) => formatDate(row.updated_at) },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex gap-1">
          <button type="button" className="icon-btn" aria-label={`Edit ${row.name}`} title="Edit layout" onClick={() => navigate(`/settings/layouts/${row.layout_id}`)}>
            <span className="material-symbols-outlined">edit</span>
          </button>
          {!row.is_system && (
            <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.name}`} title="Delete layout" onClick={() => setRemoving(row)}>
              <span className="material-symbols-outlined">delete</span>
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="font-headline text-2xl font-semibold">Document Layouts</h1>
        <p className="text-muted text-sm">Each layout defines a type of document that projects can contain.</p>
      </div>
      {error && <p className="text-alert">{error}</p>}
      <DataTable
        rows={layouts}
        columns={columns}
        rowKey={(row) => row.layout_id}
        pageSize={LAYOUT_PAGE_SIZE}
        emptyLabel="No layouts found."
        searchText={(row) => `${row.name} ${row.description}`}
        searchLabel="Search layouts"
        searchPlaceholder="Search layouts"
        toolbar={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <span className="material-symbols-outlined">add</span>
            Add layout
          </button>
        }
      />
      {adding && (
        <LayoutDialog
          layouts={layouts}
          onClose={() => setAdding(false)}
          onCreated={(created) => navigate(`/settings/layouts/${created.layout_id}`)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Delete layout"
          message={`Delete the ${removing.name} layout and all of its sections?`}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/api/layouts/${removing.layout_id}`, { method: "DELETE" });
            setLayouts((current) => current.filter((item) => item.layout_id !== removing.layout_id));
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
