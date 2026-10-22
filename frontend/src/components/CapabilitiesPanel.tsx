import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type {
  Catalogs,
  InterfaceRecord,
  KbBatchRecord,
  KbCapabilityLinkInterface,
  KbCapabilityNode,
  KbCapabilityRecord,
  KbReportRecord,
  KbTableRecord,
  SystemRecord,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { LinkPickerDialog, type LinkPickerRow } from "./LinkPickerDialog";
import { FileDrop } from "./FileDrop";
import { DiagramPopup, MermaidPreview } from "./DiagramBlock";
import { SequenceDiagramsDialog, type SequenceDiagram } from "./SequenceDiagramsDialog";
import { InterfaceDetailDialog } from "./InterfaceSpec";
import { DownloadButtons } from "./DownloadButtons";
import { BatchDetailsDialog } from "./BatchesPanel";
import { ReportDetailsDialog } from "./ReportsPanel";
import { TableDetailsDialog } from "./TablesPanel";
import { SortHeader, sortRows, toggleColumnSort, type ColumnSort } from "./SortHeader";
import { ProcessingRulesEditor } from "./ProcessingRulesEditor";
import { SelectField } from "./SelectField";
import { PageSlice } from "./TablePager";
import { can } from "../permissions";
import { CapabilityNodeWindow, hasDetails, type CapabilityNodeRef } from "./CapabilityNodeDetails";

function inferredDescription(l1: string, l2: string, l3: string) {
  const [area, group, feature] = [l1, l2, l3].map((part) => part.trim());
  if (!area || !group || !feature) return "";
  return `Provides ${feature} as a ${group} feature of ${area}.`;
}

function sentenceCase(value: string) {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return "";
  const chars = text.toLowerCase().split("");
  chars[0] = chars[0].toUpperCase();
  for (let index = 0; index < chars.length - 1; index += 1) {
    if (".!?".includes(chars[index]) && chars[index + 1] === " ") {
      let cursor = index + 1;
      while (cursor < chars.length && chars[cursor] === " ") cursor += 1;
      if (cursor < chars.length) chars[cursor] = chars[cursor].toUpperCase();
      index = cursor;
    }
  }
  return chars.join("");
}

function capabilityDescription(row: Pick<KbCapabilityRecord, "description" | "l1_capability" | "l2_capability" | "l3_capability">) {
  return sentenceCase((row.description || "").trim() || inferredDescription(row.l1_capability, row.l2_capability, row.l3_capability));
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
  systems,
  onUploaded,
  onClose,
}: {
  systems: SystemRecord[];
  onUploaded: (capabilities: KbCapabilityRecord[]) => void;
  onClose: () => void;
}) {
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
            Excel (.xlsx) with columns: COUNTRY, L1_CAPABILITY, L2_CAPABILITY, L3_CAPABILITY, DESCRIPTION. COUNTRY is comma-separated and checked against the country list. Leave COUNTRY empty to apply to all countries. L1–L3 are required. An empty DESCRIPTION is filled with a short description generated from those levels.
          </p>
        </div>
        <div>
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

const PICKER_COLUMNS: Record<LinkKind, string[]> = {
  interfaces: ["Interface Name", "Country", "Channel", "Protocol", "Source → Destination"],
  tables: ["Table", "Country", "Database", "Schema", "Description"],
  batches: ["Batch Name", "Country", "System", "Type", "Description"],
  reports: ["Report Name", "Country", "System", "Report Code", "Description"],
};

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
  const [viewingDiagram, setViewingDiagram] = useState<SequenceDiagram | null>(null);
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
    | { kind: "batch"; batchId: string }
    | { kind: "report"; reportId: string }
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

  async function applyLinks(kind: LinkKind, ids: string[]) {
    if (!allCountries && !countryValue) {
      throw new ApiError(400, "Choose All countries or at least one country before linking.");
    }
    if (savedId) {
      await api<KbCapabilityRecord>(`/api/capabilities/${encodeURIComponent(savedId)}`, {
        method: "PATCH",
        body: JSON.stringify({ country: countryValue }),
      });
      let saved: KbCapabilityRecord | null = null;
      try {
        for (const id of ids) saved = await linkOne(kind, id, savedId);
      } finally {
        // show whatever was linked, even if a later item failed
        if (saved) {
          applyRecord(saved);
          onSaved(saved);
        }
      }
      return;
    }
    setPending((current) => [...current, ...ids.filter((id) => !current.some((item) => item.kind === kind && item.id === id)).map((id) => ({ kind, id }))]);
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

  const pickerRows = useMemo((): LinkPickerRow[] => {
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
        .map((row) => ({
          id: row.interface_id,
          label: row.interface_name,
          cells: [row.interface_name, applicableFor(row.country), row.channel, row.protocol, [row.source, row.destination].filter(Boolean).join(" → ")],
        }));
    }
    if (picker === "tables") {
      return catalog.tables
        .filter((row) => matches(row.country) && !linkedIds.has(row.table_id))
        .map((row) => ({
          id: row.table_id,
          label: `${row.database_name}.${row.schema_name}.${row.table_name}`,
          cells: [row.table_name, row.country, row.database_name, row.schema_name, row.description],
        }));
    }
    if (picker === "batches") {
      return catalog.batches
        .filter((row) => matches(row.country) && !linkedIds.has(row.batch_id))
        .map((row) => ({
          id: row.batch_id,
          label: row.batch_name,
          cells: [row.batch_name, row.country, row.system_code, row.batch_type, row.description],
        }));
    }
    return catalog.reports
      .filter((row) => matches(row.country) && !linkedIds.has(row.report_id))
      .map((row) => ({
        id: row.report_id,
        label: row.report_name,
        cells: [row.report_name, row.country, row.system_code, row.report_code, row.description],
      }));
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
        onOpen: () => setInspect({ kind: "batch", batchId: row.batch_id }),
      }));
      const extra = pending
        .filter((item) => item.kind === "batches")
        .map((item) => {
          const row = catalog.batches.find((entry) => entry.batch_id === item.id);
          return { id: item.id, label: row ? `${row.system_code} · ${row.batch_name}` : item.id, onOpen: () => setInspect({ kind: "batch", batchId: item.id }) };
        });
      return [...saved, ...extra];
    }
    const saved = (links.reports || []).map((row) => ({
      id: row.report_id,
      label: `${row.system_code} · ${row.report_name}`,
      onOpen: () => setInspect({ kind: "report", reportId: row.report_id }),
    }));
    const extra = pending
      .filter((item) => item.kind === "reports")
      .map((item) => {
        const row = catalog.reports.find((entry) => entry.report_id === item.id);
        return { id: item.id, label: row ? `${row.system_code} · ${row.report_name}` : item.id, onOpen: () => setInspect({ kind: "report", reportId: item.id }) };
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
            <span className="font-label text-[10px] uppercase text-muted">Diagrams</span>
            {!readOnly && (
              <button type="button" className="btn" disabled={busy} onClick={() => setDiagramsOpen(true)}>
                Add / edit
              </button>
            )}
          </div>
          {diagrams.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No diagrams.</p>
          ) : (
            <ul className="mt-1 space-y-3">
              {diagrams.map((diagram) => (
                <li key={diagram.id} className="rounded-lg border border-hairline p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{diagram.title}</p>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Expand ${diagram.title}`}
                      title="Expand diagram"
                      onClick={() => setViewingDiagram(diagram)}
                    >
                      <span className="material-symbols-outlined text-base">open_in_full</span>
                      Expand
                    </button>
                  </div>
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
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {readOnly && savedId && <DownloadButtons path={`/api/capabilities/${encodeURIComponent(savedId)}/export`} filename={[l1, l2, l3].filter(Boolean).join("-") || "capability"} />}
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
      {viewingDiagram && (
        <DiagramPopup
          source={viewingDiagram.mermaid}
          title={viewingDiagram.title}
          layerClass="z-[80]"
          onClose={() => setViewingDiagram(null)}
        />
      )}
      {picker && (
        <LinkPickerDialog
          title={`Link ${{ interfaces: "interfaces", tables: "tables", batches: "batches", reports: "reports" }[picker]}`}
          noun={picker}
          country={applicableFor(countryValue)}
          columns={PICKER_COLUMNS[picker]}
          rows={pickerRows}
          onPick={(ids) => applyLinks(picker, ids)}
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
      {inspect?.kind === "batch" && <BatchDetailsDialog batchId={inspect.batchId} layerClass="z-[70]" onClose={() => setInspect(null)} />}
      {inspect?.kind === "report" && <ReportDetailsDialog reportId={inspect.reportId} layerClass="z-[70]" onClose={() => setInspect(null)} />}
      {inspect?.kind === "interface" && (
        <InterfaceDetailDialog
          channel={inspect.row.channel}
          interfaceId={inspect.row.interface_id}
          fallbackName={inspect.row.interface_name}
          layerClass="z-[70]"
          onClose={() => setInspect(null)}
        />
      )}
      {unlinking && (
        <ConfirmDialog
          title="Unlink item"
          message={`Remove the link to “${unlinking.name}”? The catalogue item itself is kept.`}
          confirmLabel="Unlink"
          onConfirm={unlink}
          onClose={() => setUnlinking(null)}
        />
      )}
    </div>
  );
}

function groupNamed(rows: KbCapabilityRecord[], nameOf: (row: KbCapabilityRecord) => string) {
  const map = new Map<string, KbCapabilityRecord[]>();
  for (const row of rows) {
    const name = nameOf(row);
    const list = map.get(name);
    if (list) list.push(row);
    else map.set(name, [row]);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));
}

function HierarchyNode({
  label,
  selected,
  expanded,
  onClick,
  nodeRef,
  onInfo,
  infoLabel,
  hasInfo,
}: {
  label: string;
  selected?: boolean;
  expanded?: boolean;
  onClick?: () => void;
  nodeRef?: (element: HTMLElement | null) => void;
  /** Opens the L1 / L2 details window. */
  onInfo?: () => void;
  infoLabel?: string;
  hasInfo?: boolean;
}) {
  const className = `relative z-[1] rounded-lg border px-3 py-2 text-left text-sm font-medium break-words min-w-[9rem] max-w-[16rem] ${
    selected ? "border-[var(--accent,currentColor)] bg-inset shadow-sm" : "border-hairline bg-panel hover:bg-inset/70"
  }`;
  if (onClick && onInfo) {
    return (
      <div ref={nodeRef} className={`${className} flex items-start gap-1 !p-0`}>
        <button type="button" className="flex-1 min-w-0 px-3 py-2 text-left break-words" aria-expanded={expanded} onClick={onClick}>
          {label}
        </button>
        <button
          type="button"
          className={`shrink-0 mt-1 mr-1 rounded p-1 leading-none hover:bg-inset ${hasInfo ? "text-accent" : "text-muted opacity-60 hover:opacity-100"}`}
          aria-label={infoLabel ?? `Details for ${label}`}
          title={hasInfo ? "View details" : "No details yet"}
          onClick={onInfo}
        >
          <span className="material-symbols-outlined text-base" style={hasInfo ? { fontVariationSettings: "'FILL' 1" } : undefined}>
            info
          </span>
        </button>
      </div>
    );
  }
  if (!onClick) {
    return (
      <div ref={nodeRef} className={className}>
        {label}
      </div>
    );
  }
  return (
    <button ref={nodeRef} type="button" className={className} aria-expanded={expanded} onClick={onClick}>
      {label}
    </button>
  );
}

type TreeLink = { from: string; to: string[]; active?: string };
type TreePath = { d: string; active: boolean };

/** Elbow connectors from the right middle of a parent box to the left middle of each child box. */
function treePaths(container: HTMLElement, nodes: Map<string, HTMLElement>, links: TreeLink[]): TreePath[] {
  const box = container.getBoundingClientRect();
  const anchor = (key: string, side: "left" | "right") => {
    const element = nodes.get(key);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: (side === "right" ? rect.right : rect.left) - box.left, y: rect.top + rect.height / 2 - box.top };
  };
  const paths: TreePath[] = [];
  for (const link of links) {
    const start = anchor(link.from, "right");
    if (!start) continue;
    for (const child of link.to) {
      const end = anchor(child, "left");
      if (!end) continue;
      const mid = start.x + (end.x - start.x) / 2;
      const dy = end.y - start.y;
      const radius = Math.min(8, Math.abs(dy) / 2, (end.x - start.x) / 4);
      const sign = dy > 0 ? 1 : -1;
      const d =
        Math.abs(dy) < 1
          ? `M ${start.x} ${start.y} H ${end.x}`
          : `M ${start.x} ${start.y} H ${mid - radius} Q ${mid} ${start.y} ${mid} ${start.y + sign * radius} ` +
            `V ${end.y - sign * radius} Q ${mid} ${end.y} ${mid + radius} ${end.y} H ${end.x}`;
      paths.push({ d, active: link.active === child });
    }
  }
  // the highlighted branch is drawn last so it sits on top where lines share the trunk
  return paths.sort((a, b) => Number(a.active) - Number(b.active));
}

export function CapabilityHierarchyDialog({
  country,
  systemCode,
  systemName,
  rows,
  countries = [],
  onOpen,
  onClose,
}: {
  country: string;
  systemCode: string;
  systemName: string;
  rows: KbCapabilityRecord[];
  countries?: string[];
  onOpen: (capabilityId: string) => void;
  onClose: () => void;
}) {
  const [openL1, setOpenL1] = useState<string | null>(null);
  const [openL2, setOpenL2] = useState<string | null>(null);
  const [nodeDetails, setNodeDetails] = useState<KbCapabilityNode[]>([]);
  const [detail, setDetail] = useState<CapabilityNodeRef | null>(null);
  const loadNodes = useCallback(() => {
    if (!systemCode) return;
    api<KbCapabilityNode[]>(`/api/capability-nodes?system=${encodeURIComponent(systemCode)}`)
      .then(setNodeDetails)
      .catch(() => setNodeDetails([]));
  }, [systemCode]);
  useEffect(() => {
    loadNodes();
  }, [loadNodes]);
  const l1Groups = groupNamed(rows, (row) => row.l1_capability);
  const l2Groups = openL1 ? groupNamed(l1Groups.find(([name]) => name === openL1)?.[1] ?? [], (row) => row.l2_capability) : [];
  const l3Rows = openL2 ? (l2Groups.find(([name]) => name === openL2)?.[1] ?? []).slice().sort((a, b) => a.l3_capability.localeCompare(b.l3_capability, undefined, { sensitivity: "base" })) : [];

  const treeRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<TreePath[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const register = (key: string) => (element: HTMLElement | null) => {
    if (element) nodes.current.set(key, element);
    else nodes.current.delete(key);
  };

  const links: TreeLink[] = [
    { from: "root", to: l1Groups.map(([name]) => `l1:${name}`), active: openL1 ? `l1:${openL1}` : undefined },
    ...(openL1 ? [{ from: `l1:${openL1}`, to: l2Groups.map(([name]) => `l2:${name}`), active: openL2 ? `l2:${openL2}` : undefined }] : []),
    ...(openL2 ? [{ from: `l2:${openL2}`, to: l3Rows.map((row) => `l3:${row.capability_id}`) }] : []),
  ];
  const linkKey = JSON.stringify(links);

  const redraw = useCallback(() => {
    const container = treeRef.current;
    if (!container) return;
    setSize({ width: container.scrollWidth, height: container.scrollHeight });
    setPaths(treePaths(container, nodes.current, JSON.parse(linkKey) as TreeLink[]));
  }, [linkKey]);

  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const container = treeRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [redraw]);

  const column = "flex flex-col justify-center gap-3";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Capability hierarchy" className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-headline text-xl font-semibold">Capability hierarchy</h2>
            <p className="text-xs text-muted mt-1">
              {country} · {systemCode}
              {systemName !== systemCode ? ` — ${systemName}` : ""}. Open an L1 to see its L2 capabilities, then an L2 to see L3. Click an L3 to view it, or the
              <span className="material-symbols-outlined align-middle text-sm mx-0.5">info</span>
              on an L1 or L2 to view its description and diagrams.
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-muted">No capabilities for this country and system.</p>
        ) : (
          <div className="overflow-x-auto py-2">
            <div ref={treeRef} className="relative inline-flex items-center gap-14 min-w-full" aria-label="Capability tree">
              <svg className="pointer-events-none absolute inset-0 z-0" width={size.width} height={size.height} aria-hidden="true">
                {paths.map((path, index) => (
                  <path
                    key={index}
                    d={path.d}
                    fill="none"
                    strokeWidth={path.active ? 2 : 1.5}
                    strokeLinecap="round"
                    style={{ stroke: path.active ? "var(--accent, #1a4b8c)" : "var(--muted, #6b7280)", opacity: path.active ? 1 : 0.45 }}
                  />
                ))}
              </svg>
              <div className={column}>
                <HierarchyNode label={systemName || systemCode} nodeRef={register("root")} />
              </div>
              <div className={column}>
                {l1Groups.map(([name]) => (
                  <HierarchyNode
                    key={name}
                    label={name}
                    nodeRef={register(`l1:${name}`)}
                    selected={openL1 === name}
                    expanded={openL1 === name}
                    infoLabel={`Details for L1 ${name}`}
                    hasInfo={hasDetails(nodeDetails, { systemCode, level: 1, l1: name, l2: "" }, country)}
                    onInfo={() => setDetail({ systemCode, level: 1, l1: name, l2: "" })}
                    onClick={() => {
                      setOpenL1((current) => (current === name ? null : name));
                      setOpenL2(null);
                    }}
                  />
                ))}
              </div>
              {openL1 && (
                <div className={column}>
                  {l2Groups.map(([name]) => (
                    <HierarchyNode
                      key={name}
                      label={name}
                      nodeRef={register(`l2:${name}`)}
                      selected={openL2 === name}
                      expanded={openL2 === name}
                      infoLabel={`Details for L2 ${name}`}
                      hasInfo={hasDetails(nodeDetails, { systemCode, level: 2, l1: openL1, l2: name }, country)}
                      onInfo={() => setDetail({ systemCode, level: 2, l1: openL1, l2: name })}
                      onClick={() => setOpenL2((current) => (current === name ? null : name))}
                    />
                  ))}
                </div>
              )}
              {openL2 && (
                <div className={column}>
                  {l3Rows.map((row) => (
                    <HierarchyNode key={row.capability_id} label={row.l3_capability} nodeRef={register(`l3:${row.capability_id}`)} onClick={() => onOpen(row.capability_id)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {detail && (
        <CapabilityNodeWindow
          node={detail}
          systemName={systemName}
          country={country}
          countries={countries}
          canEdit={false}
          {...nodeChildren(rows, detail)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/** The L2 names under an L1, or the L3 names under an L2, for the details window. */
function nodeChildren(rows: KbCapabilityRecord[], node: CapabilityNodeRef) {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const under = rows.filter((row) => same(row.l1_capability, node.l1) && (node.level === 1 || same(row.l2_capability, node.l2)));
  const names = [...new Set(under.map((row) => (node.level === 1 ? row.l2_capability : row.l3_capability)))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  return { childLabel: node.level === 1 ? "L2 capabilities" : "L3 capabilities", childNames: names };
}

export function CapabilitiesPanel() {
  const auth = useOptionalAuth();
  // Without a signed-in user (component previews) editing stays on, as before.
  const canEdit = !auth?.user || can(auth.user, "knowledge", "write");
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<KbCapabilityRecord[]>([]);
  const [countries, setCountries] = useState<string[]>(["SG", "MY", "TH", "VN", "ID"]);
  const [systems, setSystems] = useState<SystemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState(() => searchParams.get("country") || "SG");
  const [systemFilter, setSystemFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<{ capability?: KbCapabilityRecord } | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [nodeDetail, setNodeDetail] = useState<CapabilityNodeRef | null>(null);
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
    reloadCapabilities();
  }, []);

  function reloadCapabilities() {
    api<KbCapabilityRecord[]>("/api/capabilities")
      .then((data) => {
        setItems(data);
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load capabilities"))
      .finally(() => setLoading(false));
  }

  function openNode(event: { stopPropagation: () => void }, row: KbCapabilityRecord, level: 1 | 2) {
    event.stopPropagation();
    setNodeDetail({ systemCode: row.system_code, level, l1: row.l1_capability, l2: level === 2 ? row.l2_capability : "" });
  }

  useEffect(() => {
    setCountryFilter((current) => (countries.includes(current) ? current : countries.includes("SG") ? "SG" : countries[0] ?? "SG"));
  }, [countries]);

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

  const hierarchyRows = useMemo(
    () => items.filter((row) => appliesToCountry(row.country, countryFilter) && row.system_code === systemFilter),
    [items, countryFilter, systemFilter],
  );
  const hierarchySystemName = systemsForFilter.find((item) => item.system_code === systemFilter)?.system_name || systemFilter;

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
        <div className="flex items-center gap-2">
          <button type="button" className="btn" onClick={() => setHierarchyOpen(true)} disabled={!systemFilter}>
            <span className="material-symbols-outlined text-base">account_tree</span>
            View Hierarchy
          </button>
          {canEdit && (
            <>
            <button type="button" className="btn" onClick={() => setForm({})}>
              <span className="material-symbols-outlined text-base">add</span>
              Add capability
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>
              <span className="material-symbols-outlined text-base">upload</span>
              Upload
            </button>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-alert">{error}</p>}
      {notice && (
        <p className="text-accent" role="status">
          {notice}
        </p>
      )}
      <div role="tablist" aria-label="Countries" className="flex gap-1 border-b border-hairline flex-wrap">
        {countries.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === countryFilter}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${item === countryFilter ? "border-[var(--accent,currentColor)] font-semibold" : "border-transparent text-muted hover:text-inherit"}`}
            onClick={() => setCountryFilter(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
            <section key={group.key} className="bg-panel border border-hairline rounded-lg overflow-hidden" aria-label={group.system}>
              <div className="flex items-center justify-between gap-2 border-b border-hairline bg-inset px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
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
                      <td className="py-2.5 px-3 font-label text-xs">
                        <span className="inline-flex items-center gap-1">
                          {sentenceCase(row.l1_capability)}
                          <button
                            type="button"
                            className="icon-btn !p-0.5 opacity-50 hover:opacity-100"
                            aria-label={`L1 details: ${row.l1_capability}`}
                            title="View L1 details"
                            onClick={(event) => openNode(event, row, 1)}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <span className="material-symbols-outlined text-sm">info</span>
                          </button>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-muted">
                        <span className="inline-flex items-center gap-1">
                          {sentenceCase(row.l2_capability)}
                          <button
                            type="button"
                            className="icon-btn !p-0.5 opacity-50 hover:opacity-100"
                            aria-label={`L2 details: ${row.l2_capability}`}
                            title="View L2 details"
                            onClick={(event) => openNode(event, row, 2)}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <span className="material-symbols-outlined text-sm">info</span>
                          </button>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-muted">{sentenceCase(row.l3_capability)}</td>
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
      {hierarchyOpen && (
        <CapabilityHierarchyDialog
          country={countryFilter}
          systemCode={systemFilter}
          systemName={hierarchySystemName}
          rows={hierarchyRows}
          countries={countries}
          onOpen={(capabilityId) => setInspecting(capabilityId)}
          onClose={() => setHierarchyOpen(false)}
        />
      )}
      {nodeDetail && (
        <CapabilityNodeWindow
          node={nodeDetail}
          systemName={systems.find((item) => item.system_code === nodeDetail.systemCode)?.system_name}
          country={countryFilter}
          countries={countries}
          canEdit={canEdit}
          {...nodeChildren(hierarchyRows, nodeDetail)}
          onRenamed={reloadCapabilities}
          onClose={() => setNodeDetail(null)}
        />
      )}
      {uploading && (
        <UploadCapabilitiesDialog
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
