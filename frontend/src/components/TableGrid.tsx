import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { moveItem, movedTo, numberRows, serialColumn } from "../tableRows";
import { RichCell } from "./RichCell";

/** Where a dragged row would land: before `index` (0 to rows.length). */
type Drop = { index: number } | null;

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
  const serial = serialColumn(columns);
  const [dragging, setDragging] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const handles = useRef<(HTMLButtonElement | null)[]>([]);

  // After a keyboard move the handle has to stay with its row.
  useEffect(() => {
    if (focusRow === null) return;
    handles.current[focusRow]?.focus();
    setFocusRow(null);
  }, [focusRow, rows]);

  /** Every change goes out with the Serial No column renumbered, so the saved numbers always follow the row order. */
  function emit(next: string[][]) {
    onChange(numberRows(columns, next));
  }

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    emit(rows.map((row, index) => (index === rowIndex ? columns.map((_, cellIndex) => (cellIndex === columnIndex ? value : (row[cellIndex] ?? ""))) : row)));
  }

  function moveRow(from: number, to: number) {
    if (from === to) return;
    emit(moveItem(rows, from, to));
  }

  function finishDrag() {
    setDragging(null);
    setDrop(null);
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, index: number) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index + 1));
    const row = event.currentTarget.closest("tr");
    if (row && typeof event.dataTransfer.setDragImage === "function") event.dataTransfer.setDragImage(row, 16, 16);
    setDragging(index);
  }

  function overRow(event: DragEvent<HTMLTableRowElement>, index: number) {
    if (dragging === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    setDrop({ index: after ? index + 1 : index });
  }

  function dropRow(event: DragEvent<HTMLTableRowElement>) {
    event.preventDefault();
    if (dragging !== null && drop) moveRow(dragging, movedTo(dragging, drop.index));
    finishDrag();
  }

  function keyMove(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    moveRow(index, target);
    setFocusRow(target);
  }

  const marker = "[&>td]:shadow-[inset_0_2px_0_0_var(--accent,currentColor)]";
  const lastMarker = "[&>td]:shadow-[inset_0_-2px_0_0_var(--accent,currentColor)]";

  return (
    <div className="overflow-x-auto border border-hairline rounded">
      <table className="grid-table w-full text-sm border-collapse">
        <thead className="bg-inset">
          <tr>
            {!readOnly && <th className="w-8 border-b border-hairline" aria-label="Reorder" />}
            {columns.map((column, columnIndex) => (
              <th key={`${column}-${columnIndex}`} className="font-label text-[10px] uppercase tracking-wide text-muted text-left px-2 py-2 border-b border-hairline whitespace-nowrap">
                {column}
              </th>
            ))}
            {!readOnly && <th className="w-16 border-b border-hairline" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const before = drop?.index === rowIndex && dragging !== null && movedTo(dragging, rowIndex) !== dragging;
            const after = drop?.index === rows.length && rowIndex === rows.length - 1 && dragging !== null && dragging !== rows.length - 1;
            return (
              <tr
                key={rowIndex}
                className={`border-b border-hairline ${dragging === rowIndex ? "opacity-40" : ""} ${before ? marker : ""} ${after ? lastMarker : ""}`}
                onDragOver={readOnly ? undefined : (event) => overRow(event, rowIndex)}
                onDrop={readOnly ? undefined : dropRow}
              >
                {!readOnly && (
                  <td className="px-1 align-top pt-1 w-8">
                    <button
                      type="button"
                      ref={(element) => {
                        handles.current[rowIndex] = element;
                      }}
                      draggable
                      className="icon-btn cursor-grab active:cursor-grabbing touch-none"
                      aria-label={`Move row ${rowIndex + 1}`}
                      title="Drag to move. With the keyboard, use the up and down arrow keys."
                      onDragStart={(event) => startDrag(event, rowIndex)}
                      onDragEnd={finishDrag}
                      onKeyDown={(event) => keyMove(event, rowIndex)}
                    >
                      <span className="material-symbols-outlined text-base" aria-hidden="true">
                        drag_indicator
                      </span>
                    </button>
                  </td>
                )}
                {columns.map((column, columnIndex) =>
                  columnIndex === serial ? (
                    <td key={`${column}-${columnIndex}`} className="align-top w-12 px-2 py-2 text-muted tabular-nums" data-serial="true">
                      {rowIndex + 1}
                    </td>
                  ) : (
                    <td key={`${column}-${columnIndex}`} className="align-top min-w-32">
                      <RichCell
                        label={`${column} row ${rowIndex + 1}`}
                        value={row[columnIndex] ?? ""}
                        readOnly={readOnly}
                        onChange={(value) => updateCell(rowIndex, columnIndex, value)}
                      />
                    </td>
                  ),
                )}
                {!readOnly && (
                  <td className="px-2 whitespace-nowrap align-top pt-1">
                    <button type="button" className="text-alert text-xs" aria-label={`Delete row ${rowIndex + 1}`} onClick={() => emit(rows.filter((_, index) => index !== rowIndex))}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly && (
        <button type="button" className="btn m-2" onClick={() => emit([...rows, columns.map(() => "")])}>
          Add row
        </button>
      )}
    </div>
  );
}
