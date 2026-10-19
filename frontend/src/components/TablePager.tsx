import { ReactNode, useEffect, useState } from "react";

export const KB_PAGE_SIZES = [25, 50, 100] as const;
export const KB_PAGE_SIZE = KB_PAGE_SIZES[0];

export type PageWindow = {
  pageSize: number;
  setPageSize: (size: number) => void;
  page: number;
  setPage: (page: number) => void;
  pageCount: number;
  start: number;
  end: number;
  total: number;
};

/** `resetKey` returns to the first page when the list behind the table changes. */
export function usePageWindow(total: number, resetKey: unknown = total): PageWindow {
  const [pageSize, setPageSize] = useState<number>(KB_PAGE_SIZE);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const start = total === 0 ? 0 : (current - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return { pageSize, setPageSize, page: current, setPage, pageCount, start, end, total };
}

export function TablePager({ paging, pageSizes = KB_PAGE_SIZES }: { paging: PageWindow; pageSizes?: readonly number[] }) {
  if (paging.total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm text-muted" aria-label="Pagination">
      <label className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <span>Rows per page</span>
        <select
          className="field"
          aria-label="Rows per page"
          value={paging.pageSize}
          onChange={(event) => paging.setPageSize(Number(event.target.value))}
        >
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <span>
        {paging.start + 1}-{paging.end} of {paging.total}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn" disabled={paging.page <= 1} onClick={() => paging.setPage(paging.page - 1)}>
          Previous
        </button>
        <span>
          Page {paging.page} of {paging.pageCount}
        </span>
        <button type="button" className="btn" disabled={paging.page >= paging.pageCount} onClick={() => paging.setPage(paging.page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

/** Renders one page of `rows` and the pager for that page. */
export function PageSlice<T>({
  rows,
  resetKey,
  children,
}: {
  rows: T[];
  resetKey?: unknown;
  children: (visible: T[], pager: ReactNode) => ReactNode;
}) {
  const paging = usePageWindow(rows.length, resetKey ?? rows.length);
  return children(rows.slice(paging.start, paging.end), <TablePager paging={paging} />);
}
