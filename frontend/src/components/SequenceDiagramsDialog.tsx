import { useState } from "react";
import { MERMAID_TEMPLATES, STARTER_DIAGRAMS, STARTER_SEQUENCE } from "../mermaidTemplates";
import { DiagramPopup, MermaidPreview } from "./DiagramBlock";
import { SelectField } from "./SelectField";

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
  const [pendingTemplate, setPendingTemplate] = useState<string>("");
  const [expanded, setExpanded] = useState(false);

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
      <div role="dialog" aria-modal="true" aria-label="Diagrams" className="flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-lg border border-hairline bg-panel shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <h2 className="font-headline text-xl font-semibold">Diagrams</h2>
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
                  onClick={() => {
                    setActive(index);
                    setPendingTemplate("");
                    setExpanded(false);
                  }}
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
                <label className="flex items-center gap-2 text-xs text-muted">
                  Start from a template
                  <SelectField
                    aria-label="Diagram template"
                    className="min-w-[12rem]"
                    value=""
                    options={[{ value: "", label: "Choose…" }, ...MERMAID_TEMPLATES.map((template) => ({ value: template.id, label: template.label, hint: template.hint }))]}
                    onChange={(id) => {
                      const template = MERMAID_TEMPLATES.find((item) => item.id === id);
                      if (!template) return;
                      const text = current.mermaid.trim();
                      if (text && !STARTER_DIAGRAMS.has(text) && text !== template.text.trim()) setPendingTemplate(template.id);
                      else update(active, { mermaid: template.text });
                    }}
                  />
                </label>
                {pendingTemplate && (
                  <p className="text-sm">
                    Replace the current diagram with {MERMAID_TEMPLATES.find((item) => item.id === pendingTemplate)?.label}?{" "}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const template = MERMAID_TEMPLATES.find((item) => item.id === pendingTemplate);
                        if (template) update(active, { mermaid: template.text });
                        setPendingTemplate("");
                      }}
                    >
                      Replace
                    </button>{" "}
                    <button type="button" className="btn" onClick={() => setPendingTemplate("")}>
                      Keep
                    </button>
                  </p>
                )}
                <label className="block">
                  <span className="font-label text-[10px] uppercase text-muted">Mermaid</span>
                  <textarea
                    className="field mt-1 min-h-36 font-mono text-xs"
                    aria-label="Mermaid source"
                    value={current.mermaid}
                    onChange={(event) => update(active, { mermaid: event.target.value })}
                  />
                </label>
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Expand ${current.title.trim() || "diagram"}`}
                    title="Expand diagram"
                    onClick={() => setExpanded(true)}
                  >
                    <span className="material-symbols-outlined text-base">open_in_full</span>
                    Expand
                  </button>
                </div>
                <div className="overflow-auto rounded-lg border border-hairline bg-inset p-3" aria-label="Diagram preview">
                  <MermaidPreview source={current.mermaid} />
                </div>
                {expanded && (
                  <DiagramPopup
                    source={current.mermaid}
                    title={current.title.trim() || "Diagram"}
                    layerClass="z-[80]"
                    onClose={() => setExpanded(false)}
                  />
                )}
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
              <p className="text-sm text-muted">Add a diagram to write any Mermaid diagram and see it here.</p>
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
