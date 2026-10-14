import { RichCell } from "./RichCell";

export function TableGrid({
  columns,
  rows,
  onChange,
  readOnly,
}: {
  columns: string[];
  rows: string[][];
  onChange: (rows: string[][]) => void;
  readOnly: boolean;
}) {
  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    onChange(rows.map((row, index) => (index === rowIndex ? columns.map((_, cellIndex) => (cellIndex === columnIndex ? value : (row[cellIndex] ?? ""))) : row)));
  }

  function moveRow(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="overflow-x-auto border border-hairline rounded">
      <table className="grid-table w-full text-sm border-collapse">
        <thead className="bg-inset">
          <tr>
            {columns.map((column, columnIndex) => (
              <th key={`${column}-${columnIndex}`} className="font-label text-[10px] uppercase tracking-wide text-muted text-left px-2 py-2 border-b border-hairline whitespace-nowrap">
                {column}
              </th>
            ))}
            {!readOnly && <th className="w-24 border-b border-hairline" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-hairline">
              {columns.map((column, columnIndex) => (
                <td key={`${column}-${columnIndex}`} className="align-top min-w-32">
                  <RichCell
                    label={`${column} row ${rowIndex + 1}`}
                    value={row[columnIndex] ?? ""}
                    readOnly={readOnly}
                    onChange={(value) => updateCell(rowIndex, columnIndex, value)}
                  />
                </td>
              ))}
              {!readOnly && (
                <td className="px-2 whitespace-nowrap align-top pt-1">
                  <button type="button" className="icon-btn" aria-label={`Move row ${rowIndex + 1} up`} title="Move up" disabled={rowIndex === 0} onClick={() => moveRow(rowIndex, -1)}>
                    <span className="material-symbols-outlined text-base">arrow_upward</span>
                  </button>
                  <button type="button" className="icon-btn ml-0.5" aria-label={`Move row ${rowIndex + 1} down`} title="Move down" disabled={rowIndex === rows.length - 1} onClick={() => moveRow(rowIndex, 1)}>
                    <span className="material-symbols-outlined text-base">arrow_downward</span>
                  </button>
                  <button type="button" className="text-alert text-xs ml-1" aria-label={`Delete row ${rowIndex + 1}`} onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}>
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button type="button" className="btn m-2" onClick={() => onChange([...rows, columns.map(() => "")])}>
          Add row
        </button>
      )}
    </div>
  );
}
