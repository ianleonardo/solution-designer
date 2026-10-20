import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type {
  BlockSpec,
  Catalogs,
  InterfaceRecord,
  KbCapabilityRecord,
  KbReportRecord,
  KbSource,
  KbTableRecord,
  Project,
  Sdd,
  Section,
  SystemRecord,
  TableBlock,
} from "../types";
import { LinkPickerDialog, type LinkPickerRow } from "./LinkPickerDialog";
import { SelectField } from "./SelectField";

const NOUN: Record<KbSource, string> = { capabilities: "capabilities", interfaces: "interfaces", reports: "reports", tables: "tables" };
const KIND: Record<KbSource, string> = { capabilities: "capability", interfaces: "interface", reports: "report", tables: "column" };
const COLUMNS: Record<KbSource, string[]> = {
  capabilities: ["Capability (L1 › L2 › L3)", "System", "Countries"],
  interfaces: ["Interface Name", "Channel", "Source → Destination", "Protocol", "Countries"],
  reports: ["Report Name", "Report Code", "System", "Countries"],
  tables: ["Table", "Country", "Description"],
};

/** The Knowledge Base source of a section, taken from its first table that names one. */
export function kbSourceOf(blocks: BlockSpec[] | undefined): KbSource | null {
  const table = (blocks ?? []).find((block) => block.type === "table" && block.source);
  return table && table.type === "table" && table.source ? table.source : null;
}

function codes(value: string | undefined) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Item applies to one of `wanted` (an empty or "ALL" item country applies everywhere). */
function countryMatches(itemCountry: string, wanted: string[] | null) {
  if (!wanted) return true;
  const item = codes(itemCountry).map((code) => code.toUpperCase());
  if (item.length === 0 || item.includes("ALL")) return true;
  return item.some((code) => wanted.includes(code));
}

function countriesText(value: string) {
  const list = codes(value);
  return list.length && !list.some((code) => code.toUpperCase() === "ALL") ? list.join(", ") : "All";
}

type Catalog = {
  capabilities: KbCapabilityRecord[];
  interfaces: InterfaceRecord[];
  reports: KbReportRecord[];
  tables: KbTableRecord[];
};

async function loadCatalog(source: KbSource): Promise<Partial<Catalog>> {
  if (source === "capabilities") return { capabilities: await api<KbCapabilityRecord[]>("/api/capabilities") };
  if (source === "reports") return { reports: await api<KbReportRecord[]>("/api/reports") };
  if (source === "tables") return { tables: await api<KbTableRecord[]>("/api/tables") };
  const catalogs = await api<Catalogs>("/api/catalogs").catch(() => null);
  const channels = catalogs?.interface_channels?.length ? catalogs.interface_channels : ["EAI"];
  let interfaces: InterfaceRecord[] = [];
  for (const channel of channels) {
    try {
      interfaces = [...interfaces, ...(await api<InterfaceRecord[]>(`/api/interfaces/${encodeURIComponent(channel)}`))];
    } catch {
      // A channel can be empty.
    }
  }
  return { interfaces };
}

/** Items already in the section: linked row ids, or database tables already listed. */
export function presentIds(section: Section | undefined, source: KbSource): Set<string> {
  const ids = new Set<string>();
  for (const block of section?.blocks ?? []) {
    if (block.type !== "table") continue;
    if (source === "tables") {
      if (block.kb_table_id) ids.add(block.kb_table_id);
      continue;
    }
    for (const link of block.links ?? []) if (link && link.kind === KIND[source]) ids.add(link.id);
  }
  return ids;
}

type Suggestion = { section_id: string; section_title: string; source: KbSource; items: { id: string; label: string }[] };

// --- choosing the changed fields of database tables -------------------------------------------------------------

export function TableFieldsDialog({
  tables,
  present,
  onSubmit,
  onClose,
}: {
  tables: { table_id: string; label: string }[];
  /** column ids already listed, per table */
  present: Record<string, string[]>;
  onSubmit: (choices: { table_id: string; column_ids: string[] }[]) => Promise<void>;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<Record<string, KbTableRecord>>({});
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tableKey = tables.map((item) => item.table_id).join("|");

  useEffect(() => {
    let current = true;
    void Promise.all(tables.map((item) => api<KbTableRecord>(`/api/tables/${encodeURIComponent(item.table_id)}`).catch(() => null))).then(
      (loaded) => {
        if (!current) return;
        const next: Record<string, KbTableRecord> = {};
        loaded.forEach((record) => {
          if (record) next[record.table_id] = record;
        });
        setDetails(next);
      },
    );
    return () => {
      current = false;
    };
  }, [tableKey]);

  function toggle(tableId: string, columnId: string) {
    setTicked((current) => {
      const list = current[tableId] ?? [];
      return { ...current, [tableId]: list.includes(columnId) ? list.filter((id) => id !== columnId) : [...list, columnId] };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(tables.map((item) => ({ table_id: item.table_id, column_ids: ticked[item.table_id] ?? [] })));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the fields");
      setBusy(false);
    }
  }

  const total = Object.values(ticked).reduce((sum, list) => sum + list.length, 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label="Choose changed fields" className="flex w-full max-w-3xl max-h-[85vh] flex-col gap-3 rounded-lg border border-hairline bg-panel p-6 shadow-xl" onSubmit={(e) => void submit(e)}>
        <div>
          <h2 className="font-headline text-lg font-semibold">Choose changed fields</h2>
          <p className="text-sm text-muted">Tick only the fields this project adds or changes. Untouched fields stay out of the document.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto space-y-4">
          {tables.map((item) => {
            const record = details[item.table_id];
            const already = new Set(present[item.table_id] ?? []);
            const columns = (record?.columns ?? []).filter((column) => !already.has(column.column_id));
            const chosen = ticked[item.table_id] ?? [];
            return (
              <fieldset key={item.table_id} className="rounded border border-hairline">
                <legend className="ml-2 px-1 font-label text-xs font-semibold">{item.label}</legend>
                {!record ? (
                  <p className="p-3 text-sm text-muted">Loading fields…</p>
                ) : columns.length === 0 ? (
                  <p className="p-3 text-sm text-muted">Every field of this table is already in the document.</p>
                ) : (
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-hairline font-label text-[10px] uppercase text-muted">
                        <th className="py-2 px-3 w-10">
                          <input
                            type="checkbox"
                            aria-label={`Select all fields of ${item.label}`}
                            checked={chosen.length === columns.length}
                            onChange={() =>
                              setTicked((current) => ({ ...current, [item.table_id]: chosen.length === columns.length ? [] : columns.map((column) => column.column_id) }))
                            }
                          />
                        </th>
                        <th className="py-2 px-3">Field</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map((column) => (
                        <tr key={column.column_id} className={`border-b border-hairline last:border-b-0 cursor-pointer ${chosen.includes(column.column_id) ? "bg-inset" : "hover:bg-inset/50"}`} onClick={() => toggle(item.table_id, column.column_id)}>
                          <td className="py-1.5 px-3">
                            <input
                              type="checkbox"
                              aria-label={`Field ${column.column_name}`}
                              checked={chosen.includes(column.column_id)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggle(item.table_id, column.column_id)}
                            />
                          </td>
                          <td className="py-1.5 px-3 font-label text-xs">{column.column_name}</td>
                          <td className="py-1.5 px-3 text-muted">{column.data_type}</td>
                          <td className="py-1.5 px-3 text-muted">{column.description || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </fieldset>
            );
          })}
        </div>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="font-label text-[11px] text-muted">{total} field{total === 1 ? "" : "s"} ticked</span>
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Adding…" : total ? `Add ${total} field${total === 1 ? "" : "s"}` : "Add table only"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// --- related items offer ------------------------------------------------------------------------------------------

function RelatedDialog({
  suggestions,
  onSubmit,
  onClose,
}: {
  suggestions: Suggestion[];
  onSubmit: (chosen: Suggestion[]) => Promise<void>;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(suggestions.map((item) => [item.section_id, item.items.map((entry) => entry.id)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = Object.values(chosen).reduce((sum, list) => sum + list.length, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(
        suggestions
          .map((item) => ({ ...item, items: item.items.filter((entry) => (chosen[item.section_id] ?? []).includes(entry.id)) }))
          .filter((item) => item.items.length),
      );
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the related items");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label="Add related items" className="flex w-full max-w-xl max-h-[85vh] flex-col gap-3 rounded-lg border border-hairline bg-panel p-6 shadow-xl" onSubmit={(e) => void submit(e)}>
        <div>
          <h2 className="font-headline text-lg font-semibold">Add related items too?</h2>
          <p className="text-sm text-muted">These are linked to what you just added in the Knowledge Base and are not in their sections yet.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto space-y-3">
          {suggestions.map((item) => (
            <fieldset key={item.section_id} className="rounded border border-hairline p-3">
              <legend className="px-1 text-sm font-semibold">{item.section_title}</legend>
              <div className="space-y-1">
                {item.items.map((entry) => (
                  <label key={entry.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`${item.section_title}: ${entry.label}`}
                      checked={(chosen[item.section_id] ?? []).includes(entry.id)}
                      onChange={() =>
                        setChosen((current) => {
                          const list = current[item.section_id] ?? [];
                          return { ...current, [item.section_id]: list.includes(entry.id) ? list.filter((id) => id !== entry.id) : [...list, entry.id] };
                        })
                      }
                    />
                    {entry.label}
                  </label>
                ))}
              </div>
              {item.source === "tables" && <p className="mt-2 text-xs text-muted">Tables are added by name. Use “Choose fields” on each one to tick its changed fields.</p>}
            </fieldset>
          ))}
        </div>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Skip
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || total === 0}>
            {busy ? "Adding…" : `Add ${total} related`}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- the section toolbar -------------------------------------------------------------------------------------------

type Step = { kind: "pick" } | { kind: "fields"; tables: { table_id: string; label: string }[] } | { kind: "related"; suggestions: Suggestion[] } | null;

export function KbSectionToolbar({
  base,
  sectionId,
  source,
  section,
  project,
  readOnly,
  beforeChange,
  onDocument,
  onError,
}: {
  /** `/api/projects/{id}/documents/{id}` */
  base: string;
  sectionId: string;
  source: KbSource;
  section: Section | undefined;
  project: Project;
  readOnly: boolean;
  /** Save any edit still waiting, so the server starts from the latest content. */
  beforeChange: () => Promise<void>;
  onDocument: (fresh: Sdd) => void;
  onError: (message: string) => void;
}) {
  const [step, setStep] = useState<Step>(null);
  const [catalog, setCatalog] = useState<Partial<Catalog> | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [systems, setSystems] = useState<SystemRecord[]>([]);
  const scopeCountries = project.countries ?? [];
  const scopeSystems = project.systems ?? [];
  const [countryFilter, setCountryFilter] = useState(scopeCountries.length ? "scope" : "");
  const [systemFilter, setSystemFilter] = useState(scopeSystems.length ? "scope" : "");
  const [refreshing, setRefreshing] = useState(false);

  const links = (section?.blocks ?? []).flatMap((block) => (block.type === "table" ? (block.links ?? []) : [])).filter(Boolean);
  const changed = links.filter((link) => link?.state === "changed").length;
  const deleted = links.filter((link) => link?.state === "deleted").length;

  async function open() {
    setStep({ kind: "pick" });
    setCatalog(null);
    try {
      const [loaded, catalogs, systemList] = await Promise.all([
        loadCatalog(source),
        api<Catalogs>("/api/catalogs").catch(() => null),
        api<SystemRecord[]>("/api/systems").catch(() => [] as SystemRecord[]),
      ]);
      setCatalog(loaded);
      setCountries(catalogs?.countries ?? []);
      setSystems(Array.isArray(systemList) ? systemList : []);
    } catch (err) {
      setStep(null);
      onError(err instanceof ApiError ? err.message : "Could not load the Knowledge Base");
    }
  }

  async function post(target: string, body: object) {
    return api<Sdd>(`${base}/sections/${target}/kb-links`, { method: "POST", body: JSON.stringify(body) });
  }

  const present = useMemo(() => presentIds(section, source), [section, source]);
  const wantedCountries = countryFilter === "scope" ? scopeCountries : countryFilter ? [countryFilter] : null;
  const wantedSystems = systemFilter === "scope" ? scopeSystems : systemFilter ? [systemFilter] : null;
  const systemMatches = (...values: string[]) => !wantedSystems || values.some((value) => wantedSystems.includes(value));

  const rows: LinkPickerRow[] = useMemo(() => {
    if (!catalog) return [];
    if (source === "capabilities")
      return (catalog.capabilities ?? [])
        .filter((row) => !present.has(row.capability_id) && countryMatches(row.country, wantedCountries) && systemMatches(row.system_code))
        .map((row) => ({
          id: row.capability_id,
          label: `${row.l1_capability} › ${row.l2_capability} › ${row.l3_capability}`,
          cells: [`${row.l1_capability} › ${row.l2_capability} › ${row.l3_capability}`, row.system_code, countriesText(row.country)],
        }));
    if (source === "interfaces")
      return (catalog.interfaces ?? [])
        .filter((row) => !present.has(row.interface_id) && countryMatches(row.country, wantedCountries) && systemMatches(row.source, row.destination))
        .map((row) => ({
          id: row.interface_id,
          label: row.interface_name,
          cells: [row.interface_name, row.channel, [row.source, row.destination].filter(Boolean).join(" → "), row.protocol, countriesText(row.country)],
        }));
    if (source === "reports")
      return (catalog.reports ?? [])
        .filter((row) => !present.has(row.report_id) && countryMatches(row.country, wantedCountries) && systemMatches(row.system_code))
        .map((row) => ({ id: row.report_id, label: row.report_name, cells: [row.report_name, row.report_code, row.system_code, countriesText(row.country)] }));
    return (catalog.tables ?? [])
      .filter((row) => !present.has(row.table_id) && countryMatches(row.country, wantedCountries))
      .map((row) => {
        const label = [row.database_name, row.schema_name, row.table_name].filter(Boolean).join(".");
        return { id: row.table_id, label, cells: [label, row.country, row.description] };
      });
  }, [catalog, source, present, countryFilter, systemFilter]);

  async function pick(ids: string[]) {
    if (source === "tables") {
      const labels = new Map(rows.map((row) => [row.id, row.label]));
      setStep({ kind: "fields", tables: ids.map((id) => ({ table_id: id, label: labels.get(id) ?? id })) });
      return;
    }
    await beforeChange();
    const fresh = await post(sectionId, { ids });
    onDocument(fresh);
    if (source === "capabilities" || source === "interfaces") {
      const suggestions = await api<Suggestion[]>(`${base}/sections/${sectionId}/kb-related`, { method: "POST", body: JSON.stringify({ ids }) }).catch(
        () => [] as Suggestion[],
      );
      if (suggestions.length) {
        setStep({ kind: "related", suggestions });
        return;
      }
    }
    setStep(null);
  }

  async function addFields(choices: { table_id: string; column_ids: string[] }[]) {
    await beforeChange();
    let fresh: Sdd | null = null;
    for (const choice of choices) fresh = await post(sectionId, choice);
    if (fresh) onDocument(fresh);
  }

  async function addRelated(chosen: Suggestion[]) {
    let fresh: Sdd | null = null;
    for (const item of chosen) {
      if (item.source === "tables") {
        for (const entry of item.items) fresh = await post(item.section_id, { table_id: entry.id, column_ids: [] });
      } else {
        fresh = await post(item.section_id, { ids: item.items.map((entry) => entry.id) });
      }
    }
    if (fresh) onDocument(fresh);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await beforeChange();
      onDocument(await api<Sdd>(`${base}/sections/${sectionId}/kb-refresh`, { method: "POST" }));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not refresh from the Knowledge Base");
    } finally {
      setRefreshing(false);
    }
  }

  const scopeOption = (list: string[]) => ({ value: "scope", label: `Project scope (${list.join(", ")})` });
  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="block font-label text-[10px] uppercase text-muted">Country</span>
        <div className="mt-1">
          <SelectField
            aria-label="Filter by country"
            value={countryFilter}
            className="min-w-[12rem] [&_button]:w-full"
            options={[...(scopeCountries.length ? [scopeOption(scopeCountries)] : []), { value: "", label: "All countries" }, ...countries.map((code) => ({ value: code, label: code }))]}
            onChange={setCountryFilter}
          />
        </div>
      </label>
      {source !== "tables" && (
        <label className="text-sm">
          <span className="block font-label text-[10px] uppercase text-muted">System</span>
          <div className="mt-1">
            <SelectField
              aria-label="Filter by system"
              value={systemFilter}
              className="min-w-[12rem] [&_button]:w-full"
              options={[
                ...(scopeSystems.length ? [scopeOption(scopeSystems)] : []),
                { value: "", label: "All systems" },
                ...systems.map((item) => ({ value: item.system_code, label: item.system_code, hint: item.system_name })),
              ]}
              onChange={setSystemFilter}
            />
          </div>
        </label>
      )}
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-inset/40 px-3 py-2">
      <span className="material-symbols-outlined text-base text-accent" aria-hidden="true">
        database
      </span>
      <span className="text-sm text-muted mr-auto">
        {links.length ? `${links.length} row${links.length === 1 ? "" : "s"} from the Knowledge Base` : `Fill this table from the Knowledge Base ${NOUN[source]}.`}
        {changed > 0 && <span className="ml-2 text-[#c77700]">{changed} changed since added</span>}
        {deleted > 0 && <span className="ml-2 text-alert">{deleted} no longer in the Knowledge Base</span>}
      </span>
      {!readOnly && links.length > 0 && (
        <button type="button" className="btn" disabled={refreshing} onClick={() => void refresh()} title="Update the Knowledge Base columns of linked rows. Your own columns are kept.">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            sync
          </span>
          {refreshing ? "Refreshing…" : "Refresh from Knowledge Base"}
        </button>
      )}
      {!readOnly && (
        <button type="button" className="btn" onClick={() => void open()}>
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            add
          </span>
          Add from Knowledge Base
        </button>
      )}
      {step?.kind === "pick" &&
        (catalog ? (
          <LinkPickerDialog
            title={`Add ${NOUN[source]} from the Knowledge Base`}
            noun={NOUN[source]}
            country={wantedCountries ? wantedCountries.join(", ") : "all countries"}
            intro={
              source === "tables"
                ? "Pick the database tables this project changes. Next you tick only the changed fields."
                : `Pick the ${NOUN[source]} for this section. Each becomes a row linked to the Knowledge Base.`
            }
            emptyText={`No ${NOUN[source]} match these filters, or they are all in this section already.`}
            actionLabel={source === "tables" ? "Next:" : "Add"}
            columns={COLUMNS[source]}
            rows={rows}
            toolbar={toolbar}
            onPick={pick}
            onClose={() => setStep((current) => (current?.kind === "pick" ? null : current))}
          />
        ) : (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation">
            <div role="status" className="rounded-lg border border-hairline bg-panel p-6 text-sm shadow-xl">
              Loading the Knowledge Base…
            </div>
          </div>
        ))}
      {step?.kind === "fields" && <TableFieldsDialog tables={step.tables} present={{}} onSubmit={addFields} onClose={() => setStep(null)} />}
      {step?.kind === "related" && <RelatedDialog suggestions={step.suggestions} onSubmit={addRelated} onClose={() => setStep(null)} />}
    </div>
  );
}

/** Column ids already listed in a table block of New/Updated Tables. */
export function presentColumns(block: TableBlock): string[] {
  return (block.links ?? []).filter((link) => link?.kind === "column").map((link) => link!.id);
}
