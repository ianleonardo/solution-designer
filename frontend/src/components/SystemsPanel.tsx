import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useOptionalAuth } from "../auth";
import type { SystemRecord } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { type Column, DataTable } from "./DataTable";
import { SystemDialog } from "./SystemDialog";

export const SYSTEMS_PAGE_SIZE = 50;

export function SystemsPanel() {
  const auth = useOptionalAuth();
  const canEdit = auth?.user?.role_name !== "Viewer";
  const [items, setItems] = useState<SystemRecord[]>([]);
  const [dialog, setDialog] = useState<{ system?: SystemRecord } | null>(null);
  const [deleting, setDeleting] = useState<SystemRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<SystemRecord[]>("/api/systems")
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load systems"));
  }, []);

  function saved(record: SystemRecord) {
    setItems((current) => [...current.filter((item) => item.system_code !== record.system_code), record].sort((a, b) => a.system_code.localeCompare(b.system_code)));
    setDialog(null);
  }

  async function remove() {
    if (!deleting) return;
    await api(`/api/systems/${encodeURIComponent(deleting.system_code)}`, { method: "DELETE" });
    const code = deleting.system_code;
    setItems((current) => current.filter((item) => item.system_code !== code));
    setDeleting(null);
  }

  const columns: Column<SystemRecord>[] = [
    { key: "code", header: "System Code", sortValue: (row) => row.system_code, className: "font-label text-xs whitespace-nowrap", render: (row) => row.system_code },
    { key: "name", header: "System Name", sortValue: (row) => row.system_name, className: "font-medium", render: (row) => row.system_name },
    { key: "description", header: "Description", sortValue: (row) => row.description, className: "text-muted max-w-md", render: (row) => <span className="line-clamp-2">{row.description || "—"}</span> },
    { key: "upstreams", header: "Upstreams", sortValue: (row) => row.upstreams, className: "text-muted", render: (row) => row.upstreams || "—" },
    { key: "downstreams", header: "Downstreams", sortValue: (row) => row.downstreams, className: "text-muted", render: (row) => row.downstreams || "—" },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            className: "whitespace-nowrap",
            render: (row: SystemRecord) => (
              <div className="flex items-center gap-1">
                <button type="button" className="icon-btn" aria-label={`Edit ${row.system_code}`} title="Edit" onClick={() => setDialog({ system: row })}>
                  <span className="material-symbols-outlined text-base">edit</span>
                </button>
                <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.system_code}`} title="Delete" onClick={() => setDeleting(row)}>
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">Systems</h1>
        <p className="text-muted mt-0.5">The systems catalogue. Interfaces refer to these system codes, and so do each system's upstreams and downstreams.</p>
      </div>
      {error && <p className="text-alert">{error}</p>}
      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row) => row.system_code}
        pageSize={SYSTEMS_PAGE_SIZE}
        emptyLabel="No systems found."
        searchText={(row) => `${row.system_code} ${row.system_name} ${row.description} ${row.upstreams} ${row.downstreams}`}
        searchLabel="Search Systems"
        searchPlaceholder="Search systems"
        toolbar={
          canEdit ? (
            <button type="button" className="btn btn-primary" onClick={() => setDialog({})}>
              <span className="material-symbols-outlined text-base">add</span>
              Add
            </button>
          ) : undefined
        }
      />
      {dialog && <SystemDialog system={dialog.system} onSaved={saved} onClose={() => setDialog(null)} />}
      {deleting && (
        <ConfirmDialog title="Delete system" message={`Delete ${deleting.system_code} (${deleting.system_name})? This cannot be undone.`} onConfirm={remove} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
