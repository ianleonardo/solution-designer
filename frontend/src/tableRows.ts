// Row helpers for the table editor.
//
// A first column headed SN, S/N, No, # or Serial No holds the row number. The app numbers it, so nobody types it and it
// follows the rows when they move. Mirrors `serial_column` and `number_rows` in backend/app/content.py.
const SERIAL_HEADER = /^(?:sn|s\/n|s\.n\.?|no\.?|#|serial(?:\s+(?:no\.?|number))?)$/i;

/** Index of the Serial No column (always the first column), or -1 when the table has none. */
export function serialColumn(columns: string[]): number {
  return columns.length > 0 && SERIAL_HEADER.test(columns[0].trim()) ? 0 : -1;
}

/** The rows with the Serial No column set to 1, 2, 3... in row order. Tables without one come back unchanged. */
export function numberRows(columns: string[], rows: string[][]): string[][] {
  const index = serialColumn(columns);
  if (index < 0) return rows;
  return rows.map((row, position) => columns.map((_, cell) => (cell === index ? String(position + 1) : (row[cell] ?? ""))));
}

/** The position a row ends up at when it is taken out of `from` and put in front of row `before` (0 to rows.length). */
export function movedTo(from: number, before: number): number {
  return before > from ? before - 1 : before;
}

/** A copy of the list with one item moved; the list itself comes back when the move changes nothing or is out of range. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
