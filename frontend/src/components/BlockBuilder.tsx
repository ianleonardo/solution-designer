import { useRef, useState, type DragEvent } from "react";
import { moveItem } from "../tableRows";
import type { BlockSpec, KbSource } from "../types";
import { SelectField } from "./SelectField";

const LABELS: Record<BlockSpec["type"], string> = {
  header: "Header",
  prose: "Text",
  table: "Table",
  image: "Image",
  diagram: "Diagram",
};

export function newBlock(type: BlockSpec["type"]): BlockSpec {
  if (type === "header") return { type, text: "", level: 1 };
  if (type === "table") return { type, columns: ["Column 1", "Column 2"] };
  if (type === "image") return { type, caption: "" };
  if (type === "diagram") return { type, sequence: false };
  return { type: "prose" };
}

export function BlockBuilder({ blocks, onChange }: { blocks: BlockSpec[]; onChange: (blocks: BlockSpec[]) => void }) {
  const columnDrag = useRef<{ block: number; column: number } | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<{ block: number; column: number } | null>(null);

  function update(index: number, next: BlockSpec) {
    onChange(blocks.map((block, position) => (position === index ? next : block)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-2" aria-label="Blocks">
      {blocks.length === 0 && <p className="text-muted text-sm">No blocks yet. Add one below.</p>}
      {blocks.map((block, index) => (
        <div key={index} className="rounded-lg border border-hairline bg-inset p-3 space-y-2" role="group" aria-label={`Block ${index + 1} ${LABELS[block.type]}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-label text-[10px] uppercase text-muted">
              {index + 1}. {LABELS[block.type]}
            </span>
            <div className="flex gap-1">
              <button type="button" className="icon-btn" aria-label={`Move block ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <span className="material-symbols-outlined">arrow_upward</span>
              </button>
              <button type="button" className="icon-btn" aria-label={`Move block ${index + 1} down`} disabled={index === blocks.length - 1} onClick={() => move(index, 1)}>
                <span className="material-symbols-outlined">arrow_downward</span>
              </button>
              <button type="button" className="icon-btn icon-btn-danger" aria-label={`Remove block ${index + 1}`} onClick={() => onChange(blocks.filter((_, position) => position !== index))}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>
          {block.type === "header" && (
            <div className="flex gap-2">
              <label className="block flex-1 text-sm">
                Header text
                <input className="field mt-1" aria-label={`Block ${index + 1} header text`} value={block.text} placeholder="Defaults to empty; editable in the document" onChange={(event) => update(index, { ...block, text: event.target.value })} />
              </label>
              <label className="block w-28 text-sm">
                Size
                <div className="mt-1">
                  <SelectField
                    aria-label={`Block ${index + 1} header size`}
                    value={String(block.level)}
                    className="w-full [&_button]:w-full [&_button]:max-w-none"
                    options={[{ value: "1", label: "Large" }, { value: "2", label: "Medium" }, { value: "3", label: "Small" }]}
                    onChange={(value) => update(index, { ...block, level: Number(value) })}
                  />
                </div>
              </label>
            </div>
          )}
          {block.type === "prose" && <p className="text-xs text-muted">Free text. The model writes it from the section prompt.</p>}
          {block.type === "table" && (
            <div className="space-y-1">
              <label className="block text-sm mb-2">
                Fill from Knowledge Base
                <div className="mt-1">
                  <SelectField
                    aria-label={`Block ${index + 1} Knowledge Base source`}
                    value={block.source ?? ""}
                    className="w-full max-w-xs [&_button]:w-full"
                    options={[
                      { value: "", label: "No (typed rows only)" },
                      { value: "capabilities", label: "Capabilities" },
                      { value: "interfaces", label: "Interfaces" },
                      { value: "reports", label: "Reports" },
                      { value: "tables", label: "Tables (one field table per database table)" },
                    ]}
                    onChange={(value) => update(index, { ...block, source: value as KbSource | "" })}
                  />
                </div>
                <span className="mt-1 block text-xs text-muted">Columns are matched to Knowledge Base fields by their names, for example “L1 Capability” or “Source System”.</span>
              </label>
              <p className="text-sm">Columns</p>
              {block.columns.map((column, columnIndex) => (
                <div
                  key={columnIndex}
                  className={`flex items-center gap-1 rounded ${draggedColumn?.block === index && draggedColumn.column === columnIndex ? "opacity-60" : ""}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = columnDrag.current;
                    columnDrag.current = null;
                    setDraggedColumn(null);
                    if (!source || source.block !== index || source.column === columnIndex) return;
                    update(index, { ...block, columns: moveItem(block.columns, source.column, columnIndex) });
                  }}
                >
                  <button
                    type="button"
                    draggable
                    className="icon-btn cursor-grab active:cursor-grabbing touch-none"
                    aria-label={`Drag column ${columnIndex + 1} of block ${index + 1}`}
                    title="Drag to reorder"
                    onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                      columnDrag.current = { block: index, column: columnIndex };
                      setDraggedColumn({ block: index, column: columnIndex });
                      const transfer = event.dataTransfer;
                      if (!transfer) return;
                      transfer.effectAllowed = "move";
                      try {
                        transfer.setData("text/plain", column);
                      } catch {
                        // Some browsers reject setData outside a real drag.
                      }
                    }}
                    onDragEnd={() => {
                      columnDrag.current = null;
                      setDraggedColumn(null);
                    }}
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden="true">drag_indicator</span>
                  </button>
                  <input
                    className="field flex-1"
                    aria-label={`Block ${index + 1} column ${columnIndex + 1}`}
                    value={column}
                    onChange={(event) => update(index, { ...block, columns: block.columns.map((item, position) => (position === columnIndex ? event.target.value : item)) })}
                  />
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label={`Remove column ${columnIndex + 1} of block ${index + 1}`}
                    disabled={block.columns.length <= 1}
                    onClick={() => update(index, { ...block, columns: block.columns.filter((_, position) => position !== columnIndex) })}
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              ))}
              <button type="button" className="btn" disabled={block.columns.length >= 12} onClick={() => update(index, { ...block, columns: [...block.columns, `Column ${block.columns.length + 1}`] })}>
                Add column
              </button>
            </div>
          )}
          {block.type === "image" && (
            <label className="block text-sm">
              Default caption
              <input className="field mt-1" aria-label={`Block ${index + 1} caption`} value={block.caption} onChange={(event) => update(index, { ...block, caption: event.target.value })} />
              <span className="text-xs text-muted">Images are uploaded in the document; the model does not generate them.</span>
            </label>
          )}
          {block.type === "diagram" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" aria-label={`Block ${index + 1} sequence diagram`} checked={block.sequence} onChange={(event) => update(index, { ...block, sequence: event.target.checked })} />
              Starts as a sequence diagram (otherwise a flowchart)
            </label>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Add block">
        {(Object.keys(LABELS) as BlockSpec["type"][]).map((type) => (
          <button key={type} type="button" className="btn" onClick={() => onChange([...blocks, newBlock(type)])}>
            <span className="material-symbols-outlined">add</span>
            {LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  );
}
