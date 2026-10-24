import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type { Catalogs, InterfaceField, InterfaceParty, InterfaceRecord, SystemRecord } from "../types";
import { appliesToCountry } from "../countries";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileDrop } from "./FileDrop";
import { type Column, DataTable } from "./DataTable";
import { KB_PAGE_SIZES } from "./TablePager";
import { SelectField } from "./SelectField";
import { InterfaceDetailDialog, InterfaceFieldTable } from "./InterfaceSpec";
import { ProcessingRulesEditor } from "./ProcessingRulesEditor";
import { can } from "../permissions";

export const INTERFACES_PAGE_SIZE = 25;
export const PROTOCOLS = ["API", "MQ", "Kafka", "gRPC", "FTP", "SMTP", "SMPP"];
export const FORMATS = ["JSON", "XML", "Fixed length", "Delimiter"];

type PartyRow = { key: string; system: string; interface_id: string; interface_name: string };
type KnownInterface = { interface_id: string; channel: string; interface_name: string; endpoint: string };

function partyKey() {
  return crypto.randomUUID();
}

function toParties(rows: InterfaceParty[] | undefined, fallback: string | undefined): PartyRow[] {
  const source = rows ?? ((fallback ?? "").trim() ? [{ system: fallback ?? "", interface_id: "", interface_name: "" }] : []);
  return source.map((row) => ({ key: partyKey(), system: row.system, interface_id: row.interface_id, interface_name: row.interface_name }));
}

function systemProblem(system: string, known: Set<string>) {
  const parts = system
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) return "Enter one system code.";
  if (parts.length === 1 && !known.has(parts[0].toUpperCase())) return `${parts[0].toUpperCase()} is not a known system code.`;
  return "";
}

function countryCodes(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function applicableFor(country: string) {
  const codes = countryCodes(country);
  return codes.length ? codes.join(", ") : "All countries";
}

function CountryChecks({
  countries,
  allCountries,
  selected,
  disabled,
  onAll,
  onToggle,
}: {
  countries: string[];
  allCountries: boolean;
  selected: string[];
  disabled?: boolean;
  onAll: (checked: boolean) => void;
  onToggle: (code: string) => void;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="font-label text-[10px] uppercase text-muted">Application for</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label="All countries" checked={allCountries} onChange={(event) => onAll(event.target.checked)} />
          All countries
        </label>
        {countries.map((code) => (
          <label key={code} className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label={code} checked={!allCountries && selected.includes(code)} onChange={() => onToggle(code)} />
            {code}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function InterfacePartyTable({
  label,
  rows,
  systems,
  catalogue,
  disabled,
  onChange,
  onView,
}: {
  label: string;
  rows: PartyRow[];
  systems: SystemRecord[];
  catalogue: KnownInterface[];
  disabled?: boolean;
  onChange: (rows: PartyRow[]) => void;
  onView: (item: KnownInterface) => void;
}) {
  const known = useMemo(() => new Set(systems.map((item) => item.system_code.toUpperCase())), [systems]);
  const heading = label.toLowerCase();

  function update(key: string, patch: Partial<PartyRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="font-label text-[10px] uppercase text-muted">{label}</legend>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No items.</p>
      ) : (
        <table className="w-full text-sm border border-hairline">
          <thead>
            <tr className="text-left font-label text-[10px] uppercase text-muted">
              <th className="px-3 py-2 w-[40%]">System</th>
              <th className="px-3 py-2">Interface</th>
              {!disabled && <th className="px-3 py-2 w-10" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const problem = systemProblem(row.system, known);
              const position = index + 1;
              return (
                <tr key={row.key} className="border-t border-hairline align-top">
                  <td className="px-3 py-2">
                    <input
                      className="field"
                      aria-label={`${label} system ${position}`}
                      aria-invalid={problem !== ""}
                      value={row.system}
                      disabled={disabled}
                      placeholder="System code"
                      onChange={(event) => update(row.key, { system: event.target.value })}
                    />
                    {problem && <p className="text-alert text-xs mt-1">{problem}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <InterfacePicker
                      label={`${label} interface ${position}`}
                      row={row}
                      catalogue={catalogue}
                      disabled={disabled}
                      onChange={(next) => update(row.key, next)}
                      onView={onView}
                    />
                  </td>
                  {!disabled && (
                    <td className="px-3 py-2">
                      <button type="button" className="icon-btn icon-btn-danger" aria-label={`Remove ${heading} ${position}`} title="Remove" onClick={() => onChange(rows.filter((item) => item.key !== row.key))}>
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!disabled && (
        <button
          type="button"
          className="btn"
          onClick={() => onChange([...rows, { key: partyKey(), system: "", interface_id: "", interface_name: "" }])}
        >
          Add {heading}
        </button>
      )}
    </fieldset>
  );
}

function InterfacePicker({
  label,
  row,
  catalogue,
  disabled,
  onChange,
  onView,
}: {
  label: string;
  row: PartyRow;
  catalogue: KnownInterface[];
  disabled?: boolean;
  onChange: (patch: Partial<PartyRow>) => void;
  onView: (item: KnownInterface) => void;
}) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const needle = row.interface_name.trim().toLowerCase();
    const pool = needle
      ? catalogue.filter((item) => item.interface_name.toLowerCase().includes(needle) || item.endpoint.toLowerCase().includes(needle))
      : catalogue;
    return pool.slice(0, 8);
  }, [catalogue, row.interface_name]);
  const linked = catalogue.find((item) => item.interface_id === row.interface_id);

  async function view() {
    if (linked) {
      onView(linked);
      return;
    }
    if (!row.interface_id) return;
    const data = await api<InterfaceRecord>(`/api/interfaces/id/${encodeURIComponent(row.interface_id)}`);
    onView({ interface_id: data.interface_id, channel: data.channel, interface_name: data.interface_name, endpoint: data.endpoint || "" });
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <input
          className="field"
          aria-label={label}
          aria-expanded={open}
          aria-autocomplete="list"
          value={row.interface_name}
          disabled={disabled}
          placeholder="Search or type an interface"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => onChange({ interface_name: event.target.value, interface_id: "" })}
        />
        {row.interface_id && (
          <button type="button" className="icon-btn shrink-0" aria-label={`View ${row.interface_name || "interface"}`} title="View interface" onMouseDown={(event) => event.preventDefault()} onClick={() => void view()}>
            <span className="material-symbols-outlined text-base">open_in_new</span>
          </button>
        )}
      </div>
      {open && matches.length > 0 && (
        <ul role="listbox" aria-label={`${label} matches`} className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded border border-hairline bg-panel shadow-lg">
          {matches.map((item) => (
            <li key={item.interface_id}>
              <button
                type="button"
                role="option"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange({ interface_id: item.interface_id, interface_name: item.interface_name });
                  setOpen(false);
                }}
              >
                <span className="min-w-0 truncate">{item.interface_name}</span>
                <span className="font-label text-xs text-muted truncate">{item.endpoint || "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadFieldsDialog({
  channel,
  onUploaded,
  onClose,
}: {
  channel: string;
  onUploaded: (fields: InterfaceField[]) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<RowError[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Please select an Excel (.xlsx) file.");
      return;
    }
    setBusy(true);
    setError("");
    setProblems([]);
    try {
      const body = new FormData();
      body.append("file", file);
      const saved = await api<{ fields: InterfaceField[] }>(`/api/interfaces/${encodeURIComponent(channel)}/fields/upload`, { method: "POST", body });
      onUploaded(saved.fields ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      if (err instanceof ApiError) setProblems(err.errors);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label="Upload fields" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4" onSubmit={(event) => void submit(event)}>
        <div>
          <h2 className="font-headline text-xl font-semibold">Upload fields</h2>
          <p className="text-xs text-muted mt-1">
            Excel (.xlsx) with columns: Direction, Field path, Type, Required, Length, Validation, Description, Example. Direction is request or response. This replaces the request and response fields in this dialog. Save to keep them.
          </p>
        </div>
        <div>
          <span className="font-label text-[10px] uppercase text-muted">Excel file (.xlsx)</span>
          <div className="mt-1">
            <FileDrop accept=".xlsx" ariaLabel="Upload fields Excel" file={file} disabled={busy} grow onFile={setFile} />
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
          <button type="submit" className="btn btn-primary" disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload file"}
          </button>
        </div>
      </form>
    </div>
  );
}

type SpecSection = "details" | "request" | "response" | "rules";

function InterfaceFormDialog({
  channel,
  countries,
  systems,
  record,
  readOnly = false,
  onSaved,
  onClose,
}: {
  channel: string;
  countries: string[];
  systems: SystemRecord[];
  record?: InterfaceRecord;
  readOnly?: boolean;
  onSaved: (saved: InterfaceRecord) => void;
  onClose: () => void;
}) {
  const editing = Boolean(record);
  const storedCodes = record ? countryCodes(record.country) : null;
  const [allCountries, setAllCountries] = useState(storedCodes !== null && storedCodes.length === 0);
  const [selectedCountries, setSelectedCountries] = useState<string[]>(
    storedCodes && storedCodes.length ? storedCodes : storedCodes ? [] : [countries.includes("SG") ? "SG" : countries[0]].filter(Boolean),
  );
  const [name, setName] = useState(record?.interface_name ?? "");
  const [endpoint, setEndpoint] = useState(record?.endpoint ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [protocol, setProtocol] = useState(record?.protocol ?? "API");
  const [format, setFormat] = useState(record?.format ?? "");
  const [upstream, setUpstream] = useState<PartyRow[]>(() => toParties(record?.upstream, record?.source ?? ""));
  const [downstream, setDownstream] = useState<PartyRow[]>(() => toParties(record?.downstream, record?.destination ?? ""));
  const [catalogue, setCatalogue] = useState<KnownInterface[]>([]);
  const [viewingParty, setViewingParty] = useState<KnownInterface | null>(null);
  const [fields, setFields] = useState<InterfaceField[]>(record?.fields ?? []);
  const [processingRules, setProcessingRules] = useState(record?.processing_rules ?? "");
  const [validationRules, setValidationRules] = useState(record?.validation_rules ?? "");
  const [section, setSection] = useState<SpecSection>("details");
  const [uploadingFields, setUploadingFields] = useState(false);
  const [ready, setReady] = useState(!record);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!record) return;
    let current = true;
    api<InterfaceRecord>(`/api/interfaces/${encodeURIComponent(channel)}/${encodeURIComponent(record.interface_id)}`)
      .then((data) => {
        if (!current) return;
        setFields(data.fields ?? []);
        setProcessingRules(data.processing_rules ?? "");
        setValidationRules(data.validation_rules ?? "");
        setFormat(data.format ?? "");
        setUpstream(toParties(data.upstream, data.source));
        setDownstream(toParties(data.downstream, data.destination));
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!current) return;
        setError(err instanceof ApiError ? err.message : "Could not load interface");
        setReady(true);
      });
    return () => {
      current = false;
    };
  }, [channel, record]);

  useEffect(() => {
    let current = true;
    api<Catalogs>("/api/catalogs")
      .then(async (catalogs) => {
        const channels = catalogs.interface_channels?.length ? catalogs.interface_channels : [channel];
        const lists = await Promise.all(channels.map((item) => api<InterfaceRecord[]>(`/api/interfaces/${encodeURIComponent(item)}`).catch(() => [] as InterfaceRecord[])));
        if (!current) return;
        const editingId = record?.interface_id;
        setCatalogue(
          lists
            .flat()
            .filter((row) => row.interface_id !== editingId)
            .map((row) => ({ interface_id: row.interface_id, channel: row.channel, interface_name: row.interface_name, endpoint: row.endpoint || "" })),
        );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [channel, record?.interface_id]);

  function toggle(list: string[], code: string, setList: (next: string[]) => void) {
    setList(list.includes(code) ? list.filter((item) => item !== code) : [...list, code]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const country = allCountries ? "" : countries.filter((code) => selectedCountries.includes(code)).join(",");
    const known = new Set(systems.map((item) => item.system_code.toUpperCase()));
    const invalid = [...upstream, ...downstream].map((row) => systemProblem(row.system, known)).filter(Boolean);
    if ((!allCountries && !country) || !name.trim()) {
      setError("Choose All countries or at least one country, and a name.");
      return;
    }
    if (invalid.length > 0) {
      setError(invalid[0]);
      return;
    }
    setBusy(true);
    setError("");
    const parties = (rows: PartyRow[]) =>
      rows
        .filter((row) => row.system.trim() || row.interface_name.trim() || row.interface_id)
        .map(({ system, interface_id, interface_name }) => ({ system: system.trim(), interface_id, interface_name: interface_name.trim() }));
    const payload = {
      country,
      interface_name: name.trim(),
      endpoint: endpoint.trim(),
      description: description.trim(),
      protocol,
      format,
      upstream: parties(upstream),
      downstream: parties(downstream),
      processing_rules: processingRules,
      validation_rules: validationRules,
      fields,
    };
    try {
      const saved = record
        ? await api<InterfaceRecord>(`/api/interfaces/${encodeURIComponent(channel)}/${encodeURIComponent(record.interface_id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<InterfaceRecord>(`/api/interfaces/${encodeURIComponent(channel)}`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save interface");
      setBusy(false);
    }
  }

  const title = readOnly ? "View interface" : editing ? "Edit interface" : "Add interface";
  const locked = busy || readOnly;
  const sections: { id: SpecSection; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "request", label: "Request" },
    { id: "response", label: "Response" },
    { id: "rules", label: "Rules" },
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-lg border border-hairline bg-panel shadow-xl"
        onSubmit={(event) => void submit(event)}
      >
        <div className="border-b border-hairline px-6 py-4">
          <h2 className="font-headline text-xl font-semibold">{title}</h2>
          <p className="text-xs text-muted">Channel: {channel}</p>
        </div>
        <div role="tablist" aria-label="Interface sections" className="flex gap-1 border-b border-hairline px-6">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={section === item.id}
              className={`px-3 py-2 text-sm border-b-2 -mb-px ${section === item.id ? "border-[var(--accent,currentColor)] font-semibold" : "border-transparent text-muted hover:text-inherit"}`}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {!ready ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <>
        {section === "details" && (
          <>
        <CountryChecks
          countries={countries}
          allCountries={allCountries}
          selected={selectedCountries}
          disabled={locked}
          onAll={(checked) => {
            setAllCountries(checked);
            if (checked) setSelectedCountries([]);
          }}
          onToggle={(code) => {
            setAllCountries(false);
            toggle(selectedCountries, code, setSelectedCountries);
          }}
        />
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Interface name</span>
          <input className="field mt-1" aria-label="Interface name" value={name} required disabled={locked} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Endpoint</span>
          <input className="field mt-1" aria-label="Endpoint" value={endpoint} disabled={locked} onChange={(e) => setEndpoint(e.target.value)} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Protocol</span>
            <div className="mt-1">
              <SelectField
                aria-label="Protocol"
                value={protocol}
                disabled={locked}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={PROTOCOLS.map((item) => ({ value: item, label: item }))}
                onChange={setProtocol}
              />
            </div>
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Format</span>
            <div className="mt-1">
              <SelectField
                aria-label="Format"
                value={format}
                disabled={locked}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={[{ value: "", label: "—" }, ...FORMATS.map((item) => ({ value: item, label: item }))]}
                onChange={setFormat}
              />
            </div>
          </label>
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[70px]" aria-label="Description" value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <InterfacePartyTable label="Upstream interfaces" rows={upstream} systems={systems} catalogue={catalogue} disabled={locked} onChange={setUpstream} onView={setViewingParty} />
        <InterfacePartyTable label="Downstream interfaces" rows={downstream} systems={systems} catalogue={catalogue} disabled={locked} onChange={setDownstream} onView={setViewingParty} />
          </>
        )}
        {(section === "request" || section === "response") && (
          <>
            {!readOnly && (
              <div className="flex justify-end">
                <button type="button" className="btn" onClick={() => setUploadingFields(true)}>
                  <span className="material-symbols-outlined text-base" aria-hidden="true">upload</span>
                  Upload fields
                </button>
              </div>
            )}
            <InterfaceFieldTable direction={section} fields={fields} readOnly={readOnly} onChange={setFields} />
          </>
        )}
        {section === "rules" && (
          <div className="space-y-4">
            <div>
              <span className="font-label text-[10px] uppercase text-muted">Processing rules</span>
              <div className="mt-1">
                <ProcessingRulesEditor value={processingRules} onChange={setProcessingRules} readOnly={readOnly} label="Processing rules" toolbarLabel="Processing rules formatting" />
              </div>
            </div>
            <div>
              <span className="font-label text-[10px] uppercase text-muted">Validation rules</span>
              <div className="mt-1">
                <ProcessingRulesEditor value={validationRules} onChange={setValidationRules} readOnly={readOnly} label="Validation rules" toolbarLabel="Validation rules formatting" />
              </div>
            </div>
          </div>
        )}
          </>
        )}
        {error && <p className="text-alert text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-6 py-4">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button type="submit" className="btn btn-primary" disabled={busy || !ready || !name.trim()}>
              {editing ? "Save" : "Add"}
            </button>
          )}
        </div>
      </form>
      {viewingParty && (
        <InterfaceDetailDialog
          channel={viewingParty.channel}
          interfaceId={viewingParty.interface_id}
          fallbackName={viewingParty.interface_name}
          layerClass="z-[80]"
          onClose={() => setViewingParty(null)}
        />
      )}
      {uploadingFields && (
        <UploadFieldsDialog
          channel={channel}
          onClose={() => setUploadingFields(false)}
          onUploaded={(next) => {
            setFields(next);
            setUploadingFields(false);
          }}
        />
      )}
    </div>
  );
}

function UploadInterfacesDialog({
  channel,
  countries,
  onUploaded,
  onClose,
}: {
  channel: string;
  countries: string[];
  onUploaded: (rows: InterfaceRecord[]) => void;
  onClose: () => void;
}) {
  const [allCountries, setAllCountries] = useState(false);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([countries.includes("SG") ? "SG" : countries[0]].filter(Boolean));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<RowError[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const country = allCountries ? "" : countries.filter((code) => selectedCountries.includes(code)).join(",");
    if (!file || (!allCountries && !country)) {
      setError(!file ? "Please select an Excel (.xlsx) file." : "Choose All countries or at least one country.");
      return;
    }
    setBusy(true);
    setError("");
    setProblems([]);
    try {
      const body = new FormData();
      body.append("country", country);
      body.append("file", file);
      const saved = await api<InterfaceRecord[]>(`/api/interfaces/${encodeURIComponent(channel)}/upload`, { method: "POST", body });
      onUploaded(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      if (err instanceof ApiError) setProblems(err.errors);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label="Upload interfaces" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4" onSubmit={(event) => void submit(event)}>
        <div>
          <h2 className="font-headline text-xl font-semibold">Upload Interfaces</h2>
          <p className="text-xs text-muted mt-1">
            Excel (.xlsx) with columns: Interface name, Endpoint, Description, Protocol, Source, Destination. Source and Destination can list several system codes. This replaces the {channel} interfaces for the countries you choose.
          </p>
        </div>
        <CountryChecks
          countries={countries}
          allCountries={allCountries}
          selected={selectedCountries}
          disabled={busy}
          onAll={(checked) => {
            setAllCountries(checked);
            if (checked) setSelectedCountries([]);
          }}
          onToggle={(code) => {
            setAllCountries(false);
            setSelectedCountries((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
          }}
        />
        <div>
          <span className="font-label text-[10px] uppercase text-muted">Excel file (.xlsx)</span>
          <div className="mt-1">
            <FileDrop accept=".xlsx" ariaLabel={`Upload ${channel} Excel`} file={file} disabled={busy} grow onFile={setFile} />
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
          <button type="submit" className="btn btn-primary" disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload file"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function InterfacesPanel() {
  const auth = useOptionalAuth();
  // Without a signed-in user (component previews) editing stays on, as before.
  const canEdit = !auth?.user || can(auth.user, "knowledge", "write");
  const [params, setParams] = useSearchParams();
  const [channels, setChannels] = useState<string[]>(["SPL", "DGE", "PIB", "NTN", "WSM", "EAI"]);
  const [countries, setCountries] = useState<string[]>(["SG", "MY", "TH", "VN", "ID"]);
  const [systems, setSystems] = useState<SystemRecord[]>([]);
  const requested = (params.get("tab") ?? "").toUpperCase();
  const channel = channels.includes(requested) ? requested : channels[0];
  const [rows, setRows] = useState<InterfaceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<{ record?: InterfaceRecord; readOnly?: boolean } | null>(null);
  const [viewing, setViewing] = useState<InterfaceRecord | null>(null);
  const [deleting, setDeleting] = useState<InterfaceRecord | null>(null);
  const [countryFilter, setCountryFilter] = useState(() => params.get("country") || "SG");

  useEffect(() => {
    api<Catalogs>("/api/catalogs")
      .then((data) => {
        if (data.interface_channels?.length) setChannels(data.interface_channels);
        if (data.countries?.length) setCountries(data.countries);
      })
      .catch(() => undefined);
    api<SystemRecord[]>("/api/systems")
      .then(setSystems)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setCountryFilter((current) => (countries.includes(current) ? current : countries.includes("SG") ? "SG" : countries[0] ?? "SG"));
  }, [countries]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setRows([]);
    setError("");
    setNotice("");
    api<InterfaceRecord[]>(`/api/interfaces/${channel}`)
      .then((data) => current && setRows(data))
      .catch((err: unknown) => current && setError(err instanceof ApiError ? err.message : "Could not load interfaces"))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [channel]);

  async function remove() {
    if (!deleting) return;
    await api(`/api/interfaces/${encodeURIComponent(channel)}/${encodeURIComponent(deleting.interface_id)}`, { method: "DELETE" });
    const id = deleting.interface_id;
    setRows((current) => current.filter((row) => row.interface_id !== id));
    setDeleting(null);
  }

  const filteredRows = useMemo(
    () => rows.filter((row) => appliesToCountry(row.country, countryFilter)),
    [rows, countryFilter],
  );

  const columns: Column<InterfaceRecord>[] = [
    { key: "name", header: "Interface Name", sortValue: (row) => row.interface_name, className: "font-medium", render: (row) => row.interface_name },
    { key: "endpoint", header: "Endpoint", sortValue: (row) => row.endpoint, className: "font-label text-xs", render: (row) => row.endpoint || "—" },
    { key: "protocol", header: "Protocol", sortValue: (row) => row.protocol, className: "whitespace-nowrap", render: (row) => row.protocol },
    { key: "description", header: "Description", sortValue: (row) => row.description, className: "text-muted max-w-md", render: (row) => <span className="line-clamp-2">{row.description || "—"}</span> },
    { key: "source", header: "Source", sortValue: (row) => row.source, className: "font-label text-xs whitespace-nowrap", render: (row) => row.source },
    { key: "destination", header: "Destination", sortValue: (row) => row.destination, className: "font-label text-xs whitespace-nowrap", render: (row) => row.destination },
    {
      key: "actions",
      header: "",
      className: "whitespace-nowrap",
      render: (row: InterfaceRecord) => (
        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          {canEdit ? (
            <>
              <button type="button" className="icon-btn" aria-label={`Edit ${row.interface_name}`} title="Edit" onClick={() => setForm({ record: row })}>
                <span className="material-symbols-outlined text-base">edit</span>
              </button>
              <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.interface_name}`} title="Delete" onClick={() => setDeleting(row)}>
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
            </>
          ) : (
            <button type="button" className="icon-btn" aria-label={`View ${row.interface_name}`} title="View" onClick={() => setViewing(row)}>
              <span className="material-symbols-outlined text-base">visibility</span>
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">Interfaces</h1>
        <p className="text-muted mt-0.5">
          Manage interfaces per channel. Add them manually or upload an Excel (.xlsx) with columns Interface name, Endpoint, Description, Protocol, Source, Destination. Source and Destination can list several systems. A valid upload replaces that channel&apos;s interfaces for the countries you choose.
        </p>
      </div>
      <div role="tablist" aria-label="Interface channels" className="flex gap-1 border-b border-hairline flex-wrap">
        {channels.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === channel}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${item === channel ? "border-[var(--accent,currentColor)] font-semibold" : "border-transparent text-muted hover:text-inherit"}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("tab", item);
              setParams(next);
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div role="tablist" aria-label="Countries" className="flex gap-1 border-b border-hairline flex-wrap">
        {countries.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === countryFilter}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${item === countryFilter ? "border-[var(--accent,currentColor)] font-semibold" : "border-transparent text-muted hover:text-inherit"}`}
            onClick={() => {
              setCountryFilter(item);
              const next = new URLSearchParams(params);
              next.set("country", item);
              setParams(next);
            }}
          >
            {item}
          </button>
        ))}
      </div>
      {error && <p className="text-alert">{error}</p>}
      {notice && (
        <p className="text-accent" role="status">
          {notice}
        </p>
      )}
      <DataTable
        key={`${channel}-${countryFilter}`}
        rows={filteredRows}
        columns={columns}
        rowKey={(row) => row.interface_id}
        pageSize={INTERFACES_PAGE_SIZE}
        pageSizes={KB_PAGE_SIZES}
        emptyLabel={loading ? "Loading…" : `No ${channel} interfaces found.`}
        searchText={(row) => `${applicableFor(row.country)} ${row.interface_name} ${row.endpoint} ${row.description} ${row.protocol} ${row.source} ${row.destination}`}
        searchLabel={`Search ${channel} interfaces`}
        searchPlaceholder={`Search ${channel} interfaces`}
        onRowClick={setViewing}
        toolbar={
          canEdit ? (
            <div className="flex items-center gap-2">
              <button type="button" className="btn" onClick={() => setForm({})}>
                <span className="material-symbols-outlined text-base">add</span>
                Add
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  upload
                </span>
                Upload
              </button>
            </div>
          ) : undefined
        }
      />
      {uploading && (
        <UploadInterfacesDialog
          channel={channel}
          countries={countries}
          onClose={() => setUploading(false)}
          onUploaded={(saved) => {
            setRows(saved);
            setNotice(`${channel} now has ${saved.length} interface${saved.length === 1 ? "" : "s"}.`);
            setUploading(false);
          }}
        />
      )}
      {form && (
        <InterfaceFormDialog
          channel={channel}
          countries={countries}
          systems={systems}
          record={form.record}
          readOnly={form.readOnly}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            setRows((current) => {
              const exists = current.some((item) => item.interface_id === saved.interface_id);
              return exists ? current.map((item) => (item.interface_id === saved.interface_id ? saved : item)) : [...current, saved];
            });
            setForm(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete interface"
          message={`Delete ${deleting.interface_name}? This cannot be undone.`}
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
      {viewing && (
        <InterfaceDetailDialog
          channel={channel}
          interfaceId={viewing.interface_id}
          fallbackName={viewing.interface_name}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
