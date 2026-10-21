import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { SystemRecord } from "../types";

type Impact = {
  system_code: string;
  system_name: string;
  capabilities: { capability_id: string; country: string; l1_capability: string; l2_capability: string; l3_capability: string }[];
  batches: { batch_id: string; country: string; batch_name: string }[];
  reports: { report_id: string; country: string; report_name: string }[];
  interfaces_kept: { interface_id: string; channel: string; interface_name: string }[];
  unlinked_tables: { table_id: string; database_name: string; schema_name: string; table_name: string }[];
  systems_referencing: string[];
  batches_referencing: string[];
  projects_in_scope: string[];
};

const SHOWN = 8;

function ItemList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 ml-5 list-disc text-xs text-muted space-y-0.5">
      {items.slice(0, SHOWN).map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
      {items.length > SHOWN && <li>and {items.length - SHOWN} more</li>}
    </ul>
  );
}

function Line({ count, label, items, tone }: { count: number; label: string; items: string[]; tone: "delete" | "change" | "keep" }) {
  if (count === 0) return null;
  const color = tone === "delete" ? "text-alert" : tone === "change" ? "text-[#c77700]" : "text-muted";
  return (
    <li>
      <span className={`font-semibold tabular-nums ${color}`}>{count}</span> <span className="text-sm">{label}</span>
      <ItemList items={items} />
    </li>
  );
}

/** A loud, two-step delete: shows everything that goes with the system, then asks for its code to be typed. */
export function DeleteSystemDialog({ system, onDeleted, onClose }: { system: SystemRecord; onDeleted: () => void; onClose: () => void }) {
  const code = system.system_code;
  const [impact, setImpact] = useState<Impact | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    api<Impact>(`/api/systems/${encodeURIComponent(code)}/delete-impact`)
      .then((loaded) => current && setImpact(loaded))
      .catch((err: unknown) => current && setError(err instanceof ApiError ? err.message : "Could not check what would be deleted"));
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      current = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [code]);

  const deleting = impact ? impact.capabilities.length + impact.batches.length + impact.reports.length : 0;
  const matches = typed.trim().toUpperCase() === code.toUpperCase();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/systems/${encodeURIComponent(code)}?confirm=${encodeURIComponent(typed.trim())}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the system");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form
        role="alertdialog"
        aria-modal="true"
        aria-label={`Delete system ${code}`}
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border-2 border-[var(--alert,#b42318)] bg-panel shadow-2xl"
        onSubmit={(event) => void submit(event)}
      >
        <div className="flex items-start gap-3 rounded-t-[10px] bg-[#b42318] px-5 py-4 text-white">
          <span className="material-symbols-outlined text-4xl leading-none" aria-hidden="true">
            warning
          </span>
          <div>
            <h2 className="font-headline text-xl font-bold">Delete system {code}?</h2>
            <p className="text-sm text-white/90">
              {system.system_name}. This permanently deletes the system and everything that belongs to it. It cannot be undone.
            </p>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {!impact && !error && <p className="text-sm text-muted">Checking what would be deleted…</p>}
          {impact && (
            <>
              <section>
                <h3 className="font-label text-[11px] uppercase text-alert">Will be deleted</h3>
                {deleting === 0 ? (
                  <p className="mt-1 text-sm text-muted">Only the system itself. Nothing else belongs to it.</p>
                ) : (
                  <ul className="mt-1 space-y-2">
                    <Line
                      tone="delete"
                      count={impact.capabilities.length}
                      label={impact.capabilities.length === 1 ? "capability (and its links)" : "capabilities (and their links)"}
                      items={impact.capabilities.map((row) => `${row.l1_capability} › ${row.l2_capability} › ${row.l3_capability} (${row.country || "All"})`)}
                    />
                    <Line tone="delete" count={impact.batches.length} label={impact.batches.length === 1 ? "batch" : "batches"} items={impact.batches.map((row) => `${row.batch_name} (${row.country})`)} />
                    <Line tone="delete" count={impact.reports.length} label={impact.reports.length === 1 ? "report" : "reports"} items={impact.reports.map((row) => `${row.report_name} (${row.country})`)} />
                  </ul>
                )}
              </section>
              {(impact.unlinked_tables.length > 0 || impact.systems_referencing.length > 0 || impact.batches_referencing.length > 0 || impact.projects_in_scope.length > 0) && (
                <section>
                  <h3 className="font-label text-[11px] uppercase text-[#c77700]">Will be changed</h3>
                  <ul className="mt-1 space-y-2">
                    <Line
                      tone="change"
                      count={impact.unlinked_tables.length}
                      label={`${impact.unlinked_tables.length === 1 ? "table is" : "tables are"} unlinked from those capabilities (the tables are kept)`}
                      items={impact.unlinked_tables.map((row) => [row.database_name, row.schema_name, row.table_name].filter(Boolean).join("."))}
                    />
                    <Line tone="change" count={impact.systems_referencing.length} label={`other ${impact.systems_referencing.length === 1 ? "system lists" : "systems list"} ${code} as upstream or downstream; it is removed there`} items={impact.systems_referencing} />
                    <Line tone="change" count={impact.batches_referencing.length} label={`other ${impact.batches_referencing.length === 1 ? "batch lists" : "batches list"} ${code} in To/From; it is removed there`} items={impact.batches_referencing} />
                    <Line tone="change" count={impact.projects_in_scope.length} label={`${impact.projects_in_scope.length === 1 ? "project has" : "projects have"} ${code} in scope; it is removed there`} items={impact.projects_in_scope} />
                  </ul>
                </section>
              )}
              {impact.interfaces_kept.length > 0 && (
                <section>
                  <h3 className="font-label text-[11px] uppercase text-muted">Kept</h3>
                  <ul className="mt-1 space-y-2">
                    <Line
                      tone="keep"
                      count={impact.interfaces_kept.length}
                      label={`${impact.interfaces_kept.length === 1 ? "interface uses" : "interfaces use"} ${code} as source or destination; ${impact.interfaces_kept.length === 1 ? "it is" : "they are"} kept as is`}
                      items={impact.interfaces_kept.map((row) => `${row.interface_name} (${row.channel})`)}
                    />
                  </ul>
                </section>
              )}
            </>
          )}

          <label className="block rounded-lg border border-hairline bg-inset/50 p-3">
            <span className="text-sm">
              Type <strong className="font-label">{code}</strong> to confirm.
            </span>
            <input
              className="field mt-2"
              aria-label="Type the system code to confirm"
              value={typed}
              autoFocus
              autoComplete="off"
              disabled={busy || !impact}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
          {error && <p className="text-alert text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy || !impact || !matches}>
              {busy ? "Deleting…" : deleting ? `Delete ${code} and ${deleting} item${deleting === 1 ? "" : "s"}` : `Delete ${code}`}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
