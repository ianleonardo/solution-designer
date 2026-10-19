import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, formatDateTime } from "../../api";
import { type Column, DataTable } from "../../components/DataTable";
import type { AuditEntry } from "../../types";

export const AUDIT_PAGE_SIZE = 30;

function words(action: string) {
  const text = action.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A complete DD/MM/YYYY value, or null while it is incomplete or not a real date. */
function isoFromDay(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function detailText(entry: AuditEntry) {
  const parts: Record<string, unknown> = { ...(entry.detail ?? {}) };
  if (entry.method && entry.path) parts.request_line = `${entry.method} ${entry.path}`;
  if (entry.ip_address) parts.ip_address = entry.ip_address;
  return JSON.stringify(parts, null, 2);
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [sinceText, setSinceText] = useState("");
  const [untilText, setUntilText] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const query = new URLSearchParams();
    if (action) query.set("action", action);
    if (since) query.set("since", since);
    if (until) query.set("until", until);
    setLoading(true);
    api<AuditEntry[]>(`/api/audit?${query.toString()}`)
      .then((rows) => {
        setEntries(rows);
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load the audit log"))
      .finally(() => setLoading(false));
  }, [action, since, until, reload]);

  useEffect(() => {
    api<string[]>("/api/audit/actions")
      .then(setActions)
      .catch(() => setActions([]));
  }, [reload]);

  const columns: Column<AuditEntry>[] = [
    { key: "when", header: "When", sortValue: (row) => row.occurred_at, className: "whitespace-nowrap text-muted", render: (row) => formatDateTime(row.occurred_at) },
    {
      key: "user",
      header: "User",
      sortValue: (row) => row.login_id ?? row.username ?? "",
      className: "whitespace-nowrap",
      render: (row) => (
        <div>
          <div className="font-medium">{row.login_id ?? "unknown"}</div>
          {row.role_name && <span className="text-[10px] uppercase text-muted">{row.role_name}</span>}
        </div>
      ),
    },
    { key: "action", header: "Action", sortValue: (row) => row.action, className: "whitespace-nowrap", render: (row) => words(row.action) },
    {
      key: "entity",
      header: "Entity",
      sortValue: (row) => row.entity_type ?? "",
      render: (row) =>
        row.entity_type ? (
          <div>
            <span className="capitalize">{row.entity_type}</span>
            {row.entity_id && <div className="max-w-[12rem] truncate font-label text-[11px] text-muted" title={row.entity_id}>{row.entity_id}</div>}
          </div>
        ) : (
          "—"
        ),
    },
    { key: "summary", header: "Summary", sortValue: (row) => row.summary, className: "min-w-[16rem]", render: (row) => row.summary },
    {
      key: "details",
      header: "Details",
      render: (row) => (
        <details>
          <summary className="cursor-pointer text-muted hover:text-ink">View</summary>
          <pre className="mt-1 max-w-md overflow-auto whitespace-pre-wrap rounded bg-inset p-2 font-label text-[11px]">{detailText(row)}</pre>
        </details>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-headline text-2xl font-semibold">Audit Log</h1>
          <p className="text-sm text-muted">Who changed what, and when. Newest first; the latest 2,000 matching entries are shown.</p>
        </div>
        <button type="button" className="btn btn-danger shrink-0" onClick={() => setPurging(true)}>
          Purge logs
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase text-muted">Action</span>
          <select className="field mt-1 min-w-[11rem]" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">All actions</option>
            {actions.map((item) => (
              <option key={item} value={item}>
                {words(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase text-muted">From</span>
          <input
            className="field"
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            aria-label="From"
            maxLength={10}
            value={sinceText}
            onChange={(event) => {
              const next = event.target.value;
              setSinceText(next);
              setSince((current) => (next.trim() ? isoFromDay(next) ?? current : ""));
            }}
          />
        </label>
        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase text-muted">To</span>
          <input
            className="field"
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            aria-label="To"
            maxLength={10}
            value={untilText}
            onChange={(event) => {
              const next = event.target.value;
              setUntilText(next);
              setUntil((current) => (next.trim() ? isoFromDay(next) ?? current : ""));
            }}
          />
        </label>
        {(action || sinceText || untilText) && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAction("");
              setSinceText("");
              setUntilText("");
              setSince("");
              setUntil("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {error && <p className="text-alert">{error}</p>}
      {loading && entries.length === 0 && !error && <p className="text-muted">Loading…</p>}
      <DataTable
        rows={entries}
        columns={columns}
        rowKey={(row) => row.audit_id}
        pageSize={AUDIT_PAGE_SIZE}
        emptyLabel="No audit entries."
        searchText={(row) => `${row.login_id ?? ""} ${row.username ?? ""} ${row.role_name ?? ""} ${row.action} ${row.entity_type ?? ""} ${row.entity_id ?? ""} ${row.summary}`}
        searchLabel="Search audit log"
        searchPlaceholder="Search audit log"
      />
      {purging && <PurgeDialog onClose={() => setPurging(false)} onPurged={() => setReload((current) => current + 1)} />}
    </div>
  );
}

function PurgeDialog({ onClose, onPurged }: { onClose: () => void; onPurged: () => void }) {
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
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
    const since = isoFromDay(fromText);
    const until = isoFromDay(toText);
    if (!since || !until) {
      setError("Enter the from and to dates as DD/MM/YYYY.");
      return;
    }
    if (since > until) {
      setError("The from date must be on or before the to date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/audit/purge", { method: "POST", body: JSON.stringify({ since, until }) });
      onPurged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not purge the audit log");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label="Purge audit log" className="w-full max-w-md rounded-lg border border-hairline bg-panel p-6 shadow-xl" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-xl font-semibold mb-2">Purge audit log</h2>
        <p className="text-sm text-muted mb-4">Entries on these dates are deleted. This cannot be undone.</p>
        <div className="flex gap-3 mb-4">
          <label className="block flex-1 text-sm">
            <span className="block font-label text-[10px] uppercase text-muted">From</span>
            <input className="field mt-1 w-full" type="text" inputMode="numeric" placeholder="DD/MM/YYYY" aria-label="Purge from" maxLength={10} value={fromText} onChange={(event) => setFromText(event.target.value)} autoFocus disabled={busy} />
          </label>
          <label className="block flex-1 text-sm">
            <span className="block font-label text-[10px] uppercase text-muted">To</span>
            <input className="field mt-1 w-full" type="text" inputMode="numeric" placeholder="DD/MM/YYYY" aria-label="Purge to" maxLength={10} value={toText} onChange={(event) => setToText(event.target.value)} disabled={busy} />
          </label>
        </div>
        {error && <p className="text-alert mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            Purge
          </button>
        </div>
      </form>
    </div>
  );
}
