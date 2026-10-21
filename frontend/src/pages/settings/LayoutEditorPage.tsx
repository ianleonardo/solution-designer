import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../../api";
import { BlockBuilder } from "../../components/BlockBuilder";
import { SelectField } from "../../components/SelectField";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { BlockSpec, LayoutDetail, LayoutTemplate } from "../../types";
import { applyMove, applyReparent, byOrder, descendantIds, MAX_SECTION_DEPTH, toStructure, type DropSpot, type SectionNode } from "./layoutStructure";
import { sectionDepth } from "../../structure";
import { useOptionalAuth } from "../../auth";
import { can } from "../../permissions";

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function SectionDialog({
  title,
  onSubmit,
  onClose,
}: {
  title: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(errorText(err, "Could not add the section"));
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-lg border border-hairline bg-panel p-6 shadow-xl" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-xl font-semibold mb-4">{title}</h2>
        <label className="block mb-4">
          <span className="font-label text-[10px] uppercase text-muted">Name</span>
          <input className="field mt-1" aria-label="Section name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus maxLength={150} />
        </label>
        {error && <p className="text-alert mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>Add</button>
        </div>
      </form>
    </div>
  );
}

type SectionForm = {
  name: string;
  hint: string;
  blocks: BlockSpec[];
  prompt: string;
  temperature: number;
  maxWords: string;
};

function dropSpot(row: HTMLElement, clientY: number): DropSpot {
  const rect = row.getBoundingClientRect();
  if (rect.height <= 0) return "inside";
  const ratio = (clientY - rect.top) / rect.height;
  if (ratio < 0.2) return "before";
  if (ratio > 0.8) return "after";
  return "inside";
}

function parentOptions(structure: SectionNode[], templates: LayoutTemplate[], id: string) {
  const current = templates.find((item) => item.template_id === id)?.parent_id ?? "";
  return [
    { value: "", label: "Main section" },
    ...templates
      .filter((item) => item.template_id === current || applyReparent(structure, id, item.template_id))
      .map((item) => ({ value: item.template_id, label: item.section_name })),
  ];
}

function OutlineNodes({
  nodes,
  depth,
  row,
}: {
  nodes: SectionNode[];
  depth: number;
  row: (id: string, depth: number) => JSX.Element;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.template_id}>
          {row(node.template_id, depth)}
          {node.children.length > 0 && <OutlineNodes nodes={node.children} depth={depth + 1} row={row} />}
        </li>
      ))}
    </ul>
  );
}

function formFor(template: LayoutTemplate): SectionForm {
  return {
    name: template.section_name,
    hint: template.hint,
    blocks: template.blocks,
    prompt: template.system_prompt,
    temperature: template.temperature,
    maxWords: String(template.max_words),
  };
}

export function LayoutEditorPage() {
  const auth = useOptionalAuth();
  // Settings read: the page is shown but cannot be changed.
  const canWrite = !auth?.user || can(auth.user, "settings", "write");
  const { layoutId = "" } = useParams();
  const [layout, setLayout] = useState<LayoutDetail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<SectionForm | null>(null);
  const [details, setDetails] = useState({ name: "", description: "", allow_multiple: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState<null | { parentId: string | null }>(null);
  const [removing, setRemoving] = useState<LayoutTemplate | null>(null);
  const [dragId, setDragId] = useState("");
  const [dropHint, setDropHint] = useState<{ id: string; spot: DropSpot } | null>(null);
  const draggedId = useRef("");
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => {
    api<LayoutDetail>(`/api/layouts/${layoutId}`)
      .then((loaded) => {
        setLayout(loaded);
        setDetails({ name: loaded.name, description: loaded.description, allow_multiple: loaded.allow_multiple });
        setSelectedId(byOrder(loaded.templates)[0]?.template_id ?? "");
      })
      .catch((err: unknown) => setError(errorText(err, "Could not load the layout")));
  }, [layoutId]);

  const templates = layout ? byOrder(layout.templates) : [];
  const selected = templates.find((item) => item.template_id === selectedId);

  useEffect(() => {
    setForm(selected ? formFor(selected) : null);
    // Reload the form only when another section is chosen or after a save.
  }, [selectedId, formVersion, layout?.layout_id]);

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const updated = await api<LayoutDetail>(`/api/layouts/${layoutId}`, { method: "PUT", body: JSON.stringify(details) });
      setLayout((current) => (current ? { ...current, name: updated.name, description: updated.description, allow_multiple: updated.allow_multiple } : current));
      setDetails((current) => ({ ...current, allow_multiple: updated.allow_multiple }));
      setNotice("Layout details saved");
    } catch (err) {
      setError(errorText(err, "Could not save the layout"));
    }
  }

  async function saveOrder(next: SectionNode[] | null) {
    if (!next) return;
    setError("");
    try {
      const updated = await api<LayoutDetail>(`/api/layouts/${layoutId}/order`, { method: "PUT", body: JSON.stringify({ sections: next }) });
      setLayout(updated);
    } catch (err) {
      setError(errorText(err, "Could not reorder the sections"));
    }
  }

  async function saveSection(event: FormEvent) {
    event.preventDefault();
    if (!selected || !form) return;
    setError("");
    setNotice("");
    try {
      const updated = await api<LayoutTemplate>(`/api/templates/${selected.template_id}`, {
        method: "PUT",
        body: JSON.stringify({
          section_name: form.name,
          hint: form.hint,
          blocks: form.blocks,
          system_prompt: form.prompt,
          temperature: form.temperature,
          max_words: Number(form.maxWords),
        }),
      });
      setLayout((current) =>
        current ? { ...current, templates: current.templates.map((item) => (item.template_id === updated.template_id ? updated : item)) } : current,
      );
      setFormVersion((value) => value + 1);
      setNotice("Section saved");
    } catch (err) {
      setError(errorText(err, "Could not save the section"));
    }
  }

  async function addSection(name: string, parentId: string | null) {
    const created = await api<LayoutTemplate>(`/api/layouts/${layoutId}/templates`, {
      method: "POST",
      body: JSON.stringify({ section_name: name, parent_id: parentId, blocks: [{ type: "prose" }] }),
    });
    setLayout((current) => (current ? { ...current, templates: [...current.templates, created] } : current));
    setSelectedId(created.template_id);
    setAdding(null);
  }

  if (!layout) {
    return <p className="p-6 text-muted">{error || "Loading layout…"}</p>;
  }

  const structure = toStructure(layout.templates);
  const nameOf = (id: string) => templates.find((item) => item.template_id === id)?.section_name ?? id;
  function row(id: string, depth: number) {
    const template = templates.find((item) => item.template_id === id)!;
    const hint = dropHint?.id === id ? dropHint.spot : null;
    return (
      <div
        key={id}
        draggable={canWrite}
        onDragStart={(event) => {
          draggedId.current = id;
          setDragId(id);
          const transfer = event.dataTransfer;
          if (!transfer) return;
          transfer.effectAllowed = "move";
          transfer.setData("text/plain", id);
        }}
        onDragEnd={() => {
          draggedId.current = "";
          setDragId("");
          setDropHint(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const spot = dropSpot(event.currentTarget, event.clientY);
          setDropHint((current) => (current?.id === id && current.spot === spot ? current : { id, spot }));
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const source = draggedId.current || event.dataTransfer?.getData("text/plain") || "";
          draggedId.current = "";
          setDragId("");
          setDropHint(null);
          if (source) void saveOrder(applyMove(structure, source, id, dropSpot(event.currentTarget, event.clientY)));
        }}
        className={`flex items-center gap-1 rounded-md px-2 py-1 row-hover ${id === selectedId ? "bg-inset" : ""} ${dragId === id ? "opacity-60" : ""} ${hint === "inside" ? "bg-inset ring-1 ring-accent" : ""} ${hint === "before" ? "border-t-2 border-accent" : ""} ${hint === "after" ? "border-b-2 border-accent" : ""}`}
        style={{ paddingLeft: depth ? `${depth * 1.5}rem` : undefined }}
      >
        <span className="material-symbols-outlined text-muted cursor-grab" aria-hidden>drag_indicator</span>
        <button type="button" className="flex-1 text-left truncate" aria-current={id === selectedId ? "true" : undefined} onClick={() => setSelectedId(id)}>
          {template.section_name}
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div className="flex items-center gap-2">
        <Link to="/settings/layouts" className="icon-btn" aria-label="Back to layouts">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <h1 className="font-headline text-2xl font-semibold">{layout.name}</h1>
      </div>
      {error && <p className="text-alert">{error}</p>}
      {notice && <p className="text-muted" role="status">{notice}</p>}

      {!canWrite && <p className="text-sm text-muted">View only. Your role can see this layout but not change it.</p>}
      <form aria-label="Layout details" className="bg-panel border border-hairline rounded-lg p-4 grid gap-3 md:grid-cols-[1fr_2fr_auto_auto] items-end" onSubmit={(event) => void saveDetails(event)}>
        <fieldset disabled={!canWrite} className="contents">
        <label className="block text-sm">
          Document name
          <input className="field mt-1" aria-label="Layout name" value={details.name} maxLength={100} onChange={(event) => setDetails({ ...details, name: event.target.value })} />
        </label>
        <label className="block text-sm">
          Description
          <input className="field mt-1" aria-label="Layout description" value={details.description} maxLength={500} onChange={(event) => setDetails({ ...details, description: event.target.value })} />
        </label>
        <label
          className="flex items-center gap-2 text-sm whitespace-nowrap pb-2"
          title={layout.layout_id === "sdd" ? "A project has exactly one Solution Design Document" : "Let a project add this document more than once"}
        >
          <input
            type="checkbox"
            aria-label="Allow multiple per project"
            checked={details.allow_multiple}
            disabled={layout.layout_id === "sdd"}
            onChange={(event) => setDetails({ ...details, allow_multiple: event.target.checked })}
          />
          Allow multiple per project
        </label>
        {canWrite && <button type="submit" className="btn btn-primary" disabled={!details.name.trim()}>Save details</button>}
        </fieldset>
      </form>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="bg-panel border border-hairline rounded-lg p-3 space-y-2" aria-label="Sections">
          <p className="text-xs text-muted">Drag a section to reorder it among its siblings, or drop it on another section to nest it there. Documents already created keep their own structure.</p>
          {canWrite && <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => setAdding({ parentId: null })}>
              <span className="material-symbols-outlined">add</span>
              Add section
            </button>
            <button
              type="button"
              className="btn"
              disabled={!selected || sectionDepth(templates, selected.template_id) >= MAX_SECTION_DEPTH}
              onClick={() => selected && setAdding({ parentId: selected.template_id })}
            >
              <span className="material-symbols-outlined">subdirectory_arrow_right</span>
              Add sub-section
            </button>
          </div>}
          {structure.length === 0 ? (
            <p className="text-muted text-sm">This layout has no sections yet.</p>
          ) : (
            <OutlineNodes nodes={structure} depth={0} row={row} />
          )}
        </aside>

        {selected && form ? (
          <form aria-label="Section settings" className="bg-panel border border-hairline rounded-lg p-4 space-y-4" onSubmit={(event) => void saveSection(event)}>
            <fieldset disabled={!canWrite} className="space-y-4 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-headline text-lg font-semibold">{selected.section_name}</h2>
              <button type="button" className={`btn btn-danger ${canWrite ? "" : "hidden"}`} onClick={() => setRemoving(selected)}>
                <span className="material-symbols-outlined">delete</span>
                Delete section
              </button>
            </div>
            <label className="block text-sm">
              Section name
              <input className="field mt-1" aria-label="Section name" value={form.name} maxLength={150} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <div className="block text-sm">
              Parent section
              <SelectField
                className="mt-1 w-full [&_button]:w-full [&_button]:max-w-none"
                aria-label="Parent section"
                value={selected.parent_id ?? ""}
                options={parentOptions(structure, templates, selected.template_id)}
                onChange={(value) => void saveOrder(applyReparent(structure, selected.template_id, value))}
              />
            </div>
            <label className="block text-sm">
              Guidance for the model
              <input className="field mt-1" aria-label="Hint" value={form.hint} maxLength={1000} onChange={(event) => setForm({ ...form, hint: event.target.value })} />
            </label>
            <div>
              <p className="text-sm font-medium mb-2">Layout and behaviour</p>
              <BlockBuilder blocks={form.blocks} onChange={(blocks) => setForm({ ...form, blocks })} />
            </div>
            <label className="block text-sm">
              Prompt for auto-generation
              <textarea className="field mt-1 min-h-32" aria-label="Prompt" value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                Temperature {form.temperature.toFixed(2)}
                <input className="w-full" type="range" aria-label="Temperature" min={0} max={1} step={0.05} value={form.temperature} onChange={(event) => setForm({ ...form, temperature: Number(event.target.value) })} />
              </label>
              <label className="block text-sm">
                Max words
                <input
                  className="field mt-1"
                  aria-label="Max words"
                  inputMode="numeric"
                  value={form.maxWords}
                  onChange={(event) => setForm({ ...form, maxWords: event.target.value.replace(/\D/g, "") })}
                />
              </label>
            </div>
            {canWrite && <button type="submit" className="btn btn-primary" disabled={!form.name.trim() || form.blocks.length === 0}>Save section</button>}
            </fieldset>
          </form>
        ) : (
          <div className="bg-panel border border-hairline rounded-lg p-4 text-muted">Select a section to edit, or add one.</div>
        )}
      </div>

      {adding && (
        <SectionDialog
          title={adding.parentId ? `Add sub-section to ${nameOf(adding.parentId)}` : "Add section"}
          onClose={() => setAdding(null)}
          onSubmit={(name) => addSection(name, adding.parentId)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Delete section"
          message={`Delete ${removing.section_name}${descendantIds(toStructure(layout.templates), removing.template_id).length > 1 ? " and its sub-sections" : ""} from this layout? Documents already created keep their own structure.`}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/api/templates/${removing.template_id}`, { method: "DELETE" });
            const gone = new Set(descendantIds(toStructure(layout.templates), removing.template_id));
            const remaining = layout.templates.filter((item) => !gone.has(item.template_id));
            setLayout({ ...layout, templates: remaining });
            setSelectedId(byOrder(remaining)[0]?.template_id ?? "");
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
