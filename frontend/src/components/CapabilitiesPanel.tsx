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
  KbCapabilityRecord,
  KbReportRecord,
  KbTableRecord,
  SystemRecord,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileDrop } from "./FileDrop";
import { MermaidPreview } from "./DiagramBlock";
import { SequenceDiagramsDialog, type SequenceDiagram } from "./SequenceDiagramsDialog";
import { TableDetailsDialog } from "./TablesPanel";
import { SortHeader, sortRows, toggleColumnSort, type ColumnSort } from "./SortHeader";
import { ProcessingRulesEditor } from "./ProcessingRulesEditor";
import { SelectField } from "./SelectField";
import { PageSlice } from "./TablePager";

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
  const [allCountries, setAllCountries] = useState(false);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([countries.includes("SG") ? "SG" : countries[0]].filter(Boolean));
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
    const country = allCountries ? "" : countries.filter((code) => selectedCountries.includes(code)).join(",");
    if (!file || !system || (!allCountries && !country)) {
      setError(!file ? "Please select an Excel (.xlsx) file." : !system ? "Please select a system." : "Choose All countries or at least one country.");
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <div>
          <span className="font-label text-[10px] uppercase text-muted">Excel file (.xlsx)</span>
          <div className="mt-1">
            <FileDrop accept=".xlsx" ariaLabel="Excel file" file={file} disabled={busy} grow onFile={setFile} />
          </div>
        </div>
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

type LinkKind = "interfaces" | "tables" | "batches" | "reports";

function itemMatchesCountries(applicable: string, unrestricted: boolean, itemCountry: string) {
  const codes = (value: string) =>
    countryCodes(value)
      .map((code) => code.toLowerCase())
      .filter((code) => code !== "all");
  if (unrestricted) return true;
  const selected = codes(applicable);
  if (selected.length === 0) return false;
  const item = codes(itemCountry);
  if (item.length === 0) return true;
  return selected.some((code) => item.includes(code));
}

function CapabilityFormDialog({
  capability,
  capabilityId,
  readOnly = false,
  countries,
  systems,
  onSaved,
  onClose,
}: {
  capability?: KbCapabilityRecord;
  capabilityId?: string;
  readOnly?: boolean;
  countries: string[];
  systems: SystemRecord[];
  onSaved: (item: KbCapabilityRecord) => void;
  onClose: () => void;
}) {
  const recordId = capabilityId || capability?.capability_id || "";
  const [savedId, setSavedId] = useState(recordId);
  const editing = Boolean(savedId);
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
  const [diagrams, setDiagrams] = useState<SequenceDiagram[]>(capability?.sequence_diagrams ?? []);
  const [diagramsOpen, setDiagramsOpen] = useState(false);
  const [rules, setRules] = useState(capability?.processing_rules ?? "");
  const [links, setLinks] = useState<Pick<KbCapabilityRecord, "interfaces" | "tables" | "batches" | "reports">>({
    interfaces: capability?.interfaces ?? [],
    tables: capability?.tables ?? [],
    batches: capability?.batches ?? [],
    reports: capability?.reports ?? [],
  });
  const [pending, setPending] = useState<{ kind: LinkKind; id: string }[]>([]);
  const [catalog, setCatalog] = useState<{ interfaces: InterfaceRecord[]; tables: KbTableRecord[]; batches: KbBatchRecord[]; reports: KbReportRecord[] }>({
    interfaces: [],
    tables: [],
    batches: [],
    reports: [],
  });
  const [picker, setPicker] = useState<LinkKind | null>(null);
  const [inspect, setInspect] = useState<
    | { kind: "interface"; row: KbCapabilityLinkInterface }
    | { kind: "table"; tableId: string }
    | { kind: "batch"; row: KbCapabilityLinkBatch }
    | { kind: "report"; row: KbCapabilityLinkReport }
    | null
  >(null);
  const [unlinking, setUnlinking] = useState<{ kind: LinkKind; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(Boolean(recordId));
  const [error, setError] = useState("");

  function applyRecord(data: KbCapabilityRecord) {
    const codes = countryCodes(data.country);
    setAllCountries(codes.length === 0);
    setSelectedCountries(codes);
    setBehavior(data.country_behavior ?? "");
    setSystem(data.system_code);
    setL1(data.l1_capability);
    setL2(data.l2_capability);
    setL3(data.l3_capability);
    setDescription(data.description ?? "");
    setDiagrams(data.sequence_diagrams ?? []);
    setRules(data.processing_rules ?? "");
    setLinks({
      interfaces: data.interfaces ?? [],
      tables: data.tables ?? [],
      batches: data.batches ?? [],
      reports: data.reports ?? [],
    });
    setSavedId(data.capability_id);
  }

  useEffect(() => {
    if (!system && systems[0] && !readOnly) setSystem(systems[0].system_code);
  }, [systems, system, readOnly]);

  useEffect(() => {
    if (!recordId) return;
    let current = true;
    api<KbCapabilityRecord>(`/api/capabilities/${encodeURIComponent(recordId)}`)
      .then((data) => {
        if (current) applyRecord(data);
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof ApiError ? err.message : "Could not load capability");
      })
      .finally(() => {
        if (current) setLoadingRecord(false);
      });
    return () => {
      current = false;
    };
  }, [recordId]);

  useEffect(() => {
    if (readOnly) return;
    let current = true;
    void (async () => {
      const catalogs = await api<Catalogs>("/api/catalogs").catch(() => null);
      if (!current) return;
      const channels = catalogs?.interface_channels?.length ? catalogs.interface_channels : ["EAI"];
      let interfaces: InterfaceRecord[] = [];
      for (const channel of channels) {
        try {
          interfaces = [...interfaces, ...(await api<InterfaceRecord[]>(`/api/interfaces/${encodeURIComponent(channel)}`))];
        } catch {
          // A channel can be empty.
        }
      }
      const [tables, batches, reports] = await Promise.all([
        api<KbTableRecord[]>("/api/tables").catch(() => [] as KbTableRecord[]),
        api<KbBatchRecord[]>("/api/batches").catch(() => [] as KbBatchRecord[]),
        api<KbReportRecord[]>("/api/reports").catch(() => [] as KbReportRecord[]),
      ]);
      if (current) setCatalog({ interfaces, tables, batches, reports });
    })();
    return () => {
      current = false;
    };
  }, [readOnly]);

  const countryValue = allCountries ? "" : countries.filter((code) => selectedCountries.includes(code)).join(",");

  async function linkOne(kind: LinkKind, id: string, capabilityKey: string) {
    return api<KbCapabilityRecord>(`/api/capabilities/${encodeURIComponent(capabilityKey)}/${kind}/${encodeURIComponent(id)}`, { method: "POST" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    if ((!allCountries && !countryValue) || !system || !l1.trim() || !l2.trim() || !l3.trim()) {
      setError("Choose All countries or at least one country, and fill in system, L1, L2 and L3.");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      country: countryValue,
      country_behavior: behavior.trim(),
      system_code: system,
      l1_capability: l1.trim(),
      l2_capability: l2.trim(),
      l3_capability: l3.trim(),
      description: description.trim(),
      sequence_diagrams: diagrams,
      processing_rules: rules,
    };
    try {
      let saved = savedId
        ? await api<KbCapabilityRecord>(`/api/capabilities/${encodeURIComponent(savedId)}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api<KbCapabilityRecord>("/api/capabilities", { method: "POST", body: JSON.stringify(payload) });
      if (!savedId) setSavedId(saved.capability_id);
      const queue = [...pending];
      for (const item of queue) {
        saved = await linkOne(item.kind, item.id, saved.capability_id);
        setPending((current) => current.filter((entry) => !(entry.kind === item.kind && entry.id === item.id)));
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the capability");
      setBusy(false);
    }
  }

  async function applyLink(kind: LinkKind, id: string) {
    if (!allCountries && !countryValue) {
      throw new ApiError(400, "Choose All countries or at least one country before linking.");
    }
    if (savedId) {
      await api<KbCapabilityRecord>(`/api/capabilities/${encodeURIComponent(savedId)}`, {
        method: "PATCH",
        body: JSON.stringify({ country: countryValue }),
      });
      const saved = await linkOne(kind, id, savedId);
      applyRecord(saved);
      onSaved(saved);
      return;
    }
    setPending((current) => (current.some((item) => item.kind === kind && item.id === id) ? current : [...current, { kind, id }]));
  }

  async function unlink() {
    if (!unlinking) return;
    if (!savedId) {
      setPending((current) => current.filter((item) => !(item.kind === unlinking.kind && item.id === unlinking.id)));
      setUnlinking(null);
      setInspect(null);
      return;
    }
    const saved = await api<KbCapabilityRecord>(
      `/api/capabilities/${encodeURIComponent(savedId)}/${unlinking.kind}/${encodeURIComponent(unlinking.id)}`,
      { method: "DELETE" },
    );
    applyRecord(saved);
    onSaved(saved);
    setUnlinking(null);
    setInspect(null);
  }

  const pickerOptions = useMemo(() => {
    if (!picker) return [];
    const linkedIds = new Set([
      ...(picker === "interfaces" ? (links.interfaces || []).map((row) => row.interface_id) : []),
      ...(picker === "tables" ? (links.tables || []).map((row) => row.table_id) : []),
      ...(picker === "batches" ? (links.batches || []).map((row) => row.batch_id) : []),
      ...(picker === "reports" ? (links.reports || []).map((row) => row.report_id) : []),
      ...pending.filter((item) => item.kind === picker).map((item) => item.id),
    ]);
    const matches = (itemCountry: string) => itemMatchesCountries(countryValue, allCountries, itemCountry);
    if (picker === "interfaces") {
      return catalog.interfaces
        .filter((row) => matches(row.country) && !linkedIds.has(row.interface_id))
        .map((row) => ({ id: row.interface_id, label: `${applicableFor(row.country)} · ${row.channel} · ${row.interface_name}` }));
    }
    if (picker === "tables") {
      return catalog.tables
        .filter((row) => matches(row.country) && !linkedIds.has(row.table_id))
        .map((row) => ({ id: row.table_id, label: `${row.country} · ${row.database_name}.${row.schema_name}.${row.table_name}` }));
    }
    if (picker === "batches") {
      return catalog.batches
        .filter((row) => matches(row.country) && !linkedIds.has(row.batch_id))
        .map((row) => ({ id: row.batch_id, label: `${row.country} · ${row.system_code} · ${row.batch_name}` }));
    }
    return catalog.reports
      .filter((row) => matches(row.country) && !linkedIds.has(row.report_id))
      .map((row) => ({ id: row.report_id, label: `${row.country} · ${row.system_code} · ${row.report_name}` }));
  }, [picker, links, pending, catalog, countryValue, allCountries]);

  function linkRows(kind: LinkKind): { id: string; label: string; onOpen: () => void }[] {
    if (kind === "interfaces") {
      const saved = (links.interfaces || []).map((row) => ({
        id: row.interface_id,
        label: `${row.channel} · ${row.interface_name}`,
        onOpen: () => setInspect({ kind: "interface", row }),
      }));
      const extra = pending
        .filter((item) => item.kind === "interfaces")
        .map((item) => {
          const row = catalog.interfaces.find((entry) => entry.interface_id === item.id);
          return { id: item.id, label: row ? `${row.channel} · ${row.interface_name}` : item.id, onOpen: () => undefined };
        });
      return [...saved, ...extra];
    }
    if (kind === "tables") {
      const saved = (links.tables || []).map((row) => ({
        id: row.table_id,
        label: `${row.database_name}.${row.schema_name}.${row.table_name}`,
        onOpen: () => setInspect({ kind: "table", tableId: row.table_id }),
      }));
      const extra = pending
        .filter((item) => item.kind === "tables")
        .map((item) => {
          const row = catalog.tables.find((entry) => entry.table_id === item.id);
          return {
            id: item.id,
            label: row ? `${row.database_name}.${row.schema_name}.${row.table_name}` : item.id,
            onOpen: () => setInspect({ kind: "table", tableId: item.id }),
          };
        });
      return [...saved, ...extra];
    }
    if (kind === "batches") {
      const saved = (links.batches || []).map((row) => ({
        id: row.batch_id,
        label: `${row.system_code} · ${row.batch_name}`,
        onOpen: () => setInspect({ kind: "batch", row }),
      }));
      const extra = pending
        .filter((item) => item.kind === "batches")
        .map((item) => {
          const row = catalog.batches.find((entry) => entry.batch_id === item.id);
          return { id: item.id, label: row ? `${row.system_code} · ${row.batch_name}` : item.id, onOpen: () => undefined };
        });
      return [...saved, ...extra];
    }
    const saved = (links.reports || []).map((row) => ({
      id: row.report_id,
      label: `${row.system_code} · ${row.report_name}`,
      onOpen: () => setInspect({ kind: "report", row }),
    }));
    const extra = pending
      .filter((item) => item.kind === "reports")
      .map((item) => {
        const row = catalog.reports.find((entry) => entry.report_id === item.id);
        return { id: item.id, label: row ? `${row.system_code} · ${row.report_name}` : item.id, onOpen: () => undefined };
      });
    return [...saved, ...extra];
  }

  const title = readOnly ? "View capability" : editing ? "Edit capability" : "Add capability";
  const locked = readOnly || busy;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3" onSubmit={(e) => void submit(e)}>
        <h2 className="font-headline text-xl font-semibold">{title}</h2>
        {loadingRecord ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">System</span>
          <div className="mt-1">
            <SelectField
              aria-label="Capability system"
              value={system}
              disabled={locked || systems.length === 0}
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
        <fieldset className="space-y-2" disabled={locked}>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">L1 capability</span>
            <input className="field mt-1" aria-label="L1 capability" value={l1} disabled={locked} onChange={(e) => setL1(e.target.value)} />
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">L2 capability</span>
            <input className="field mt-1" aria-label="L2 capability" value={l2} disabled={locked} onChange={(e) => setL2(e.target.value)} />
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">L3 capability</span>
            <input className="field mt-1" aria-label="L3 capability" value={l3} disabled={locked} onChange={(e) => setL3(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <input
            className="field mt-1"
            aria-label="Capability description"
            value={readOnly ? description.trim() || inferredDescription(l1, l2, l3) : description}
            disabled={locked}
            placeholder={inferredDescription(l1, l2, l3) || "Leave blank to generate a short description"}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div>
          <span className="font-label text-[10px] uppercase text-muted">Country specific behavior</span>
          <div className="mt-1">
            <ProcessingRulesEditor value={behavior} onChange={setBehavior} readOnly={locked} label="Country specific behavior" toolbarLabel="Country specific behavior formatting" />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-label text-[10px] uppercase text-muted">Sequence diagrams</span>
            {!readOnly && (
              <button type="button" className="btn" disabled={busy} onClick={() => setDiagramsOpen(true)}>
                Add / edit
              </button>
            )}
          </div>
          {diagrams.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No sequence diagrams.</p>
          ) : (
            <ul className="mt-1 space-y-3">
              {diagrams.map((diagram) => (
                <li key={diagram.id} className="rounded-lg border border-hairline p-3">
                  <p className="mb-2 text-sm font-medium">{diagram.title}</p>
                  <MermaidPreview source={diagram.mermaid} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <span className="font-label text-[10px] uppercase text-muted">Processing rules</span>
          <div className="mt-1">
            <ProcessingRulesEditor value={rules} onChange={setRules} readOnly={locked} />
          </div>
        </div>
        {(["interfaces", "tables", "batches", "reports"] as const).map((kind) => {
          const heading = kind[0].toUpperCase() + kind.slice(1);
          const rows = linkRows(kind);
          return (
            <section key={kind} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-headline text-base font-semibold m-0">{heading}</h3>
                {!readOnly && (
                  <button type="button" className="btn" aria-label={`Add ${kind}`} disabled={busy} onClick={() => setPicker(kind)}>
                    <span className="material-symbols-outlined text-base" aria-hidden="true">add</span>
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
                      {!readOnly && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          aria-label={`Unlink ${row.label}`}
                          title="Unlink"
                          onClick={() => setUnlinking({ kind, id: row.id, name: row.label })}
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
        })}
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {editing ? "Save" : "Add"}
            </button>
          )}
        </div>
          </>
        )}
      </form>
      {diagramsOpen && (
        <SequenceDiagramsDialog
          diagrams={diagrams}
          onClose={() => setDiagramsOpen(false)}
          onSave={(next) => {
            setDiagrams(next);
            setDiagramsOpen(false);
          }}
        />
      )}
      {picker && (
        <LinkPickerDialog
          title={`Link ${{ interfaces: "interface", tables: "table", batches: "batch", reports: "report" }[picker]}`}
          country={applicableFor(countryValue)}
          options={pickerOptions}
          onPick={(id) => applyLink(picker, id)}
          onClose={() => setPicker(null)}
        />
      )}
      {inspect?.kind === "table" && (
        <TableDetailsDialog
          tableId={inspect.tableId}
          canEdit={false}
          layerClass="z-[70]"
          onTableChanged={() => undefined}
          onClose={() => setInspect(null)}
        />
      )}
      {inspect && inspect.kind !== "table" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setInspect(null)}>
          <div role="dialog" aria-modal="true" aria-label="Linked item detail" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-headline text-lg font-semibold m-0">
                {inspect.kind === "interface" && inspect.row.interface_name}
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
          </div>
        </div>
      )}
      {unlinking && (
        <ConfirmDialog
          title="Unlink item"
          message={`Remove the link to “${unlinking.name}”? The catalogue item itself is kept.`}
          confirmLabel="Unlink"
          onConfirm={() => void unlink()}
          onClose={() => setUnlinking(null)}
        />
      )}
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
  const optionKey = options.map((item) => item.id).join("|");

  useEffect(() => {
    setChoice(options[0]?.id ?? "");
  }, [optionKey]);

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
        <p className="text-sm text-muted">Applicable for {country}.</p>
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
              <PageSlice rows={sortRows(group.rows, sort, (row) => (sort ? row[sort.key as "l1_capability" | "l2_capability" | "l3_capability"] : ""))} resetKey={`${search}|${countryFilter}|${systemFilter}|${sort?.key ?? ""}|${sort?.dir ?? ""}`}>
                {(visible, pager) => (
                  <>
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
                  {visible.map((row) => (
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
              {pager}
                  </>
                )}
              </PageSlice>
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
          }}
          onClose={() => setForm(null)}
        />
      )}
      {inspecting && (
        <CapabilityFormDialog
          capabilityId={inspecting}
          readOnly
          countries={countries}
          systems={systems}
          onSaved={() => undefined}
          onClose={() => setInspecting(null)}
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
