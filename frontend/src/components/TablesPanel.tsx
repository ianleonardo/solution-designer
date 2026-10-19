import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type {
  Catalogs,
  KbColumnRecord,
  KbTableRecord,
  MissingColumnItem,
  TableCompareResult,
  TablesUploadResponse,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { SelectField } from "./SelectField";
import { SortHeader, sortRows, toggleColumnSort, type ColumnSort } from "./SortHeader";
import { PageSlice, TablePager, usePageWindow } from "./TablePager";

const DEFAULT_COUNTRIES = ["SG", "MY", "TH", "VN", "ID"];
const DEFAULT_DATABASES = ["PIB", "MBK", "SMS", "NTN", "WSM", "LCM"];

function UploadTablesDialog({
  countries,
  databases,
  onUploaded,
  onClose,
}: {
  countries: string[];
  databases: string[];
  onUploaded: (response: TablesUploadResponse) => void;
  onClose: () => void;
}) {
  const [country, setCountry] = useState(countries.includes("SG") ? "SG" : countries[0] ?? "SG");
  const [database, setDatabase] = useState(databases[0] ?? "PIB");
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
            <div className="mt-1">
              <SelectField
                aria-label="Country"
                value={country}
                disabled={busy}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={countries.map((item) => ({ value: item, label: item }))}
                onChange={setCountry}
              />
            </div>
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Database</span>
            <div className="mt-1">
              <SelectField
                aria-label="Database"
                value={database}
                disabled={busy}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={databases.map((item) => ({ value: item, label: item }))}
                onChange={setDatabase}
              />
            </div>
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
  countries,
  databases,
  onSaved,
  onClose,
}: {
  table?: KbTableRecord;
  countries: string[];
  databases: string[];
  onSaved: (saved: KbTableRecord) => void;
  onClose: () => void;
}) {
  const editing = Boolean(table);
  const [country, setCountry] = useState(table?.country ?? (countries.includes("SG") ? "SG" : countries[0] ?? "SG"));
  const [database, setDatabase] = useState(table?.database_name ?? databases[0] ?? "PIB");
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
    const name = tableName.trim().toUpperCase();
    try {
      const saved = table
        ? await api<KbTableRecord>(`/api/tables/${encodeURIComponent(table.table_id)}`, {
            method: "PATCH",
            body: JSON.stringify({ table_name: name, description: description.trim() }),
          })
        : await api<KbTableRecord>("/api/tables", {
            method: "POST",
            body: JSON.stringify({
              country,
              database_name: database,
              schema_name: schema.trim(),
              table_name: name,
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
                <div className="mt-1">
                  <SelectField
                    aria-label="Country"
                    value={country}
                    disabled={busy}
                    className="w-full [&_button]:w-full [&_button]:max-w-none"
                    options={countries.map((item) => ({ value: item, label: item }))}
                    onChange={setCountry}
                  />
                </div>
              </label>
              <label className="block">
                <span className="font-label text-[10px] uppercase text-muted">Database</span>
                <div className="mt-1">
                  <SelectField
                    aria-label="Database"
                    value={database}
                    disabled={busy}
                    className="w-full [&_button]:w-full [&_button]:max-w-none"
                    options={databases.map((item) => ({ value: item, label: item }))}
                    onChange={setDatabase}
                  />
                </div>
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
            onBlur={() => setTableName((value) => value.trim().toUpperCase())}
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
      column_name: columnName.trim().toUpperCase(),
      data_type: dataType.trim().toUpperCase(),
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
              onBlur={() => setColumnName((value) => value.trim().toUpperCase())}
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
              onBlur={() => setDataType((value) => value.trim().toUpperCase())}
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
  const columnPage = usePageWindow(columns.length, tableId);
  const visibleColumns = columns.slice(columnPage.start, columnPage.end);

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
                    visibleColumns.map((col) => (
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
          {!loading && table && <TablePager paging={columnPage} />}
        </div>
      </div>
      {editingTable && table && (
        <TableFormDialog
          table={table}
          countries={DEFAULT_COUNTRIES}
          databases={DEFAULT_DATABASES}
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
  country: string;
  database: string;
  schema: string;
  tables: KbTableRecord[];
};

function TableCompareDialog({
  databases,
  schemaOptions,
  onClose,
}: {
  databases: string[];
  schemaOptions: { database: string; schema: string }[];
  onClose: () => void;
}) {
  const [database, setDatabase] = useState(databases[0] ?? "");
  const schemasForDb = useMemo(
    () => schemaOptions.filter((item) => item.database === database).map((item) => item.schema),
    [schemaOptions, database],
  );
  const [schema, setSchema] = useState(schemasForDb[0] ?? "");
  const [result, setResult] = useState<TableCompareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSchema(schemasForDb[0] ?? database);
  }, [database, schemasForDb]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function runCompare(event: FormEvent) {
    event.preventDefault();
    if (!database.trim()) {
      setError("Select a database.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const params = new URLSearchParams({ database, schema: schema.trim() || database });
      const data = await api<TableCompareResult>(`/api/tables/compare?${params}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Comparison failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Table Comparison"
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-lg border border-hairline bg-panel shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline p-5">
          <div>
            <h2 className="font-headline text-xl font-semibold">Table Comparison</h2>
            <p className="text-sm text-muted mt-1">Compare tables and columns across countries for a database and schema.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form className="flex flex-nowrap items-end gap-3 border-b border-hairline px-5 py-4 overflow-x-auto" onSubmit={(event) => void runCompare(event)}>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Database</span>
            <div className="mt-1">
              <SelectField
                aria-label="Compare database"
                value={database}
                disabled={busy}
                options={databases.map((item) => ({ value: item, label: item }))}
                onChange={setDatabase}
              />
            </div>
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Schema</span>
            <div className="mt-1">
              <SelectField
                aria-label="Compare schema"
                value={schema}
                disabled={busy || schemasForDb.length === 0}
                options={
                  schemasForDb.length === 0
                    ? [{ value: database, label: database || "—" }]
                    : schemasForDb.map((item) => ({ value: item, label: item }))
                }
                onChange={setSchema}
              />
            </div>
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !database}>
            {busy ? "Comparing…" : "Compare"}
          </button>
        </form>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {error && <p className="text-alert text-sm">{error}</p>}
          {result && (
            <>
              <p className="text-sm text-muted">
                {result.database} / {result.schema} · countries with data:{" "}
                {result.countries.length ? result.countries.join(", ") : "none"}
              </p>
              <section>
                <h3 className="font-headline text-base font-semibold">Missing tables</h3>
                {result.missing_tables.length === 0 ? (
                  <p className="text-sm text-muted mt-1">No missing tables among countries that have this database/schema.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {result.missing_tables.map((item) => (
                      <li key={item.table_name} className="rounded border border-hairline bg-inset px-3 py-2">
                        <span className="font-label text-xs font-medium">{item.table_name}</span>
                        <div className="text-muted text-xs mt-0.5">
                          Present in {item.present_in.join(", ") || "—"}; missing in {item.missing_in.join(", ")}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="font-headline text-base font-semibold">Column differences</h3>
                {result.column_diffs.length === 0 ? (
                  <p className="text-sm text-muted mt-1">No column name or data type differences.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {result.column_diffs.map((item) => (
                      <li key={`${item.table_name}.${item.column_name}`} className="rounded border border-hairline bg-inset px-3 py-2">
                        <span className="font-label text-xs font-medium">
                          {item.table_name}.{item.column_name}
                        </span>
                        <div className="text-muted text-xs mt-0.5">
                          {Object.entries(item.data_types)
                            .map(([country, dtype]) => `${country}: ${dtype}`)
                            .join(" · ")}
                          {item.missing_in.length > 0 ? `; missing in ${item.missing_in.join(", ")}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
          {!result && !error && !busy && <p className="text-muted text-sm">Select a database and schema, then run Compare.</p>}
        </div>
      </div>
    </div>
  );
}

export function TablesPanel() {
  const auth = useOptionalAuth();
  const canEdit = auth?.user?.role_name !== "Viewer";
  const [catalogs, setCatalogs] = useState<Catalogs>({
    countries: DEFAULT_COUNTRIES,
    databases: DEFAULT_DATABASES,
    interface_channels: [],
    bitbucket_projects: [],
  });
  const [tables, setTables] = useState<KbTableRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [searchParams] = useSearchParams();
  const countryFromUrl = searchParams.get("country");
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState(countryFromUrl || "SG");
  const [databaseFilter, setDatabaseFilter] = useState("");
  const [schemaFilter, setSchemaFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [missingColumns, setMissingColumns] = useState<MissingColumnItem[] | null>(null);
  const [tableForm, setTableForm] = useState<{ table?: KbTableRecord } | null>(null);
  const [deletingTable, setDeletingTable] = useState<KbTableRecord | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [sort, setSort] = useState<ColumnSort>(null);
  const [filtersReady, setFiltersReady] = useState(false);

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
    api<Catalogs>("/api/catalogs")
      .then((data) => {
        const countries = data.countries?.length ? data.countries : DEFAULT_COUNTRIES;
        const databases = data.databases?.length ? data.databases : DEFAULT_DATABASES;
        setCatalogs({
          countries,
          databases,
          interface_channels: data.interface_channels ?? [],
          bitbucket_projects: data.bitbucket_projects ?? [],
        });
        setCountryFilter((current) => {
          if (countryFromUrl && (countries.includes(countryFromUrl) || countryFromUrl === "Unspecified")) return countryFromUrl;
          if (countries.includes(current)) return current;
          return countries.includes("SG") ? "SG" : countries[0] ?? "SG";
        });
      })
      .catch(() => undefined);
    load();
  }, [countryFromUrl]);

  const catalogDatabases = catalogs.databases.length ? catalogs.databases : DEFAULT_DATABASES;

  const databasesForCountry = useMemo(() => {
    const allowed = new Set(catalogDatabases);
    const present = new Set(
      tables.filter((item) => item.country === countryFilter).map((item) => item.database_name),
    );
    return catalogDatabases.filter((name) => allowed.has(name) && present.has(name));
  }, [tables, countryFilter, catalogDatabases]);

  const schemasForSelection = useMemo(() => {
    if (!databaseFilter) return [] as string[];
    const schemas = new Set(
      tables
        .filter((item) => item.country === countryFilter && item.database_name === databaseFilter)
        .map((item) => item.schema_name),
    );
    return Array.from(schemas).sort((a, b) => a.localeCompare(b));
  }, [tables, countryFilter, databaseFilter]);

  useEffect(() => {
    if (loading) return;
    setDatabaseFilter((current) => (current && databasesForCountry.includes(current) ? current : databasesForCountry[0] ?? ""));
    setFiltersReady(true);
  }, [countryFilter, databasesForCountry, loading]);

  useEffect(() => {
    if (!filtersReady) return;
    setSchemaFilter((current) => (current && schemasForSelection.includes(current) ? current : schemasForSelection[0] ?? ""));
  }, [databaseFilter, schemasForSelection, filtersReady]);

  async function removeTable() {
    if (!deletingTable) return;
    await api(`/api/tables/${encodeURIComponent(deletingTable.table_id)}`, { method: "DELETE" });
    const id = deletingTable.table_id;
    setTables((current) => current.filter((item) => item.table_id !== id));
    setDeletingTable(null);
  }

  const compareDatabases = useMemo(() => {
    const allowed = new Set(catalogDatabases);
    const present = new Set(tables.map((item) => item.database_name).filter((name) => allowed.has(name)));
    return catalogDatabases.filter((name) => present.has(name));
  }, [tables, catalogDatabases]);

  const compareSchemaOptions = useMemo(() => {
    const map = new Map<string, { database: string; schema: string }>();
    for (const row of tables) {
      const key = `${row.database_name}|${row.schema_name}`;
      if (!map.has(key)) map.set(key, { database: row.database_name, schema: row.schema_name });
    }
    return Array.from(map.values());
  }, [tables]);

  const groups = useMemo<SchemaGroup[]>(() => {
    const query = search.trim().toLowerCase();
    const filtered = tables.filter((item) => {
      if (countryFilter && item.country !== countryFilter) return false;
      if (databaseFilter && item.database_name !== databaseFilter) return false;
      if (schemaFilter && item.schema_name !== schemaFilter) return false;
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
  }, [tables, search, countryFilter, databaseFilter, schemaFilter]);

  const countries = catalogs.countries.length ? catalogs.countries : DEFAULT_COUNTRIES;
  const countryOptions = countryFilter && !countries.includes(countryFilter) ? [...countries, countryFilter] : countries;
  const allDatabases = catalogs.databases.length ? catalogs.databases : DEFAULT_DATABASES;

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
      <div className="flex flex-nowrap items-center gap-2">
        <SelectField
          aria-label="Filter by country"
          value={countryFilter}
          options={countryOptions.map((item) => ({ value: item, label: item }))}
          onChange={(next) => {
            setFiltersReady(false);
            setCountryFilter(next);
          }}
        />
        <SelectField
          aria-label="Filter by database"
          value={databaseFilter}
          disabled={databasesForCountry.length === 0}
          options={
            databasesForCountry.length === 0
              ? [{ value: "", label: "No databases" }]
              : databasesForCountry.map((item) => ({ value: item, label: item }))
          }
          onChange={setDatabaseFilter}
        />
        <SelectField
          aria-label="Filter by schema"
          value={schemaFilter}
          disabled={schemasForSelection.length === 0}
          options={
            schemasForSelection.length === 0
              ? [{ value: "", label: "No schemas" }]
              : schemasForSelection.map((item) => ({ value: item, label: item }))
          }
          onChange={setSchemaFilter}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="field flex-1 min-w-[200px] max-w-md"
          type="search"
          aria-label="Search Tables"
          placeholder="Search tables"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {canEdit && (
          <>
            <button type="button" className="btn" onClick={() => setTableForm({})}>
              <span className="material-symbols-outlined text-base">add</span>
              Add table
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>
              <span className="material-symbols-outlined text-base">upload</span>
              Upload
            </button>
          </>
        )}
        <button type="button" className="btn" onClick={() => setComparing(true)}>
          <span className="material-symbols-outlined text-base">compare_arrows</span>
          Table Comparison
        </button>
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
              <PageSlice rows={sortRows(group.tables, sort, (row) => row.table_name)} resetKey={`${search}|${sort?.key ?? ""}|${sort?.dir ?? ""}`}>
                {(visible, pager) => (
                  <>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-hairline font-label text-[10px] uppercase text-muted">
                    <th className="py-2.5 px-3 w-72" aria-sort={sort?.key === "table_name" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <SortHeader label="Table Name" active={sort?.key === "table_name" ? sort.dir : null} onClick={() => setSort((current) => toggleColumnSort(current, "table_name"))} />
                    </th>
                    <th className="py-2.5 px-3">Description</th>
                    {canEdit && <th className="py-2.5 px-3 w-24" />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
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
              {pager}
                  </>
                )}
              </PageSlice>
            </section>
          ))}
        </div>
      )}

      {uploading && (
        <UploadTablesDialog
          countries={countries}
          databases={allDatabases}
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

      {comparing && (
        <TableCompareDialog
          databases={compareDatabases.length ? compareDatabases : allDatabases}
          schemaOptions={compareSchemaOptions}
          onClose={() => setComparing(false)}
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
          countries={countries}
          databases={allDatabases}
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
