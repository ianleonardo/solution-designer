import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { KbCapabilityNode } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { DiagramPopup, MermaidPreview } from "./DiagramBlock";
import { DownloadButtons } from "./DownloadButtons";
import { ProcessingRulesEditor } from "./ProcessingRulesEditor";
import { SequenceDiagramsDialog, type SequenceDiagram } from "./SequenceDiagramsDialog";

/** One L1 or L2 capability of a system, identified by its names. */
export type CapabilityNodeRef = { systemCode: string; level: 1 | 2; l1: string; l2: string };

function codes(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function nodeApplicableFor(country: string) {
  const list = codes(country);
  return list.length ? list.join(", ") : "All countries";
}

function applies(country: string, filter: string) {
  const list = codes(country);
  return !filter || list.length === 0 || list.some((code) => code.toLowerCase() === filter.toLowerCase());
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function recordsFor(nodes: KbCapabilityNode[], ref: CapabilityNodeRef) {
  return nodes.filter(
    (node) =>
      node.system_code === ref.systemCode &&
      node.level === ref.level &&
      same(node.l1_capability, ref.l1) &&
      (ref.level === 1 || same(node.l2_capability, ref.l2)),
  );
}

/** True when the node has details that apply to the country (or to any country when the filter is empty). */
export function hasDetails(nodes: KbCapabilityNode[], ref: CapabilityNodeRef, country: string) {
  return recordsFor(nodes, ref).some((node) => applies(node.country, country));
}

function nodeTitle(ref: CapabilityNodeRef) {
  return ref.level === 1 ? ref.l1 : `${ref.l1} › ${ref.l2}`;
}

function CountryPicker({
  countries,
  all,
  selected,
  disabled,
  onAll,
  onToggle,
}: {
  countries: string[];
  all: boolean;
  selected: string[];
  disabled: boolean;
  onAll: (value: boolean) => void;
  onToggle: (code: string) => void;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="font-label text-[10px] uppercase text-muted">Applicable for</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label="All countries" checked={all} onChange={(event) => onAll(event.target.checked)} />
          All countries
        </label>
        {countries.map((code) => (
          <label key={code} className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label={code} checked={!all && selected.includes(code)} onChange={() => onToggle(code)} />
            {code}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DiagramList({ diagrams, onView }: { diagrams: SequenceDiagram[]; onView: (diagram: SequenceDiagram) => void }) {
  if (diagrams.length === 0) return <p className="mt-1 text-sm text-muted">No diagrams.</p>;
  return (
    <ul className="mt-1 space-y-3">
      {diagrams.map((diagram) => (
        <li key={diagram.id} className="rounded-lg border border-hairline p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{diagram.title}</p>
            <button type="button" className="btn" aria-label={`Expand ${diagram.title}`} title="Expand diagram" onClick={() => onView(diagram)}>
              <span className="material-symbols-outlined text-base">open_in_full</span>
              Expand
            </button>
          </div>
          <MermaidPreview source={diagram.mermaid} />
        </li>
      ))}
    </ul>
  );
}

/** Add or edit the details of an L1 / L2 capability. */
export function CapabilityNodeFormDialog({
  node,
  record,
  countries,
  defaultCountry,
  onSaved,
  onClose,
}: {
  node: CapabilityNodeRef;
  record?: KbCapabilityNode;
  countries: string[];
  defaultCountry?: string;
  onSaved: (saved: KbCapabilityNode) => void;
  onClose: () => void;
}) {
  const stored = record ? codes(record.country) : null;
  const [all, setAll] = useState(stored ? stored.length === 0 : !defaultCountry);
  const [selected, setSelected] = useState<string[]>(stored ?? (defaultCountry ? [defaultCountry] : []));
  const [description, setDescription] = useState(record?.description ?? "");
  const [behavior, setBehavior] = useState(record?.country_behavior ?? "");
  const [diagrams, setDiagrams] = useState<SequenceDiagram[]>(record?.sequence_diagrams ?? []);
  const [editingDiagrams, setEditingDiagrams] = useState(false);
  const [viewing, setViewing] = useState<SequenceDiagram | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const country = all ? "" : countries.filter((code) => selected.includes(code)).join(",");
    if (!all && !country) {
      setError("Choose All countries or at least one country.");
      return;
    }
    setBusy(true);
    setError("");
    const body = { country, description, country_behavior: behavior, sequence_diagrams: diagrams };
    try {
      const saved = record
        ? await api<KbCapabilityNode>(`/api/capability-nodes/${encodeURIComponent(record.node_id)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<KbCapabilityNode>("/api/capability-nodes", {
            method: "POST",
            body: JSON.stringify({ ...body, system_code: node.systemCode, level: node.level, l1_capability: node.l1, l2_capability: node.l2 }),
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the details");
    } finally {
      setBusy(false);
    }
  }

  const title = `${record ? "Edit" : "Add"} L${node.level} details`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3" onSubmit={(event) => void submit(event)}>
        <div>
          <h2 className="font-headline text-xl font-semibold">{title}</h2>
          <p className="text-xs text-muted mt-1">
            {node.systemCode} · {nodeTitle(node)}
          </p>
        </div>
        <CountryPicker
          countries={countries}
          all={all}
          selected={selected}
          disabled={busy}
          onAll={(value) => {
            setAll(value);
            if (value) setSelected([]);
          }}
          onToggle={(code) => {
            setAll(false);
            setSelected((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
          }}
        />
        <div>
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <div className="mt-1">
            <ProcessingRulesEditor value={description} onChange={setDescription} readOnly={busy} label={`L${node.level} description`} toolbarLabel="Description formatting" />
          </div>
        </div>
        <div>
          <span className="font-label text-[10px] uppercase text-muted">Country specific behavior</span>
          <div className="mt-1">
            <ProcessingRulesEditor value={behavior} onChange={setBehavior} readOnly={busy} label="Country specific behavior" toolbarLabel="Country specific behavior formatting" />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-label text-[10px] uppercase text-muted">Diagrams</span>
            <button type="button" className="btn" disabled={busy} onClick={() => setEditingDiagrams(true)}>
              Add / edit
            </button>
          </div>
          <DiagramList diagrams={diagrams} onView={setViewing} />
        </div>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {record ? "Save" : "Add"}
          </button>
        </div>
      </form>
      {editingDiagrams && (
        <SequenceDiagramsDialog
          diagrams={diagrams}
          onClose={() => setEditingDiagrams(false)}
          onSave={(next) => {
            setDiagrams(next);
            setEditingDiagrams(false);
          }}
        />
      )}
      {viewing && <DiagramPopup source={viewing.mermaid} title={viewing.title} onClose={() => setViewing(null)} />}
    </div>
  );
}

function RenameDialog({ node, onRenamed, onClose }: { node: CapabilityNodeRef; onRenamed: (name: string) => void; onClose: () => void }) {
  const current = node.level === 1 ? node.l1 : node.l2;
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a name.");
    setBusy(true);
    setError("");
    try {
      const result = await api<{ new_name: string }>("/api/capability-nodes/rename", {
        method: "POST",
        body: JSON.stringify({ system_code: node.systemCode, level: node.level, l1_capability: node.l1, l2_capability: node.l2, new_name: name }),
      });
      onRenamed(result.new_name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={`Rename L${node.level}`} className="w-full max-w-md rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-xl font-semibold">Rename L{node.level}</h2>
        <p className="text-sm text-muted">
          Renames “{current}” in {node.systemCode} for every country. Its L3 capabilities and details move with it.
        </p>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">New name</span>
          <input className="field mt-1" aria-label="New name" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || name.trim() === current}>
            Rename
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The window for one L1 or L2 capability: its description, country specific behavior and diagrams.
 * A node can have one record per country selection; the one for `country` is shown first.
 */
export function CapabilityNodeWindow({
  node,
  systemName,
  country,
  countries,
  childLabel,
  childNames,
  canEdit,
  onChanged,
  onRenamed,
  onClose,
}: {
  node: CapabilityNodeRef;
  systemName?: string;
  country: string;
  countries: string[];
  childLabel?: string;
  childNames?: string[];
  canEdit: boolean;
  /** Called after details are added, edited or deleted. */
  onChanged?: () => void;
  /** Called after a rename; the window closes because the node now has another name. */
  onRenamed?: () => void;
  onClose: () => void;
}) {
  const [nodes, setNodes] = useState<KbCapabilityNode[] | null>(null);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<{ record?: KbCapabilityNode } | null>(null);
  const [deleting, setDeleting] = useState<KbCapabilityNode | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [viewing, setViewing] = useState<SequenceDiagram | null>(null);

  const load = useCallback(async () => {
    try {
      setNodes(await api<KbCapabilityNode[]>(`/api/capability-nodes?system=${encodeURIComponent(node.systemCode)}`));
      setError("");
    } catch (err) {
      setNodes([]);
      setError(err instanceof ApiError ? err.message : "Could not load the details");
    }
  }, [node.systemCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const records = useMemo(() => {
    const list = recordsFor(nodes ?? [], node);
    // The record for the current country first, then the rest in the order countries are listed.
    return list.slice().sort((a, b) => Number(applies(b.country, country)) - Number(applies(a.country, country)) || a.country.localeCompare(b.country));
  }, [nodes, node, country]);
  const active = records.find((record) => record.node_id === activeId) ?? records[0];
  const forCountry = records.find((record) => applies(record.country, country));
  const taken = new Set(records.flatMap((record) => (codes(record.country).length ? codes(record.country) : countries)));
  const canAddAnother = canEdit && !records.some((record) => codes(record.country).length === 0) && countries.some((code) => !taken.has(code));

  const label = `L${node.level} capability`;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`${label} details`} className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-label text-[10px] uppercase text-muted">
              {label} · {node.systemCode}
              {systemName && systemName !== node.systemCode ? ` — ${systemName}` : ""}
            </p>
            <h2 className="font-headline text-xl font-semibold break-words">{nodeTitle(node)}</h2>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {canEdit && (
              <button type="button" className="btn" onClick={() => setRenaming(true)}>
                <span className="material-symbols-outlined text-base">drive_file_rename_outline</span>
                Rename
              </button>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {childNames && childNames.length > 0 && (
          <div>
            <span className="font-label text-[10px] uppercase text-muted">
              {childLabel ?? "Contains"} ({childNames.length}
              {country ? ` in ${country}` : ""})
            </span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {childNames.map((name) => (
                <span key={name} className="rounded-full border border-hairline bg-inset px-2.5 py-0.5 text-xs">
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {nodes === null ? (
          <p className="text-muted">Loading…</p>
        ) : records.length === 0 ? (
          <div className="rounded-lg border border-dashed border-hairline p-6 text-center space-y-3">
            <p className="text-muted">No details yet for this {label}.</p>
            {canEdit && (
              <button type="button" className="btn btn-primary" onClick={() => setForm({})}>
                <span className="material-symbols-outlined text-base">add</span>
                Add details
              </button>
            )}
          </div>
        ) : (
          <>
            {(records.length > 1 || !forCountry || canAddAnother) && (
              <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Country versions">
                {records.map((record) => (
                  <button
                    key={record.node_id}
                    type="button"
                    role="tab"
                    aria-selected={record.node_id === active?.node_id}
                    className={`rounded-full border px-3 py-1 text-xs ${record.node_id === active?.node_id ? "border-[var(--accent,currentColor)] bg-inset font-semibold" : "border-hairline"}`}
                    onClick={() => setActiveId(record.node_id)}
                  >
                    {nodeApplicableFor(record.country)}
                  </button>
                ))}
                {canAddAnother && (
                  <button type="button" className="btn" onClick={() => setForm({})}>
                    <span className="material-symbols-outlined text-base">add</span>
                    Details for other countries
                  </button>
                )}
              </div>
            )}
            {country && !forCountry && <p className="text-sm text-[#c77700]">No details apply to {country}. Showing another country’s version.</p>}
            {active && (
              <article className="space-y-4" aria-label={`Details for ${nodeApplicableFor(active.country)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-label text-[10px] uppercase text-muted">Applicable for </span>
                    {nodeApplicableFor(active.country)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <DownloadButtons path={`/api/capability-nodes/${encodeURIComponent(active.node_id)}/export`} filename={`L${node.level}-${nodeTitle(node)}`} />
                    {canEdit && (
                      <>
                        <button type="button" className="btn" onClick={() => setForm({ record: active })}>
                          <span className="material-symbols-outlined text-base">edit</span>
                          Edit
                        </button>
                        <button type="button" className="btn" aria-label="Delete details" onClick={() => setDeleting(active)}>
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <section>
                  <h3 className="font-label text-[10px] uppercase text-muted">Description</h3>
                  {active.description.trim() ? (
                    <div className="mt-1" key={`d-${active.node_id}-${active.last_modified}`}>
                      <ProcessingRulesEditor value={active.description} onChange={() => undefined} readOnly label={`L${node.level} description`} />
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted">No description.</p>
                  )}
                </section>
                {active.country_behavior.trim() && (
                  <section>
                    <h3 className="font-label text-[10px] uppercase text-muted">Country specific behavior</h3>
                    <div className="mt-1" key={`b-${active.node_id}-${active.last_modified}`}>
                      <ProcessingRulesEditor value={active.country_behavior} onChange={() => undefined} readOnly label="Country specific behavior" />
                    </div>
                  </section>
                )}
                <section>
                  <h3 className="font-label text-[10px] uppercase text-muted">Diagrams</h3>
                  <DiagramList diagrams={active.sequence_diagrams} onView={setViewing} />
                </section>
              </article>
            )}
          </>
        )}
        {error && <p className="text-alert text-sm">{error}</p>}
      </div>

      {form && (
        <CapabilityNodeFormDialog
          node={node}
          record={form.record}
          countries={countries}
          defaultCountry={form.record ? undefined : records.length ? countries.find((code) => !taken.has(code)) : undefined}
          onSaved={(saved) => {
            setForm(null);
            setActiveId(saved.node_id);
            void load();
            onChanged?.();
          }}
          onClose={() => setForm(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete details"
          message={`Delete the ${label} details for ${nodeApplicableFor(deleting.country)}? The capabilities themselves are kept.`}
          onConfirm={async () => {
            await api(`/api/capability-nodes/${encodeURIComponent(deleting.node_id)}`, { method: "DELETE" });
            setDeleting(null);
            setActiveId(null);
            await load();
            onChanged?.();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {renaming && (
        <RenameDialog
          node={node}
          onRenamed={() => {
            setRenaming(false);
            onRenamed?.();
            onClose();
          }}
          onClose={() => setRenaming(false)}
        />
      )}
      {viewing && <DiagramPopup source={viewing.mermaid} title={viewing.title} onClose={() => setViewing(null)} />}
    </div>
  );
}
