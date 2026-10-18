export type ColumnSort = { key: string; dir: "asc" | "desc" } | null;

export function toggleColumnSort(current: ColumnSort, key: string): ColumnSort {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

export function compareText(left: string, right: string, dir: "asc" | "desc") {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }) * (dir === "asc" ? 1 : -1);
}

export function sortRows<T>(rows: T[], sort: ColumnSort, value: (row: T) => string) {
  if (!sort) return rows;
  return [...rows].sort((left, right) => compareText(value(left), value(right), sort.dir));
}

export function SortHeader({ label, active, onClick }: { label: string; active: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <button type="button" className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink" onClick={onClick}>
      {label}
      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
        {active === "asc" ? "arrow_upward" : active === "desc" ? "arrow_downward" : "unfold_more"}
      </span>
    </button>
  );
}
