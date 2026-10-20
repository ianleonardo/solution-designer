import { ReactNode, useEffect, useMemo, useState } from "react";
import { SelectField } from "./SelectField";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Value used for sorting. Omit for non-sortable columns such as actions. */
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

function compare(left: string | number | null | undefined, right: string | number | null | undefined): number {
  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  pageSize,
  pageSizes,
  emptyLabel = "No records.",
  searchText,
  searchLabel = "Search",
  searchPlaceholder = "Search",
  toolbar,
  onRowClick,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  pageSize: number;
  /** When set, the reader can change how many rows are shown. `pageSize` is the initial choice. */
  pageSizes?: readonly number[];
  emptyLabel?: string;
  /** When provided, a search box filters rows by this text. */
  searchText?: (row: T) => string;
  searchLabel?: string;
  searchPlaceholder?: string;
  /** Rendered beside the search box (e.g. a create button). */
  toolbar?: ReactNode;
  /** Makes each data row open this row. Clicks inside buttons do not fire it when they stop propagation. */
  onRowClick?: (row: T) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [chosenSize, setChosenSize] = useState(pageSize);
  const size = pageSizes?.length ? chosenSize : pageSize;

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle && searchText ? rows.filter((row) => searchText(row).toLowerCase().includes(needle)) : rows),
    [rows, needle, searchText],
  );

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return filtered;
    const getValue = column.sortValue;
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = getValue(a);
      const right = getValue(b);
      const leftEmpty = left === null || left === undefined || left === "";
      const rightEmpty = right === null || right === undefined || right === "";
      // Empty values always sink to the bottom regardless of direction.
      if (leftEmpty || rightEmpty) return compare(left, right);
      return compare(left, right) * direction;
    });
  }, [filtered, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / size));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const start = (Math.min(page, pageCount) - 1) * size;
  const visible = sorted.slice(start, start + size);

  function toggleSort(key: string) {
    setPage(1);
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  return (
    <div className="space-y-3">
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchText && (
            <input
              className="field max-w-xs"
              type="search"
              value={query}
              placeholder={searchPlaceholder}
              aria-label={searchLabel}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          )}
          {toolbar}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-hairline bg-panel shadow-glaze">
        <table className="w-full text-sm">
          <thead className="bg-inset text-left">
            <tr className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {columns.map((column) => {
                const active = sort?.key === column.key ? sort.dir : null;
                return (
                  <th
                    key={column.key}
                    className={`px-3 py-2 font-medium ${column.className ?? ""}`}
                    aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : column.sortValue ? "none" : undefined}
                  >
                    {column.sortValue ? (
                      <button type="button" className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink" onClick={() => toggleSort(column.key)}>
                        {column.header}
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                          {active === "asc" ? "arrow_upward" : active === "desc" ? "arrow_downward" : "unfold_more"}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <tr
                key={rowKey(row)}
                className={`border-t border-hairline row-hover ${onRowClick ? "cursor-pointer" : ""}`}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((column) => (
                  <td key={column.key} className={`px-3 py-2 align-middle ${column.className ?? ""}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(pageSizes ? sorted.length > 0 : sorted.length > size) && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted" aria-label="Pagination">
          {pageSizes && (
            <label className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span>Rows per page</span>
              <SelectField
                aria-label="Rows per page"
                value={String(size)}
                options={pageSizes.map((option) => ({ value: String(option), label: String(option) }))}
                onChange={(value) => {
                  setChosenSize(Number(value));
                  setPage(1);
                }}
              />
            </label>
          )}
          <span>
            {start + 1}-{Math.min(start + size, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              Page {Math.min(page, pageCount)} of {pageCount}
            </span>
            <button type="button" className="btn" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
