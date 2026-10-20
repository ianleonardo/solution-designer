import { useState } from "react";
import { STARTER_SEQUENCE } from "../mermaidTemplates";
import { MermaidPreview } from "./DiagramBlock";

export type SequenceDiagram = { id: string; title: string; mermaid: string };

function newDiagram(index: number): SequenceDiagram {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `diagram-${Date.now()}-${index}`;
  return { id, title: `Diagram ${index}`, mermaid: STARTER_SEQUENCE };
}

export function SequenceDiagramsDialog({
  diagrams,
  onSave,
  onClose,
}: {
  diagrams: SequenceDiagram[];
  onSave: (diagrams: SequenceDiagram[]) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<SequenceDiagram[]>(diagrams);
  const [active, setActive] = useState(0);

  function update(index: number, patch: Partial<SequenceDiagram>) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function save() {
    const kept = items
      .map((item, index) => ({
        ...item,
        title: item.title.trim() || `Diagram ${index + 1}`,
        mermaid: item.mermaid.trim(),
      }))
      .filter((item) => item.mermaid);
    onSave(kept);
  }

  const current = items[active];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Sequence diagrams" className="flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-lg border border-hairline bg-panel shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <h2 className="font-headline text-xl font-semibold">Sequence diagrams</h2>
          <button type="button" className="btn" onClick={() => {
            setItems((currentItems) => [...currentItems, newDiagram(currentItems.length + 1)]);
            setActive(items.length);
          }}>
            <span className="material-symbols-outlined text-base">add</span>
            Add diagram
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[16rem_1fr]">
          <ul className="overflow-y-auto border-b border-hairline md:border-b-0 md:border-r" aria-label="Diagram list">
            {items.length === 0 && <li className="px-4 py-3 text-sm text-muted">No diagrams yet.</li>}
            {items.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`w-full px-4 py-2 text-left text-sm ${index === active ? "bg-inset font-medium" : "hover:bg-inset/60"}`}
                  onClick={() => setActive(index)}
                >
                  {item.title.trim() || `Diagram ${index + 1}`}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-h-0 overflow-y-auto p-5 space-y-3">
            {current ? (
              <>
                <label className="block">
                  <span className="font-label text-[10px] uppercase text-muted">Title</span>
                  <input className="field mt-1" aria-label="Diagram title" value={current.title} onChange={(event) => update(active, { title: event.target.value })} />
                </label>
                <label className="block">
                  <span className="font-label text-[10px] uppercase text-muted">Mermaid sequence diagram</span>
                  <textarea
                    className="field mt-1 min-h-36 font-mono text-xs"
                    aria-label="Mermaid source"
                    value={current.mermaid}
                    onChange={(event) => update(active, { mermaid: event.target.value })}
                  />
                </label>
                <div className="overflow-auto rounded-lg border border-hairline bg-inset p-3" aria-label="Diagram preview">
                  <MermaidPreview source={current.mermaid} />
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setItems((currentItems) => currentItems.filter((_, index) => index !== active));
                    setActive((index) => Math.max(0, index - 1));
                  }}
                >
                  Remove diagram
                </button>
              </>
            ) : (
              <p className="text-sm text-muted">Add a diagram to write a sequenceDiagram and see it here.</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-4">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
