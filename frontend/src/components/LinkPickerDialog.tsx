import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "../api";
import { SortHeader, sortRows, toggleColumnSort, type ColumnSort } from "./SortHeader";
import { PageSlice } from "./TablePager";

export type LinkPickerRow = {
  id: string;
  /** Short name used for the checkbox label and the selection summary. */
  label: string;
  /** One value per column, in column order. */
  cells: string[];
};

/**
 * Searchable, sortable table for picking several catalogue items at once
 * (interfaces, tables, batches or reports) to link to a capability.
 */
export function LinkPickerDialog({
  title,
  country,
  noun,
  columns,
  rows,
  onPick,
  onClose,
  toolbar,
  intro,
  actionLabel = "Link",
  emptyText,
}: {
  title: string;
  country: string;
  /** Plural noun for the items, e.g. "interfaces". */
  noun: string;
  columns: string[];
  rows: LinkPickerRow[];
  onPick: (ids: string[]) => Promise<void>;
  onClose: () => void;
  /** Extra filters shown above the search box. */
  toolbar?: ReactNode;
  intro?: string;
  /** Verb on the confirm button, e.g. "Add". */
  actionLabel?: string;
  emptyText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ColumnSort>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matching = terms.length
      ? rows.filter((row) => {
          const text = row.cells.join(" ").toLowerCase();
          return terms.every((term) => text.includes(term));
        })
      : rows;
    const index = sort ? Number(sort.key) : -1;
    return sortRows(matching, sort, (row) => row.cells[index] ?? "");
  }, [rows, search, sort]);

  const filteredIds = filtered.map((row) => row.id);
  const selectedInView = filteredIds.filter((id) => selected.has(id)).length;
  const allInView = filteredIds.length > 0 && selectedInView === filteredIds.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllInView() {
    setSelected((current) => {
      const next = new Set(current);
      if (allInView) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // keep the catalogue order so links are added in a predictable order
    const ids = rows.map((row) => row.id).filter((id) => selected.has(id));
    if (ids.length === 0) {
      setError("Select at least one item.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onPick(ids);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not link the items");
      setBusy(false);
    }
  }

  const count = selected.size;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full max-w-4xl max-h-[85vh] flex-col rounded-lg border border-hairline bg-panel p-6 shadow-xl gap-3"
        onSubmit={(e) => void submit(e)}
      >
        <div>
          <h2 className="font-headline text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted">{intro ?? `Applicable for ${country}. Select one or more ${noun} to link.`}</p>
        </div>
        {toolbar}

        {rows.length === 0 ? (
          <p className="text-sm text-muted">{emptyText ?? `No ${noun} in ${country} left to link.`}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative flex-1 min-w-[220px]">
                <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-muted">search</span>
                <input
                  className="field pl-8"
                  type="search"
                  autoFocus
                  aria-label={`Search ${noun}`}
                  placeholder={`Search ${noun}…`}
                  value={search}
                  disabled={busy}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <span className="font-label text-[11px] text-muted whitespace-nowrap" aria-live="polite">
                {filtered.length} of {rows.length} shown · {count} selected
              </span>
              {count > 0 && (
                <button type="button" className="btn" disabled={busy} onClick={() => setSelected(new Set())}>
                  Clear selection
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded border border-hairline">
              {filtered.length === 0 ? (
                <p className="p-4 text-sm text-muted">No {noun} match “{search.trim()}”.</p>
              ) : (
                <PageSlice rows={filtered} resetKey={`${search}|${sort?.key ?? ""}|${sort?.dir ?? ""}`}>
                  {(visible, pager) => (
                    <>
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-panel">
                          <tr className="border-b border-hairline font-label text-[10px] uppercase text-muted">
                            <th className="py-2.5 px-3 w-10">
                              <input
                                type="checkbox"
                                aria-label={`Select all ${filtered.length} shown`}
                                checked={allInView}
                                ref={(el) => {
                                  if (el) el.indeterminate = selectedInView > 0 && !allInView;
                                }}
                                disabled={busy}
                                onChange={toggleAllInView}
                              />
                            </th>
                            {columns.map((column, index) => {
                              const key = String(index);
                              const active = sort?.key === key ? sort.dir : null;
                              return (
                                <th key={column} className="py-2.5 px-3" aria-sort={active ? (active === "asc" ? "ascending" : "descending") : "none"}>
                                  <SortHeader label={column} active={active} onClick={() => setSort((current) => toggleColumnSort(current, key))} />
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((row) => {
                            const checked = selected.has(row.id);
                            return (
                              <tr
                                key={row.id}
                                className={`border-b border-hairline last:border-b-0 cursor-pointer ${checked ? "bg-inset" : "hover:bg-inset/50"}`}
                                onClick={() => !busy && toggle(row.id)}
                              >
                                <td className="py-2 px-3">
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${row.label}`}
                                    checked={checked}
                                    disabled={busy}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={() => toggle(row.id)}
                                  />
                                </td>
                                {row.cells.map((cell, index) => (
                                  <td key={columns[index] ?? index} className={`py-2 px-3 ${index === 0 ? "font-label text-xs" : "text-muted"}`}>
                                    {cell || "—"}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {pager}
                    </>
                  )}
                </PageSlice>
              )}
            </div>
          </>
        )}

        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || count === 0}>
            {busy ? "Working…" : count > 0 ? `${actionLabel} ${count} selected` : actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
