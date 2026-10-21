import { useEffect, useState } from "react";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type { SystemRecord } from "../types";
import { DeleteSystemDialog } from "./DeleteSystemDialog";
import { FileDrop } from "./FileDrop";
import { type Column, DataTable } from "./DataTable";
import { KB_PAGE_SIZES } from "./TablePager";
import { SystemDialog } from "./SystemDialog";
import { can } from "../permissions";

export const SYSTEMS_PAGE_SIZE = 25;

export function SystemsPanel() {
  const auth = useOptionalAuth();
  // Without a signed-in user (component previews) editing stays on, as before.
  const canEdit = !auth?.user || can(auth.user, "knowledge", "write");
  const [items, setItems] = useState<SystemRecord[]>([]);
  const [dialog, setDialog] = useState<{ system?: SystemRecord } | null>(null);
  const [deleting, setDeleting] = useState<SystemRecord | null>(null);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<RowError[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api<SystemRecord[]>("/api/systems")
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load systems"));
  }, []);

  function saved(record: SystemRecord) {
    setItems((current) => [...current.filter((item) => item.system_code !== record.system_code), record].sort((a, b) => a.system_code.localeCompare(b.system_code)));
    setDialog(null);
  }

  async function upload(file: File) {
    setUploading(true);
    setError("");
    setProblems([]);
    try {
      const body = new FormData();
      body.append("file", file);
      const saved = await api<SystemRecord[]>("/api/systems/upload", { method: "POST", body });
      setItems(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      if (err instanceof ApiError) setProblems(err.errors);
    } finally {
      setUploading(false);
    }
  }

  function removed() {
    if (!deleting) return;
    const code = deleting.system_code;
    setItems((current) => current.filter((item) => item.system_code !== code));
    setDeleting(null);
  }

  const columns: Column<SystemRecord>[] = [
    { key: "code", header: "System Code", sortValue: (row) => row.system_code, className: "font-label text-xs whitespace-nowrap", render: (row) => row.system_code },
    { key: "name", header: "System Name", sortValue: (row) => row.system_name, className: "font-medium", render: (row) => row.system_name },
    { key: "description", header: "Description", sortValue: (row) => row.description, className: "text-muted max-w-md", render: (row) => <span className="line-clamp-2">{row.description || "—"}</span> },
    { key: "has_batch", header: "Has batch", sortValue: (row) => (row.has_batch ? 1 : 0), className: "text-muted whitespace-nowrap", render: (row) => (row.has_batch ? "Yes" : "No") },
    { key: "has_report", header: "Has report", sortValue: (row) => (row.has_report ? 1 : 0), className: "text-muted whitespace-nowrap", render: (row) => (row.has_report ? "Yes" : "No") },
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
        <p className="text-muted mt-0.5">
          The systems catalogue. Interfaces refer to these system codes. Upload an Excel (.xlsx) with columns SYSTEM_CODE, SYSTEM_NAME and DESCRIPTION. Description can be left blank.
        </p>
      </div>
      {error && <p className="text-alert">{error}</p>}
      {problems.length > 0 && (
        <ul className="max-h-56 overflow-auto rounded-lg border border-hairline p-3 text-alert space-y-1" aria-label="Upload problems">
          {problems.map((problem, index) => (
            <li key={index}>
              Row {problem.row}, {problem.field}: {problem.message}
            </li>
          ))}
        </ul>
      )}
      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row) => row.system_code}
        pageSize={SYSTEMS_PAGE_SIZE}
        pageSizes={KB_PAGE_SIZES}
        emptyLabel="No systems found."
        searchText={(row) => `${row.system_code} ${row.system_name} ${row.description} ${row.has_batch ? "Yes" : "No"} ${row.has_report ? "Yes" : "No"}`}
        searchLabel="Search Systems"
        searchPlaceholder="Search systems"
        toolbar={
          canEdit ? (
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => setDialog({})}>
                <span className="material-symbols-outlined text-base">add</span>
                Add
              </button>
              <FileDrop
                primary
                accept=".xlsx"
                ariaLabel="Upload systems Excel"
                disabled={uploading}
                idleLabel="Drop file"
                buttonLabel={
                  <>
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      upload
                    </span>
                    {uploading ? "Uploading…" : "Upload Excel"}
                  </>
                }
                onFile={(file) => void upload(file)}
              />
            </div>
          ) : undefined
        }
      />
      {dialog && <SystemDialog system={dialog.system} onSaved={saved} onClose={() => setDialog(null)} />}
      {deleting && (
        <DeleteSystemDialog system={deleting} onDeleted={removed} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
