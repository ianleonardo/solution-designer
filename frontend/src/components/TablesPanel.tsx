import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type {
  KbColumnRecord,
  KbTableRecord,
  MissingColumnItem,
  TableCountry,
  TableDatabase,
  TablesUploadResponse,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

export const COUNTRIES: TableCountry[] = ["Singapore", "Malaysia", "Thailand", "Indonesia", "Vietnam"];
export const DATABASES: TableDatabase[] = ["PIB", "MBK", "SMS", "NTN", "LCM"];

function UploadTablesDialog({
  onUploaded,
  onClose,
}: {
  onUploaded: (response: TablesUploadResponse) => void;
  onClose: () => void;
}) {
  const [country, setCountry] = useState<TableCountry>("Singapore");
  const [database, setDatabase] = useState<TableDatabase>("PIB");
  const [schema, setSchema] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<RowError[]>([]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Please select an Excel (.xlsx) file.");
      return;
    }
    setBusy(true);
    setError("");
    setProblems([]);
    try {
      const body = new FormData();
      body.append("country", country);
      body.append("database", database);
      body.append("schema", schema.trim());
      body.append("file", file);
      const response = await api<TablesUploadResponse>("/api/tables/upload", { method: "POST", body });
      onUploaded(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      if (err instanceof ApiError) setProblems(err.errors);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Upload tables"
        className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <div>
          <h2 className="font-headline text-xl font-semibold">Upload Tables</h2>
          <p className="text-xs text-muted mt-1">
            Excel (.xlsx) sheet with columns: TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULL, PRIMARY_KEY, FOREIGN_KEY.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Country</span>
            <select
              className="field mt-1"
              aria-label="Country"
              value={country}
              disabled={busy}
              onChange={(event) => setCountry(event.target.value as TableCountry)}
            >
              {COUNTRIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Database</span>
            <select
              className="field mt-1"
              aria-label="Database"
              value={database}
              disabled={busy}
              onChange={(event) => setDatabase(event.target.value as TableDatabase)}
            >
              {DATABASES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Schema (optional)</span>
          <input
            className="field mt-1"
            aria-label="Schema"
            value={schema}
            disabled={busy}
            placeholder={`Defaults to ${database}`}
            onChange={(event) => setSchema(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Excel file (.xlsx)</span>
          <input
            className="field mt-1"
            type="file"
            aria-label="Excel file"
            accept=".xlsx"
            disabled={busy}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {error && <p className="text-alert text-sm">{error}</p>}
        {problems.length > 0 && (
          <ul className="max-h-40 overflow-auto rounded-lg border border-hairline p-3 text-alert text-xs space-y-1" aria-label="Upload problems">
            {problems.map((problem, index) => (
              <li key={index}>
                Row {problem.row}, {problem.field}: {problem.message}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload file"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MissingColumnsDialog({
  items,
  onDone,
}: {
  items: MissingColumnItem[];
  onDone: (deletedCount: number) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((item) => item.column_id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelected() {
    if (selected.size === 0) {
      onDone(0);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api<{ deleted: number }>("/api/tables/columns/delete-batch", {
        method: "POST",
        body: JSON.stringify({ column_ids: Array.from(selected) }),
      });
      onDone(res.deleted);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete columns");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Columns not in Excel"
        className="w-full max-w-2xl rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4"
      >
        <div>
          <h2 className="font-headline text-xl font-semibold">Columns not in the uploaded Excel</h2>
          <p className="text-sm text-muted mt-1">
            The following columns exist in the database for the uploaded tables, but were not present in the Excel file. Choose whether to delete them or keep them as-is.
          </p>
        </div>
        <div className="max-h-72 overflow-auto rounded border border-hairline">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline bg-inset font-label text-[10px] uppercase text-muted">
                <th className="py-2 px-3 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all missing columns"
                    checked={selected.size === items.length}
                    onChange={(event) =>
                      setSelected(event.target.checked ? new Set(items.map((item) => item.column_id)) : new Set())
                    }
                  />
                </th>
                <th className="py-2 px-3">Table</th>
                <th className="py-2 px-3">Column</th>
                <th className="py-2 px-3">Data Type</th>
                <th className="py-2 px-3">Description</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.column_id} className="border-b border-hairline last:border-b-0">
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.table_name}.${item.column_name}`}
                      checked={selected.has(item.column_id)}
                      onChange={() => toggle(item.column_id)}
                    />
                  </td>
                  <td className="py-2 px-3 font-label text-xs">{item.table_name}</td>
                  <td className="py-2 px-3 font-label text-xs">{item.column_name}</td>
                  <td className="py-2 px-3 text-muted text-xs">{item.data_type}</td>
                  <td className="py-2 px-3 text-muted text-xs">{item.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={() => onDone(0)}>
            Remain as-is
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || selected.size === 0}
            onClick={() => void deleteSelected()}
          >
            {busy ? "Deleting…" : `Delete selected (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function TableFormDialog({
  table,
  onSaved,
  onClose,
}: {
  table?: KbTableRecord;
  onSaved: (saved: KbTableRecord) => void;
  onClose: () => void;
}) {
  const editing = Boolean(table);
  const [country, setCountry] = useState<TableCountry>(table?.country ?? "Singapore");
  const [database, setDatabase] = useState<TableDatabase>(table?.database_name ?? "PIB");
  const [schema, setSchema] = useState(table?.schema_name ?? "");
  const [tableName, setTableName] = useState(table?.table_name ?? "");
  const [description, setDescription] = useState(table?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = table
        ? await api<KbTableRecord>(`/api/tables/${encodeURIComponent(table.table_id)}`, {
            method: "PATCH",
            body: JSON.stringify({ table_name: tableName.trim(), description: description.trim() }),
          })
        : await api<KbTableRecord>("/api/tables", {
            method: "POST",
            body: JSON.stringify({
              country,
              database_name: database,
              schema_name: schema.trim(),
              table_name: tableName.trim(),
              description: description.trim(),
            }),
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save table");
      setBusy(false);
    }
  }

  const title = editing ? "Edit table" : "Add table";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3"
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="font-headline text-xl font-semibold">{title}</h2>
        {!editing && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="font-label text-[10px] uppercase text-muted">Country</span>
                <select
                  className="field mt-1"
                  aria-label="Country"
                  value={country}
                  disabled={busy}
                  onChange={(event) => setCountry(event.target.value as TableCountry)}
                >
                  {COUNTRIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="font-label text-[10px] uppercase text-muted">Database</span>
                <select
                  className="field mt-1"
                  aria-label="Database"
                  value={database}
                  disabled={busy}
                  onChange={(event) => setDatabase(event.target.value as TableDatabase)}
                >
                  {DATABASES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="font-label text-[10px] uppercase text-muted">Schema (optional)</span>
              <input
                className="field mt-1"
                aria-label="Schema"
                value={schema}
                disabled={busy}
                placeholder={`Defaults to ${database}`}
                onChange={(event) => setSchema(event.target.value)}
              />
            </label>
          </>
        )}
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Table name</span>
          <input
            className="field mt-1"
            aria-label="Table name"
            value={tableName}
            required
            disabled={busy}
            onChange={(event) => setTableName(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea
            className="field mt-1 min-h-[80px]"
            aria-label="Table description"
            value={description}
            disabled={busy}
            placeholder="Leave blank to infer automatically"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !tableName.trim()}>
            {editing ? "Save" : "Add table"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ColumnFormDialog({
  tableId,
  column,
  onSaved,
  onClose,
}: {
  tableId: string;
  column?: KbColumnRecord;
  onSaved: (saved: KbColumnRecord) => void;
  onClose: () => void;
}) {
  const editing = Boolean(column);
  const [columnName, setColumnName] = useState(column?.column_name ?? "");
  const [dataType, setDataType] = useState(column?.data_type ?? "");
  const [isNull, setIsNull] = useState(column?.is_null ?? "N");
  const [primaryKey, setPrimaryKey] = useState(column?.primary_key ?? "");
  const [foreignKey, setForeignKey] = useState(column?.foreign_key ?? "");
  const [description, setDescription] = useState(column?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload = {
      column_name: columnName.trim(),
      data_type: dataType.trim(),
      is_null: isNull || "N",
      primary_key: primaryKey.trim(),
      foreign_key: foreignKey.trim(),
      description: description.trim(),
    };
    try {
      const saved = column
        ? await api<KbColumnRecord>(
            `/api/tables/${encodeURIComponent(tableId)}/columns/${encodeURIComponent(column.column_id)}`,
            { method: "PATCH", body: JSON.stringify(payload) },
          )
        : await api<KbColumnRecord>(`/api/tables/${encodeURIComponent(tableId)}/columns`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save column");
      setBusy(false);
    }
  }

  const title = editing ? "Edit column" : "Add column";
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3"
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="font-headline text-xl font-semibold">{title}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Column name</span>
            <input
              className="field mt-1"
              aria-label="Column name"
              value={columnName}
              required
              disabled={busy}
              onChange={(event) => setColumnName(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Data type</span>
            <input
              className="field mt-1"
              aria-label="Data type"
              value={dataType}
              required
              disabled={busy}
              placeholder="e.g. VARCHAR(50), NUMBER"
              onChange={(event) => setDataType(event.target.value)}
            />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Is Null</span>
            <select
              className="field mt-1"
              aria-label="Is Null"
              value={isNull}
              disabled={busy}
              onChange={(event) => setIsNull(event.target.value)}
            >
              <option value="N">N</option>
              <option value="Y">Y</option>
            </select>
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Primary key</span>
            <input
              className="field mt-1"
              aria-label="Primary key"
              value={primaryKey}
              disabled={busy}
              placeholder="e.g. Y or PK"
              onChange={(event) => setPrimaryKey(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Foreign key</span>
            <input
              className="field mt-1"
              aria-label="Foreign key"
              value={foreignKey}
              disabled={busy}
              placeholder="e.g. USERS.ID"
              onChange={(event) => setForeignKey(event.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea
            className="field mt-1 min-h-[70px]"
            aria-label="Column description"
            value={description}
            disabled={busy}
            placeholder="Leave blank to infer automatically"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !columnName.trim() || !dataType.trim()}>
            {editing ? "Save" : "Add column"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TableDetailsDialog({
  tableId,
  canEdit,
  onTableChanged,
  onClose,
}: {
  tableId: string;
  canEdit: boolean;
  onTableChanged: () => void;
  onClose: () => void;
}) {
  const [table, setTable] = useState<KbTableRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingTable, setEditingTable] = useState(false);
  const [columnForm, setColumnForm] = useState<{ column?: KbColumnRecord } | null>(null);
  const [deletingColumn, setDeletingColumn] = useState<KbColumnRecord | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    api<KbTableRecord>(`/api/tables/${encodeURIComponent(tableId)}`)
      .then(setTable)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load table details"))
      .finally(() => setLoading(false));
  }, [tableId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !editingTable && !columnForm && !deletingColumn) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editingTable, columnForm, deletingColumn]);

  async function removeColumn() {
    if (!deletingColumn || !table) return;
    await api(
      `/api/tables/${encodeURIComponent(table.table_id)}/columns/${encodeURIComponent(deletingColumn.column_id)}`,
      { method: "DELETE" },
    );
    const id = deletingColumn.column_id;
    setTable((current) =>
      current
        ? {
            ...current,
            columns: (current.columns ?? []).filter((col) => col.column_id !== id),
            column_count: Math.max(0, (current.column_count ?? 1) - 1),
          }
        : current,
    );
    setDeletingColumn(null);
    onTableChanged();
  }

  const columns = table?.columns ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={table ? `Table ${table.table_name}` : "Table details"}
        className="w-full max-w-5xl max-h-[88vh] flex flex-col rounded-lg border border-hairline bg-panel shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline p-5">
          <div className="min-w-0">
            {table ? (
              <>
                <div className="font-label text-[11px] uppercase text-muted">
                  {table.country} · {table.database_name} · {table.schema_name}
                </div>
                <h2 className="font-headline text-xl font-semibold mt-0.5">{table.table_name}</h2>
                <p className="text-sm text-muted mt-1">{table.description || "No description."}</p>
              </>
            ) : (
              <h2 className="font-headline text-xl font-semibold">Table details</h2>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canEdit && table && (
              <>
                <button type="button" className="btn" onClick={() => setEditingTable(true)}>
                  <span className="material-symbols-outlined text-base">edit</span>
                  Edit table
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setColumnForm({})}>
                  <span className="material-symbols-outlined text-base">add</span>
                  Add column
                </button>
              </>
            )}
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-5">
          {loading && <p className="text-muted">Loading…</p>}
          {error && <p className="text-alert">{error}</p>}
          {!loading && table && (
            <div className="rounded-lg border border-hairline overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-inset font-label text-[10px] uppercase text-muted">
                    <th className="py-2.5 px-3">Column Name</th>
                    <th className="py-2.5 px-3">Data Type</th>
                    <th className="py-2.5 px-3">Is Null</th>
                    <th className="py-2.5 px-3">Primary Key</th>
                    <th className="py-2.5 px-3">Foreign Key</th>
                    <th className="py-2.5 px-3">Description</th>
                    {canEdit && <th className="py-2.5 px-3 w-20" />}
                  </tr>
                </thead>
                <tbody>
                  {columns.length === 0 ? (
                    <tr>
                      <td colSpan={canEdit ? 7 : 6} className="py-6 px-3 text-center text-muted">
                        No columns yet.
                      </td>
                    </tr>
                  ) : (
                    columns.map((col) => (
                      <tr key={col.column_id} className="border-b border-hairline last:border-b-0">
                        <td className="py-2.5 px-3 font-label text-xs font-medium whitespace-nowrap">{col.column_name}</td>
                        <td className="py-2.5 px-3 font-label text-xs text-muted whitespace-nowrap">{col.data_type}</td>
                        <td className="py-2.5 px-3 text-xs whitespace-nowrap">{col.is_null}</td>
                        <td className="py-2.5 px-3 text-xs text-muted whitespace-nowrap">{col.primary_key || "—"}</td>
                        <td className="py-2.5 px-3 text-xs text-muted whitespace-nowrap">{col.foreign_key || "—"}</td>
                        <td className="py-2.5 px-3 text-muted max-w-md">{col.description || "—"}</td>
                        {canEdit && (
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="icon-btn"
                                aria-label={`Edit column ${col.column_name}`}
                                title="Edit column"
                                onClick={() => setColumnForm({ column: col })}
                              >
                                <span className="material-symbols-outlined text-base">edit</span>
                              </button>
                              <button
                                type="button"
                                className="icon-btn icon-btn-danger"
                                aria-label={`Delete column ${col.column_name}`}
                                title="Delete column"
                                onClick={() => setDeletingColumn(col)}
                              >
                                <span className="material-symbols-outlined text-base">delete</span>
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {editingTable && table && (
        <TableFormDialog
          table={table}
          onClose={() => setEditingTable(false)}
          onSaved={(saved) => {
            setTable((current) => (current ? { ...current, ...saved, columns: saved.columns ?? current.columns } : saved));
            setEditingTable(false);
            onTableChanged();
          }}
        />
      )}
      {columnForm && table && (
        <ColumnFormDialog
          tableId={table.table_id}
          column={columnForm.column}
          onClose={() => setColumnForm(null)}
          onSaved={(saved) => {
            setTable((current) => {
              if (!current) return current;
              const existing = current.columns ?? [];
              const exists = existing.some((item) => item.column_id === saved.column_id);
              const nextCols = exists
                ? existing.map((item) => (item.column_id === saved.column_id ? saved : item))
                : [...existing, saved];
              return { ...current, columns: nextCols, column_count: nextCols.length };
            });
            setColumnForm(null);
            onTableChanged();
          }}
        />
      )}
      {deletingColumn && (
        <ConfirmDialog
          title="Delete column"
          message={`Delete column ${deletingColumn.column_name}? This cannot be undone.`}
          onConfirm={removeColumn}
          onClose={() => setDeletingColumn(null)}
        />
      )}
    </div>
  );
}

type SchemaGroup = {
  key: string;
  country: TableCountry;
  database: TableDatabase;
  schema: string;
  tables: KbTableRecord[];
};

export function TablesPanel() {
  const auth = useOptionalAuth();
  const canEdit = auth?.user?.role_name !== "Viewer";
  const [tables, setTables] = useState<KbTableRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [databaseFilter, setDatabaseFilter] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [missingColumns, setMissingColumns] = useState<MissingColumnItem[] | null>(null);
  const [tableForm, setTableForm] = useState<{ table?: KbTableRecord } | null>(null);
  const [deletingTable, setDeletingTable] = useState<KbTableRecord | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api<KbTableRecord[]>("/api/tables")
      .then((data) => {
        setTables(data);
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load tables"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function removeTable() {
    if (!deletingTable) return;
    await api(`/api/tables/${encodeURIComponent(deletingTable.table_id)}`, { method: "DELETE" });
    const id = deletingTable.table_id;
    setTables((current) => current.filter((item) => item.table_id !== id));
    setDeletingTable(null);
  }

  const groups = useMemo<SchemaGroup[]>(() => {
    const query = search.trim().toLowerCase();
    const filtered = tables.filter((item) => {
      if (countryFilter && item.country !== countryFilter) return false;
      if (databaseFilter && item.database_name !== databaseFilter) return false;
      if (!query) return true;
      return `${item.country} ${item.database_name} ${item.schema_name} ${item.table_name} ${item.description}`
        .toLowerCase()
        .includes(query);
    });
    const map = new Map<string, SchemaGroup>();
    for (const row of filtered) {
      const key = `${row.country}|${row.database_name}|${row.schema_name}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          country: row.country,
          database: row.database_name,
          schema: row.schema_name,
          tables: [],
        };
        map.set(key, group);
      }
      group.tables.push(row);
    }
    return Array.from(map.values());
  }, [tables, search, countryFilter, databaseFilter]);

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">Tables</h1>
        <p className="text-muted mt-0.5">
          Database tables and columns organized by country, database and schema. Click a table to view or edit its columns.
        </p>
      </div>
      {error && <p className="text-alert">{error}</p>}
      {notice && (
        <p className="text-accent" role="status">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <label className="relative flex-1 min-w-[200px] max-w-sm block">
            <span className="sr-only">Search Tables</span>
            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
              search
            </span>
            <input
              className="field pl-9"
              type="search"
              aria-label="Search Tables"
              placeholder="Search tables"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            className="field w-auto min-w-[9rem]"
            aria-label="Filter by country"
            value={countryFilter}
            onChange={(event) => setCountryFilter(event.target.value)}
          >
            <option value="">All countries</option>
            {COUNTRIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className="field w-auto min-w-[8rem]"
            aria-label="Filter by database"
            value={databaseFilter}
            onChange={(event) => setDatabaseFilter(event.target.value)}
          >
            <option value="">All databases</option>
            {DATABASES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button type="button" className="btn" onClick={() => setTableForm({})}>
              <span className="material-symbols-outlined text-base">add</span>
              Add table
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>
              <span className="material-symbols-outlined text-base">upload</span>
              Upload
            </button>
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="bg-panel border border-hairline rounded-lg p-6 text-muted">
          {loading ? "Loading…" : "No tables found."}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="bg-panel border border-hairline rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-hairline bg-inset px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span>{group.country}</span>
                  <span className="text-muted">/</span>
                  <span className="font-label text-xs text-accent">{group.database}</span>
                  <span className="text-muted">/</span>
                  <span className="font-label text-xs">{group.schema}</span>
                </div>
                <span className="font-label text-[11px] text-muted">
                  {group.tables.length} {group.tables.length === 1 ? "table" : "tables"}
                </span>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-hairline font-label text-[10px] uppercase text-muted">
                    <th className="py-2.5 px-3 w-72">Table Name</th>
                    <th className="py-2.5 px-3">Description</th>
                    {canEdit && <th className="py-2.5 px-3 w-24" />}
                  </tr>
                </thead>
                <tbody>
                  {group.tables.map((row) => (
                    <tr key={row.table_id} className="border-b border-hairline last:border-b-0 hover:bg-inset/50">
                      <td className="py-2.5 px-3 font-label text-xs font-medium whitespace-nowrap">
                        <button
                          type="button"
                          className="text-left text-accent hover:underline"
                          onClick={() => setInspectingId(row.table_id)}
                        >
                          {row.table_name}
                        </button>
                      </td>
                      <td
                        className="py-2.5 px-3 text-muted cursor-pointer"
                        onClick={() => setInspectingId(row.table_id)}
                      >
                        {row.description || "—"}
                      </td>
                      {canEdit && (
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Edit ${row.table_name}`}
                              title="Edit table"
                              onClick={() => setTableForm({ table: row })}
                            >
                              <span className="material-symbols-outlined text-base">edit</span>
                            </button>
                            <button
                              type="button"
                              className="icon-btn icon-btn-danger"
                              aria-label={`Delete ${row.table_name}`}
                              title="Delete table"
                              onClick={() => setDeletingTable(row)}
                            >
                              <span className="material-symbols-outlined text-base">delete</span>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {uploading && (
        <UploadTablesDialog
          onClose={() => setUploading(false)}
          onUploaded={(response) => {
            setTables(response.tables);
            setUploading(false);
            setNotice(
              `Uploaded ${response.uploaded_tables} table${response.uploaded_tables === 1 ? "" : "s"} (${response.uploaded_columns} column${response.uploaded_columns === 1 ? "" : "s"}).`,
            );
            if (response.missing_columns.length > 0) {
              setMissingColumns(response.missing_columns);
            }
          }}
        />
      )}

      {missingColumns && (
        <MissingColumnsDialog
          items={missingColumns}
          onDone={(deleted) => {
            setMissingColumns(null);
            if (deleted > 0) {
              setNotice((prev) => `${prev ? `${prev} ` : ""}Deleted ${deleted} column${deleted === 1 ? "" : "s"} not in Excel.`);
              load();
            }
          }}
        />
      )}

      {tableForm && (
        <TableFormDialog
          table={tableForm.table}
          onClose={() => setTableForm(null)}
          onSaved={(saved) => {
            setTables((current) => {
              const exists = current.some((item) => item.table_id === saved.table_id);
              return exists ? current.map((item) => (item.table_id === saved.table_id ? saved : item)) : [...current, saved];
            });
            setTableForm(null);
          }}
        />
      )}

      {deletingTable && (
        <ConfirmDialog
          title="Delete table"
          message={`Delete table ${deletingTable.table_name} (${deletingTable.country} / ${deletingTable.database_name} / ${deletingTable.schema_name}) and all its columns? This cannot be undone.`}
          onConfirm={removeTable}
          onClose={() => setDeletingTable(null)}
        />
      )}

      {inspectingId && (
        <TableDetailsDialog
          tableId={inspectingId}
          canEdit={canEdit}
          onTableChanged={load}
          onClose={() => setInspectingId(null)}
        />
      )}
    </div>
  );
}
