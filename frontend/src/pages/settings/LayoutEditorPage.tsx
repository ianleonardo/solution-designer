import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../../api";
import { BlockBuilder } from "../../components/BlockBuilder";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { BlockSpec, LayoutDetail, LayoutTemplate } from "../../types";
import { applyMove, applyReparent, applyShift, byOrder, toStructure, type SectionNode } from "./layoutStructure";

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
  const { layoutId = "" } = useParams();
  const [layout, setLayout] = useState<LayoutDetail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<SectionForm | null>(null);
  const [details, setDetails] = useState({ name: "", description: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState<null | { parentId: string | null }>(null);
  const [removing, setRemoving] = useState<LayoutTemplate | null>(null);
  const [dragId, setDragId] = useState("");
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => {
    api<LayoutDetail>(`/api/layouts/${layoutId}`)
      .then((loaded) => {
        setLayout(loaded);
        setDetails({ name: loaded.name, description: loaded.description });
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
      setLayout((current) => (current ? { ...current, name: updated.name, description: updated.description } : current));
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
  const selectedIsChild = Boolean(selected?.parent_id);

  function row(id: string, depth: 0 | 1) {
    const template = templates.find((item) => item.template_id === id)!;
    return (
      <li
        key={id}
        draggable
        onDragStart={() => setDragId(id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (dragId) void saveOrder(applyMove(structure, dragId, id));
          setDragId("");
        }}
        className={`flex items-center gap-1 rounded-md px-2 py-1 row-hover ${id === selectedId ? "bg-inset" : ""}`}
        style={{ paddingLeft: depth ? "1.5rem" : undefined }}
      >
        <span className="material-symbols-outlined text-muted cursor-grab" aria-hidden>drag_indicator</span>
        <button type="button" className="flex-1 text-left truncate" aria-current={id === selectedId ? "true" : undefined} onClick={() => setSelectedId(id)}>
          {template.section_name}
        </button>
        <button type="button" className="icon-btn" aria-label={`Move ${template.section_name} up`} onClick={() => void saveOrder(applyShift(structure, id, -1))}>
          <span className="material-symbols-outlined">arrow_upward</span>
        </button>
        <button type="button" className="icon-btn" aria-label={`Move ${template.section_name} down`} onClick={() => void saveOrder(applyShift(structure, id, 1))}>
          <span className="material-symbols-outlined">arrow_downward</span>
        </button>
      </li>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div className="flex items-center gap-2">
        <Link to="/settings/layouts" className="icon-btn" aria-label="Back to layouts">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <h1 className="font-headline text-2xl font-semibold">{layout.name}</h1>
        {layout.is_system && <span className="rounded-full border border-hairline px-2 py-0.5 text-xs text-muted">Built-in</span>}
      </div>
      {error && <p className="text-alert">{error}</p>}
      {notice && <p className="text-muted" role="status">{notice}</p>}

      <form aria-label="Layout details" className="bg-panel border border-hairline rounded-lg p-4 grid gap-3 md:grid-cols-[1fr_2fr_auto] items-end" onSubmit={(event) => void saveDetails(event)}>
        <label className="block text-sm">
          Document name
          <input className="field mt-1" aria-label="Layout name" value={details.name} maxLength={100} onChange={(event) => setDetails({ ...details, name: event.target.value })} />
        </label>
        <label className="block text-sm">
          Description
          <input className="field mt-1" aria-label="Layout description" value={details.description} maxLength={500} onChange={(event) => setDetails({ ...details, description: event.target.value })} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!details.name.trim()}>Save details</button>
      </form>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="bg-panel border border-hairline rounded-lg p-3 space-y-2" aria-label="Sections">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => setAdding({ parentId: null })}>
              <span className="material-symbols-outlined">add</span>
              Add section
            </button>
            <button
              type="button"
              className="btn"
              disabled={!selected}
              onClick={() => selected && setAdding({ parentId: selectedIsChild ? selected.parent_id : selected.template_id })}
            >
              <span className="material-symbols-outlined">subdirectory_arrow_right</span>
              Add sub-section
            </button>
          </div>
          {structure.length === 0 ? (
            <p className="text-muted text-sm">This layout has no sections yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {structure.map((node) => (
                <li key={node.template_id}>
                  <ul>
                    {row(node.template_id, 0)}
                    {node.children.map((childId) => row(childId, 1))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">Drag to reorder or use the arrows. Drop a sub-section on a section to move it there.</p>
        </aside>

        {selected && form ? (
          <form aria-label="Section settings" className="bg-panel border border-hairline rounded-lg p-4 space-y-4" onSubmit={(event) => void saveSection(event)}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-headline text-lg font-semibold">{selected.section_name}</h2>
              <button type="button" className="btn btn-danger" onClick={() => setRemoving(selected)}>
                <span className="material-symbols-outlined">delete</span>
                Delete section
              </button>
            </div>
            <label className="block text-sm">
              Section name
              <input className="field mt-1" aria-label="Section name" value={form.name} maxLength={150} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            {selectedIsChild && (
              <label className="block text-sm">
                Parent section
                <select
                  className="field mt-1"
                  aria-label="Parent section"
                  value={selected.parent_id ?? ""}
                  onChange={(event) => void saveOrder(applyReparent(structure, selected.template_id, event.target.value))}
                >
                  {structure.map((node) => (
                    <option key={node.template_id} value={node.template_id}>
                      {nameOf(node.template_id)}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            <button type="submit" className="btn btn-primary" disabled={!form.name.trim() || form.blocks.length === 0}>Save section</button>
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
          message={`Delete ${removing.section_name}${removing.parent_id ? "" : " and its sub-sections"}? Existing documents lose that content.`}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/api/templates/${removing.template_id}`, { method: "DELETE" });
            const remaining = layout.templates.filter((item) => item.template_id !== removing.template_id && item.parent_id !== removing.template_id);
            setLayout({ ...layout, templates: remaining });
            setSelectedId(byOrder(remaining)[0]?.template_id ?? "");
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
