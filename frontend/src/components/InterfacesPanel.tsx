import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type { Catalogs, InterfaceRecord, SystemRecord } from "../types";
import { appliesToCountry } from "../countries";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileDrop } from "./FileDrop";
import { type Column, DataTable } from "./DataTable";
import { KB_PAGE_SIZES } from "./TablePager";
import { SelectField } from "./SelectField";

export const INTERFACES_PAGE_SIZE = 25;
export const PROTOCOLS = ["API", "MQ", "Kafka", "gRPC", "FTP", "SMTP", "SMPP"];

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
      <legend className="font-label text-[10px] uppercase text-muted">Applicable for</legend>
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

function SystemChecks({
  label,
  systems,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  systems: SystemRecord[];
  selected: string[];
  disabled?: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="font-label text-[10px] uppercase text-muted">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {systems.length === 0 && <p className="text-sm text-muted">No systems.</p>}
        {systems.map((item) => (
          <label key={item.system_code} className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={`${label} ${item.system_code}`}
              checked={selected.includes(item.system_code)}
              onChange={() => onToggle(item.system_code)}
            />
            {item.system_code}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function InterfaceFormDialog({
  channel,
  countries,
  systems,
  record,
  onSaved,
  onClose,
}: {
  channel: string;
  countries: string[];
  systems: SystemRecord[];
  record?: InterfaceRecord;
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
  const [sources, setSources] = useState<string[]>(record ? countryCodes(record.source) : []);
  const [destinations, setDestinations] = useState<string[]>(record ? countryCodes(record.destination) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(list: string[], code: string, setList: (next: string[]) => void) {
    setList(list.includes(code) ? list.filter((item) => item !== code) : [...list, code]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const country = allCountries ? "" : countries.filter((code) => selectedCountries.includes(code)).join(",");
    if ((!allCountries && !country) || !name.trim() || sources.length === 0 || destinations.length === 0) {
      setError("Choose All countries or at least one country, a name, and at least one source and destination.");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      country,
      interface_name: name.trim(),
      endpoint: endpoint.trim(),
      description: description.trim(),
      protocol,
      source: sources.join(", "),
      destination: destinations.join(", "),
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

  const title = editing ? "Edit interface" : "Add interface";
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
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3"
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="font-headline text-xl font-semibold">{title}</h2>
        <p className="text-xs text-muted">Channel: {channel}</p>
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
            toggle(selectedCountries, code, setSelectedCountries);
          }}
        />
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Interface name</span>
          <input className="field mt-1" aria-label="Interface name" value={name} required disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Endpoint</span>
          <input className="field mt-1" aria-label="Endpoint" value={endpoint} disabled={busy} onChange={(e) => setEndpoint(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Protocol</span>
          <div className="mt-1">
            <SelectField
              aria-label="Protocol"
              value={protocol}
              disabled={busy}
              className="w-full [&_button]:w-full [&_button]:max-w-none"
              options={PROTOCOLS.map((item) => ({ value: item, label: item }))}
              onChange={setProtocol}
            />
          </div>
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[70px]" aria-label="Description" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <SystemChecks label="Source" systems={systems} selected={sources} disabled={busy} onToggle={(code) => toggle(sources, code, setSources)} />
        <SystemChecks label="Destination" systems={systems} selected={destinations} disabled={busy} onToggle={(code) => toggle(destinations, code, setDestinations)} />
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || sources.length === 0 || destinations.length === 0}>
            {editing ? "Save" : "Add"}
          </button>
        </div>
      </form>
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
  const canEdit = auth?.user?.role_name !== "Viewer";
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
  const [form, setForm] = useState<{ record?: InterfaceRecord } | null>(null);
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
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            className: "whitespace-nowrap",
            render: (row: InterfaceRecord) => (
              <div className="flex items-center gap-1">
                <button type="button" className="icon-btn" aria-label={`Edit ${row.interface_name}`} title="Edit" onClick={() => setForm({ record: row })}>
                  <span className="material-symbols-outlined text-base">edit</span>
                </button>
                <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.interface_name}`} title="Delete" onClick={() => setDeleting(row)}>
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            ),
          },
        ]
      : []),
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
    </div>
  );
}
