import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type {
  Catalogs,
  InterfaceRecord,
  KbBatchRecord,
  KbCapabilityLinkBatch,
  KbCapabilityLinkInterface,
  KbCapabilityLinkReport,
  KbCapabilityLinkTable,
  KbCapabilityRecord,
  KbReportRecord,
  KbTableRecord,
  SystemRecord,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { SortHeader, sortRows, toggleColumnSort, type ColumnSort } from "./SortHeader";
import { ProcessingRulesEditor } from "./ProcessingRulesEditor";
import { SelectField } from "./SelectField";

function inferredDescription(l1: string, l2: string, l3: string) {
  const [area, group, feature] = [l1, l2, l3].map((part) => part.trim());
  if (!area || !group || !feature) return "";
  return `Provides ${feature} as a ${group} feature of ${area}.`;
}

function capabilityDescription(row: Pick<KbCapabilityRecord, "description" | "l1_capability" | "l2_capability" | "l3_capability">) {
  return (row.description || "").trim() || inferredDescription(row.l1_capability, row.l2_capability, row.l3_capability);
}

function countryCodes(value: string) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

/** Empty country applies everywhere. A list applies to those codes. */
export function applicableFor(country: string) {
  const codes = countryCodes(country);
  return codes.length ? codes.join(", ") : "All countries";
}

function appliesToCountry(country: string, filter: string) {
  if (!filter) return true;
  const codes = countryCodes(country);
  return codes.length === 0 || codes.some((code) => code.toLowerCase() === filter.trim().toLowerCase());
}

function UploadCapabilitiesDialog({
  countries,
  systems,
  onUploaded,
  onClose,
}: {
  countries: string[];
  systems: SystemRecord[];
  onUploaded: (capabilities: KbCapabilityRecord[]) => void;
  onClose: () => void;
}) {
  const [country, setCountry] = useState(countries.includes("SG") ? "SG" : countries[0] ?? "SG");
  const [system, setSystem] = useState(systems[0]?.system_code ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<RowError[]>([]);

  useEffect(() => {
    if (!system && systems[0]) setSystem(systems[0].system_code);
  }, [systems, system]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !system) {
      setError(!file ? "Please select an Excel (.xlsx) file." : "Please select a system.");
      return;
    }
    setBusy(true);
    setError("");
    setProblems([]);
    try {
      const body = new FormData();
      body.append("country", country);
      body.append("system", system);
      body.append("file", file);
      const response = await api<{ capabilities: KbCapabilityRecord[]; uploaded: number }>("/api/capabilities/upload", {
        method: "POST",
        body,
      });
      onUploaded(response.capabilities);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      if (err instanceof ApiError) setProblems(err.errors);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label="Upload capabilities" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4" onSubmit={(e) => void submit(e)}>
        <div>
          <h2 className="font-headline text-xl font-semibold">Upload Capabilities</h2>
          <p className="text-xs text-muted mt-1">
            Excel (.xlsx) with columns: L1_CAPABILITY, L2_CAPABILITY, L3_CAPABILITY, DESCRIPTION. L1–L3 are required. An empty DESCRIPTION is filled with a short description generated from those levels.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Country</span>
            <div className="mt-1">
              <SelectField aria-label="Country" value={country} disabled={busy} className="w-full [&_button]:w-full [&_button]:max-w-none" options={countries.map((item) => ({ value: item, label: item }))} onChange={setCountry} />
            </div>
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">System</span>
            <div className="mt-1">
              <SelectField
                aria-label="System"
                value={system}
                disabled={busy || systems.length === 0}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={
                  systems.length === 0
                    ? [{ value: "", label: "No systems" }]
                    : systems.map((item) => ({ value: item.system_code, label: `${item.system_code} — ${item.system_name}` }))
                }
                onChange={setSystem}
              />
            </div>
          </label>
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Excel file (.xlsx)</span>
          <input className="field mt-1" type="file" aria-label="Excel file" accept=".xlsx" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {error && <p className="text-alert text-sm">{error}</p>}
        {problems.length > 0 && (
          <ul className="max-h-40 overflow-auto rounded-lg border border-hairline p-3 text-alert text-xs space-y-1" aria-label="Upload problems">
            {problems.map((problem, index) => (
              <li key={index}>
                Row {problem.row}, {problem.field}: {problem.message}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !file || !system}>
            {busy ? "Uploading…" : "Upload file"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CapabilityFormDialog({
  capability,
  countries,
  systems,
  onSaved,
  onClose,
}: {
  capability?: KbCapabilityRecord;
  countries: string[];
  systems: SystemRecord[];
  onSaved: (item: KbCapabilityRecord) => void;
  onClose: () => void;
}) {
  const editing = Boolean(capability);
  const storedCodes = capability ? countryCodes(capability.country) : null;
  const [allCountries, setAllCountries] = useState(storedCodes !== null && storedCodes.length === 0);
  const [selectedCountries, setSelectedCountries] = useState<string[]>(
    storedCodes && storedCodes.length ? storedCodes : storedCodes ? [] : [countries.includes("SG") ? "SG" : countries[0]].filter(Boolean),
  );
  const [behavior, setBehavior] = useState(capability?.country_behavior ?? "");
  const [system, setSystem] = useState(capability?.system_code ?? systems[0]?.system_code ?? "");
  const [l1, setL1] = useState(capability?.l1_capability ?? "");
  const [l2, setL2] = useState(capability?.l2_capability ?? "");
  const [l3, setL3] = useState(capability?.l3_capability ?? "");
  const [description, setDescription] = useState(capability?.description ?? "");
  const [rules, setRules] = useState(capability?.processing_rules ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!system && systems[0]) setSystem(systems[0].system_code);
  }, [systems, system]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const country = allCountries ? "" : countries.filter((code) => selectedCountries.includes(code)).join(",");
    if ((!allCountries && !country) || !system || !l1.trim() || !l2.trim() || !l3.trim()) {
      setError("Choose All countries or at least one country, and fill in system, L1, L2 and L3.");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      country,
      country_behavior: behavior.trim(),
      system_code: system,
      l1_capability: l1.trim(),
      l2_capability: l2.trim(),
      l3_capability: l3.trim(),
      description: description.trim(),
      processing_rules: rules,
    };
    try {
      const saved = capability
        ? await api<KbCapabilityRecord>(`/api/capabilities/${encodeURIComponent(capability.capability_id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<KbCapabilityRecord>("/api/capabilities", { method: "POST", body: JSON.stringify(payload) });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the capability");
      setBusy(false);
    }
  }

  const title = editing ? "Edit capability" : "Add capability";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3" onSubmit={(e) => void submit(e)}>
        <h2 className="font-headline text-xl font-semibold">{title}</h2>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">System</span>
          <div className="mt-1">
            <SelectField
              aria-label="Capability system"
              value={system}
              disabled={busy || systems.length === 0}
              className="w-full [&_button]:w-full [&_button]:max-w-none"
              options={
                systems.length === 0
                  ? [{ value: "", label: "No systems" }]
                  : systems.map((item) => ({ value: item.system_code, label: `${item.system_code} — ${item.system_name}` }))
              }
              onChange={setSystem}
            />
          </div>
        </label>
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="font-label text-[10px] uppercase text-muted">Applicable for</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="All countries"
                checked={allCountries}
                onChange={(event) => {
                  if (event.target.checked) {
                    setAllCountries(true);
                    setSelectedCountries([]);
                  } else {
                    setAllCountries(false);
                  }
                }}
              />
              All countries
            </label>
            {countries.map((code) => (
              <label key={code} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={code}
                  checked={!allCountries && selectedCountries.includes(code)}
                  onChange={() => {
                    setAllCountries(false);
                    setSelectedCountries((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
                  }}
                />
                {code}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Country specific behavior</span>
          <input className="field mt-1" aria-label="Country specific behavior" value={behavior} disabled={busy} onChange={(event) => setBehavior(event.target.value)} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">L1 capability</span>
            <input className="field mt-1" aria-label="L1 capability" value={l1} disabled={busy} onChange={(e) => setL1(e.target.value)} />
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">L2 capability</span>
            <input className="field mt-1" aria-label="L2 capability" value={l2} disabled={busy} onChange={(e) => setL2(e.target.value)} />
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">L3 capability</span>
            <input className="field mt-1" aria-label="L3 capability" value={l3} disabled={busy} onChange={(e) => setL3(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <input
            className="field mt-1"
            aria-label="Capability description"
            value={description}
            disabled={busy}
            placeholder={inferredDescription(l1, l2, l3) || "Leave blank to generate a short description"}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div>
          <span className="font-label text-[10px] uppercase text-muted">Processing rules</span>
          <div className="mt-1">
            <ProcessingRulesEditor value={rules} onChange={setRules} readOnly={busy} />
          </div>
        </div>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {editing ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}

function LinkPickerDialog({
  title,
  country,
  options,
  onPick,
  onClose,
}: {
  title: string;
  country: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState(options[0]?.id ?? "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!choice) {
      setError("Select an item.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onPick(choice);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not link the item");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3" onSubmit={(e) => void submit(e)}>
        <h2 className="font-headline text-lg font-semibold">{title}</h2>
        {options.length === 0 ? (
          <p className="text-sm text-muted">No items in {country} left to link.</p>
        ) : (
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Item</span>
            <div className="mt-1">
              <SelectField
                aria-label="Link item"
                value={choice}
                disabled={busy}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={options.map((item) => ({ value: item.id, label: item.label }))}
                onChange={setChoice}
              />
            </div>
          </label>
        )}
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || options.length === 0}>
            Link
          </button>
        </div>
      </form>
    </div>
  );
}

function CapabilityDetailDialog({
  capabilityId,
  canEdit,
  onClose,
  onChanged,
}: {
  capabilityId: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: (item: KbCapabilityRecord) => void;
}) {
  const [item, setItem] = useState<KbCapabilityRecord | null>(null);
  const [error, setError] = useState("");
  const [rules, setRules] = useState("");
  const [savingRules, setSavingRules] = useState(false);
  const [picker, setPicker] = useState<"interfaces" | "tables" | "batches" | "reports" | null>(null);
  const [catalog, setCatalog] = useState<{
    interfaces: InterfaceRecord[];
    tables: KbTableRecord[];
    batches: KbBatchRecord[];
    reports: KbReportRecord[];
  }>({ interfaces: [], tables: [], batches: [], reports: [] });
  const [inspect, setInspect] = useState<
    | { kind: "interface"; row: KbCapabilityLinkInterface }
    | { kind: "table"; row: KbCapabilityLinkTable }
    | { kind: "batch"; row: KbCapabilityLinkBatch }
    | { kind: "report"; row: KbCapabilityLinkReport }
    | null
  >(null);
  const [unlinking, setUnlinking] = useState<{ kind: string; id: string; name: string } | null>(null);

  useEffect(() => {
    api<KbCapabilityRecord>(`/api/capabilities/${encodeURIComponent(capabilityId)}`)
      .then((data) => {
        setItem(data);
        setRules(data.processing_rules || "");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load capability"));
    if (canEdit) {
      void (async () => {
        const catalogs = await api<Catalogs>("/api/catalogs").catch(() => null);
        const channels = catalogs?.interface_channels?.length ? catalogs.interface_channels : ["EAI"];
        let interfaces: InterfaceRecord[] = [];
        for (const channel of channels) {
          try {
            const more = await api<InterfaceRecord[]>(`/api/interfaces/${encodeURIComponent(channel)}`);
            interfaces = [...interfaces, ...more];
          } catch {
            // channel may be empty
          }
        }
        const [tables, batches, reports] = await Promise.all([
          api<KbTableRecord[]>("/api/tables").catch(() => [] as KbTableRecord[]),
          api<KbBatchRecord[]>("/api/batches").catch(() => [] as KbBatchRecord[]),
          api<KbReportRecord[]>("/api/reports").catch(() => [] as KbReportRecord[]),
        ]);
        setCatalog({ interfaces, tables, batches, reports });
      })();
    }
  }, [capabilityId, canEdit]);

  async function saveRules() {
    if (!item) return;
    setSavingRules(true);
    try {
      const saved = await api<KbCapabilityRecord>(`/api/capabilities/${encodeURIComponent(item.capability_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ processing_rules: rules }),
      });
      setItem(saved);
      onChanged(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save processing rules");
    } finally {
      setSavingRules(false);
    }
  }

  async function applyLink(kind: "interfaces" | "tables" | "batches" | "reports", id: string) {
    if (!item) return;
    const saved = await api<KbCapabilityRecord>(`/api/capabilities/${encodeURIComponent(item.capability_id)}/${kind}/${encodeURIComponent(id)}`, {
      method: "POST",
    });
    setItem(saved);
    onChanged(saved);
  }

  async function unlink() {
    if (!item || !unlinking) return;
    const saved = await api<KbCapabilityRecord>(
      `/api/capabilities/${encodeURIComponent(item.capability_id)}/${unlinking.kind}/${encodeURIComponent(unlinking.id)}`,
      { method: "DELETE" },
    );
    setItem(saved);
    onChanged(saved);
    setUnlinking(null);
    if (inspect) setInspect(null);
  }

  const pickerOptions = useMemo(() => {
    if (!item || !picker) return [];
    const inCountry = (country: string) => appliesToCountry(item.country, country);
    if (picker === "interfaces") {
      const linked = new Set((item.interfaces || []).map((row) => row.interface_id));
      return catalog.interfaces
        .filter((row) => inCountry(row.country) && !linked.has(row.interface_id))
        .map((row) => ({ id: row.interface_id, label: `${row.channel} · ${row.interface_name}` }));
    }
    if (picker === "tables") {
      const linked = new Set((item.tables || []).map((row) => row.table_id));
      return catalog.tables
        .filter((row) => inCountry(row.country) && !linked.has(row.table_id))
        .map((row) => ({ id: row.table_id, label: `${row.database_name}.${row.schema_name}.${row.table_name}` }));
    }
    if (picker === "batches") {
      const linked = new Set((item.batches || []).map((row) => row.batch_id));
      return catalog.batches
        .filter((row) => inCountry(row.country) && !linked.has(row.batch_id))
        .map((row) => ({ id: row.batch_id, label: `${row.system_code} · ${row.batch_name}` }));
    }
    const linked = new Set((item.reports || []).map((row) => row.report_id));
    return catalog.reports
      .filter((row) => inCountry(row.country) && !linked.has(row.report_id))
      .map((row) => ({ id: row.report_id, label: `${row.system_code} · ${row.report_name}` }));
  }, [item, picker, catalog]);

  function LinkSection({
    title,
    kind,
    rows,
    labelOf,
  }: {
    title: string;
    kind: "interfaces" | "tables" | "batches" | "reports";
    rows: { id: string; label: string; onOpen: () => void }[];
    labelOf: (id: string) => string;
  }) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-headline text-base font-semibold m-0">{title}</h3>
          {canEdit && (
            <button type="button" className="btn" onClick={() => setPicker(kind)}>
              <span className="material-symbols-outlined text-base">add</span>
              Add
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">None linked.</p>
        ) : (
          <ul className="rounded-lg border border-hairline divide-y divide-hairline">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <button type="button" className="text-left text-accent hover:underline text-sm" onClick={row.onOpen}>
                  {row.label}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label={`Unlink ${labelOf(row.id)}`}
                    title="Unlink"
                    onClick={() => setUnlinking({ kind, id: row.id, name: labelOf(row.id) })}
                  >
                    <span className="material-symbols-outlined text-base">link_off</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Capability detail" className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4">
        {!item ? (
          <p className="text-muted">{error || "Loading…"}</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-label text-[10px] uppercase text-muted">
                  {applicableFor(item.country)} · {item.system_code}
                </p>
                <h2 className="font-headline text-xl font-semibold mt-0.5">
                  {item.l1_capability} / {item.l2_capability} / {item.l3_capability}
                </h2>
                <p className="text-sm text-muted mt-1">{capabilityDescription(item)}</p>
                {item.country_behavior?.trim() && (
                  <p className="text-sm mt-1">
                    <span className="font-label text-[10px] uppercase text-muted">Country specific behavior </span>
                    {item.country_behavior}
                  </p>
                )}
              </div>
              <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
            {error && <p className="text-alert text-sm">{error}</p>}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-label text-[10px] uppercase text-muted">Processing rules</span>
                {canEdit && (
                  <button type="button" className="btn" disabled={savingRules} onClick={() => void saveRules()}>
                    {savingRules ? "Saving…" : "Save rules"}
                  </button>
                )}
              </div>
              <ProcessingRulesEditor value={rules} onChange={setRules} readOnly={!canEdit || savingRules} />
            </div>
            <LinkSection
              title="Interfaces"
              kind="interfaces"
              rows={(item.interfaces || []).map((row) => ({
                id: row.interface_id,
                label: `${row.channel} · ${row.interface_name}`,
                onOpen: () => setInspect({ kind: "interface", row }),
              }))}
              labelOf={(id) => (item.interfaces || []).find((row) => row.interface_id === id)?.interface_name || id}
            />
            <LinkSection
              title="Tables"
              kind="tables"
              rows={(item.tables || []).map((row) => ({
                id: row.table_id,
                label: `${row.database_name}.${row.schema_name}.${row.table_name}`,
                onOpen: () => setInspect({ kind: "table", row }),
              }))}
              labelOf={(id) => (item.tables || []).find((row) => row.table_id === id)?.table_name || id}
            />
            <LinkSection
              title="Batches"
              kind="batches"
              rows={(item.batches || []).map((row) => ({
                id: row.batch_id,
                label: row.batch_name,
                onOpen: () => setInspect({ kind: "batch", row }),
              }))}
              labelOf={(id) => (item.batches || []).find((row) => row.batch_id === id)?.batch_name || id}
            />
            <LinkSection
              title="Reports"
              kind="reports"
              rows={(item.reports || []).map((row) => ({
                id: row.report_id,
                label: row.report_name,
                onOpen: () => setInspect({ kind: "report", row }),
              }))}
              labelOf={(id) => (item.reports || []).find((row) => row.report_id === id)?.report_name || id}
            />
          </>
        )}
      </div>
      {picker && (
        <LinkPickerDialog
          title={`Link ${picker.slice(0, -1)}`}
          country={item?.country ?? ""}
          options={pickerOptions}
          onPick={(id) => applyLink(picker, id)}
          onClose={() => setPicker(null)}
        />
      )}
      {inspect && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setInspect(null)}>
          <div role="dialog" aria-modal="true" aria-label="Linked item detail" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-headline text-lg font-semibold m-0">
                {inspect.kind === "interface" && inspect.row.interface_name}
                {inspect.kind === "table" && inspect.row.table_name}
                {inspect.kind === "batch" && inspect.row.batch_name}
                {inspect.kind === "report" && inspect.row.report_name}
              </h3>
              <button type="button" className="icon-btn" aria-label="Close linked detail" onClick={() => setInspect(null)}>
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {Object.entries(inspect.row).map(([key, value]) =>
                key.endsWith("_id") ? null : (
                  <div key={key} className="contents">
                    <dt className="font-label text-[10px] uppercase text-muted">{key.replace(/_/g, " ")}</dt>
                    <dd className="m-0">{String(value || "—")}</dd>
                  </div>
                ),
              )}
            </dl>
            {canEdit && (
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const id =
                      inspect.kind === "interface"
                        ? inspect.row.interface_id
                        : inspect.kind === "table"
                          ? inspect.row.table_id
                          : inspect.kind === "batch"
                            ? inspect.row.batch_id
                            : inspect.row.report_id;
                    const name =
                      inspect.kind === "interface"
                        ? inspect.row.interface_name
                        : inspect.kind === "table"
                          ? inspect.row.table_name
                          : inspect.kind === "batch"
                            ? inspect.row.batch_name
                            : inspect.row.report_name;
                    const kind =
                      inspect.kind === "interface"
                        ? "interfaces"
                        : inspect.kind === "table"
                          ? "tables"
                          : inspect.kind === "batch"
                            ? "batches"
                            : "reports";
                    setUnlinking({ kind, id, name });
                  }}
                >
                  Unlink from capability
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {unlinking && (
        <ConfirmDialog
          title="Unlink item"
          message={`Remove the link to “${unlinking.name}”? The catalogue item itself is kept.`}
          confirmLabel="Unlink"
          onConfirm={() => unlink()}
          onClose={() => setUnlinking(null)}
        />
      )}
    </div>
  );
}

export function CapabilitiesPanel() {
  const auth = useOptionalAuth();
  const canEdit = auth?.user?.role_name !== "Viewer";
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<KbCapabilityRecord[]>([]);
  const [countries, setCountries] = useState<string[]>(["SG", "MY", "TH", "VN", "ID"]);
  const [systems, setSystems] = useState<SystemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState(() => searchParams.get("country") ?? "");
  const [systemFilter, setSystemFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<{ capability?: KbCapabilityRecord } | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<KbCapabilityRecord | null>(null);
  const [sort, setSort] = useState<ColumnSort>(null);

  useEffect(() => {
    api<Catalogs>("/api/catalogs")
      .then((data) => {
        if (data.countries?.length) setCountries(data.countries);
      })
      .catch(() => undefined);
    api<SystemRecord[]>("/api/systems")
      .then(setSystems)
      .catch(() => undefined);
    api<KbCapabilityRecord[]>("/api/capabilities")
      .then((data) => {
        setItems(data);
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load capabilities"))
      .finally(() => setLoading(false));
  }, []);

  const systemsForFilter = useMemo(() => {
    const present = new Set(items.filter((item) => appliesToCountry(item.country, countryFilter)).map((item) => item.system_code));
    const known = systems.filter((item) => present.has(item.system_code));
    const knownCodes = new Set(known.map((item) => item.system_code));
    const extras = [...present]
      .filter((code) => !knownCodes.has(code))
      .sort()
      .map((system_code) => ({ system_code, system_name: system_code }));
    return [...known.map((item) => ({ system_code: item.system_code, system_name: item.system_name })), ...extras];
  }, [items, systems, countryFilter]);

  useEffect(() => {
    if (!systemsForFilter.some((item) => item.system_code === systemFilter)) {
      setSystemFilter(systemsForFilter[0]?.system_code ?? "");
    }
  }, [systemsForFilter, systemFilter]);

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const names = new Map(systems.map((item) => [item.system_code, item.system_name]));
    const map = new Map<string, { key: string; country: string; system: string; systemName: string; rows: KbCapabilityRecord[] }>();
    for (const row of items) {
      if (!appliesToCountry(row.country, countryFilter)) continue;
      if (row.system_code !== systemFilter) continue;
      if (
        needle &&
        !`${row.l1_capability} ${row.l2_capability} ${row.l3_capability} ${row.description} ${row.country_behavior ?? ""} ${applicableFor(row.country)} ${row.system_code}`
          .toLowerCase()
          .includes(needle)
      ) {
        continue;
      }
      const key = `${row.country}|${row.system_code}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          country: row.country,
          system: row.system_code,
          systemName: names.get(row.system_code) || row.system_code,
          rows: [],
        };
        map.set(key, group);
      }
      group.rows.push(row);
    }
    return [...map.values()];
  }, [items, systems, search, countryFilter, systemFilter]);

  async function remove() {
    if (!deleting) return;
    await api(`/api/capabilities/${encodeURIComponent(deleting.capability_id)}`, { method: "DELETE" });
    const id = deleting.capability_id;
    setItems((current) => current.filter((item) => item.capability_id !== id));
    setDeleting(null);
  }

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-headline text-2xl font-semibold">Capabilities</h1>
          <p className="text-muted mt-0.5">One table per country and system (L1 / L2 / L3). Click a row for processing rules and linked catalogue items.</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button type="button" className="btn" onClick={() => setForm({})}>
              <span className="material-symbols-outlined text-base">add</span>
              Add capability
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>
              <span className="material-symbols-outlined text-base">upload</span>
              Upload
            </button>
          </div>
        )}
      </div>
      {error && <p className="text-alert">{error}</p>}
      {notice && (
        <p className="text-accent" role="status">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          aria-label="Filter by country"
          value={countryFilter}
          options={[
            { value: "", label: "All countries" },
            ...(countryFilter && !countries.includes(countryFilter) ? [countryFilter, ...countries] : countries).map((item) => ({
              value: item,
              label: item,
            })),
          ]}
          onChange={setCountryFilter}
        />
        <SelectField
          aria-label="Filter by system"
          value={systemFilter}
          disabled={systemsForFilter.length === 0}
          options={
            systemsForFilter.length === 0
              ? [{ value: "", label: "No systems" }]
              : systemsForFilter.map((item) => ({ value: item.system_code, label: `${item.system_code} — ${item.system_name}` }))
          }
          onChange={setSystemFilter}
        />
        <input
          className="field flex-1 min-w-[200px] max-w-md"
          type="search"
          aria-label="Search Capabilities"
          placeholder="Search capabilities"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {groups.length === 0 ? (
        <div className="bg-panel border border-hairline rounded-lg p-6 text-muted">{loading ? "Loading…" : "No capabilities found."}</div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="bg-panel border border-hairline rounded-lg overflow-hidden" aria-label={`${applicableFor(group.country)} ${group.system}`}>
              <div className="flex items-center justify-between gap-2 border-b border-hairline bg-inset px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span>{applicableFor(group.country)}</span>
                  <span className="text-muted">/</span>
                  <span className="font-label text-xs text-accent">{group.system}</span>
                  {group.systemName !== group.system && <span className="text-muted font-normal">{group.systemName}</span>}
                </div>
                <span className="font-label text-[11px] text-muted">
                  {group.rows.length} {group.rows.length === 1 ? "capability" : "capabilities"}
                </span>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-hairline font-label text-[10px] uppercase text-muted">
                    {(
                      [
                        ["l1_capability", "L1"],
                        ["l2_capability", "L2"],
                        ["l3_capability", "L3"],
                      ] as const
                    ).map(([key, label]) => (
                      <th key={key} className="py-2.5 px-3" aria-sort={sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                        <SortHeader label={label} active={sort?.key === key ? sort.dir : null} onClick={() => setSort((current) => toggleColumnSort(current, key))} />
                      </th>
                    ))}
                    <th className="py-2.5 px-3">Applicable for</th>
                    <th className="py-2.5 px-3">Description</th>
                    {canEdit && <th className="py-2.5 px-3 w-24" />}
                  </tr>
                </thead>
                <tbody>
                  {sortRows(group.rows, sort, (row) => (sort ? row[sort.key as "l1_capability" | "l2_capability" | "l3_capability"] : "")).map((row) => (
                    <tr
                      key={row.capability_id}
                      className="border-b border-hairline last:border-b-0 hover:bg-inset/50 cursor-pointer"
                      tabIndex={0}
                      onClick={() => setInspecting(row.capability_id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setInspecting(row.capability_id);
                        }
                      }}
                    >
                      <td className="py-2.5 px-3 font-label text-xs">{row.l1_capability}</td>
                      <td className="py-2.5 px-3 text-muted">{row.l2_capability}</td>
                      <td className="py-2.5 px-3 text-muted">{row.l3_capability}</td>
                      <td className="py-2.5 px-3">{applicableFor(row.country)}</td>
                      <td className="py-2.5 px-3 text-muted">{capabilityDescription(row)}</td>
                      {canEdit && (
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Edit ${row.l3_capability}`}
                              title="Edit"
                              onClick={(event) => {
                                event.stopPropagation();
                                setForm({ capability: row });
                              }}
                            >
                              <span className="material-symbols-outlined text-base">edit</span>
                            </button>
                            <button
                              type="button"
                              className="icon-btn icon-btn-danger"
                              aria-label={`Delete ${row.l3_capability}`}
                              title="Delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleting(row);
                              }}
                            >
                              <span className="material-symbols-outlined text-base">delete</span>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
      {uploading && (
        <UploadCapabilitiesDialog
          countries={countries}
          systems={systems}
          onUploaded={(capabilities) => {
            setItems(capabilities);
            setUploading(false);
            setNotice("Capabilities uploaded.");
          }}
          onClose={() => setUploading(false)}
        />
      )}
      {form && (
        <CapabilityFormDialog
          capability={form.capability}
          countries={countries}
          systems={
            form.capability && !systems.some((item) => item.system_code === form.capability!.system_code)
              ? [...systems, { system_code: form.capability.system_code, system_name: form.capability.system_code } as SystemRecord]
              : systems
          }
          onSaved={(saved) => {
            setItems((current) => {
              const rest = current.filter((item) => item.capability_id !== saved.capability_id);
              return [...rest, saved].sort((a, b) =>
                `${a.country}${a.system_code}${a.l1_capability}${a.l2_capability}${a.l3_capability}`.localeCompare(
                  `${b.country}${b.system_code}${b.l1_capability}${b.l2_capability}${b.l3_capability}`,
                ),
              );
            });
            setForm(null);
          }}
          onClose={() => setForm(null)}
        />
      )}
      {inspecting && (
        <CapabilityDetailDialog
          capabilityId={inspecting}
          canEdit={canEdit}
          onClose={() => setInspecting(null)}
          onChanged={(saved) => {
            setItems((current) => current.map((item) => (item.capability_id === saved.capability_id ? { ...item, ...saved } : item)));
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete capability"
          message={`Delete “${deleting.l1_capability} / ${deleting.l2_capability} / ${deleting.l3_capability}”? Linked catalogue items are kept; only the links are removed.`}
          confirmLabel="Delete"
          onConfirm={() => remove()}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
