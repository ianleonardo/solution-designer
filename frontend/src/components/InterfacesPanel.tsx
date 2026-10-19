import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type { Catalogs, InterfaceRecord, SystemRecord } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { type Column, DataTable } from "./DataTable";
import { KB_PAGE_SIZES } from "./TablePager";
import { SelectField } from "./SelectField";

export const INTERFACES_PAGE_SIZE = 25;
export const PROTOCOLS = ["API", "MQ", "Kafka", "gRPC", "FTP", "SMTP", "SMPP"];

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
  const [country, setCountry] = useState(record?.country ?? countries[0] ?? "SG");
  const [name, setName] = useState(record?.interface_name ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [protocol, setProtocol] = useState(record?.protocol ?? "API");
  const [source, setSource] = useState(record?.source ?? "");
  const [destination, setDestination] = useState(record?.destination ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload = {
      country,
      interface_name: name.trim(),
      description: description.trim(),
      protocol,
      source,
      destination,
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
        className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3"
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="font-headline text-xl font-semibold">{title}</h2>
        <p className="text-xs text-muted">Channel: {channel}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Country</span>
            <div className="mt-1">
              <SelectField
                aria-label="Country"
                value={country}
                disabled={busy}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={countries.map((item) => ({ value: item, label: item }))}
                onChange={setCountry}
              />
            </div>
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
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Interface name</span>
          <input className="field mt-1" aria-label="Interface name" value={name} required disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[70px]" aria-label="Description" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Source</span>
            <div className="mt-1">
              <SelectField
                aria-label="Source"
                value={source}
                disabled={busy}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={[
                  { value: "", label: "Select system" },
                  ...systems.map((item) => ({ value: item.system_code, label: `${item.system_code} — ${item.system_name}` })),
                ]}
                onChange={setSource}
              />
            </div>
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">Destination</span>
            <div className="mt-1">
              <SelectField
                aria-label="Destination"
                value={destination}
                disabled={busy}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={[
                  { value: "", label: "Select system" },
                  ...systems.map((item) => ({ value: item.system_code, label: `${item.system_code} — ${item.system_name}` })),
                ]}
                onChange={setDestination}
              />
            </div>
          </label>
        </div>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !source || !destination}>
            {editing ? "Save" : "Add"}
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
  const [problems, setProblems] = useState<RowError[]>([]);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<{ record?: InterfaceRecord } | null>(null);
  const [deleting, setDeleting] = useState<InterfaceRecord | null>(null);
  const [countryFilter, setCountryFilter] = useState(() => params.get("country") ?? "");

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
    let current = true;
    setLoading(true);
    setRows([]);
    setError("");
    setProblems([]);
    setNotice("");
    api<InterfaceRecord[]>(`/api/interfaces/${channel}`)
      .then((data) => current && setRows(data))
      .catch((err: unknown) => current && setError(err instanceof ApiError ? err.message : "Could not load interfaces"))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [channel]);

  async function upload(file: File) {
    setUploading(true);
    setError("");
    setProblems([]);
    setNotice("");
    try {
      const body = new FormData();
      body.append("file", file);
      const saved = await api<InterfaceRecord[]>(`/api/interfaces/${channel}/upload`, { method: "POST", body });
      setRows(saved);
      setNotice(`${channel} now has ${saved.length} interface${saved.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      if (err instanceof ApiError) setProblems(err.errors);
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    await api(`/api/interfaces/${encodeURIComponent(channel)}/${encodeURIComponent(deleting.interface_id)}`, { method: "DELETE" });
    const id = deleting.interface_id;
    setRows((current) => current.filter((row) => row.interface_id !== id));
    setDeleting(null);
  }

  const filteredRows = useMemo(
    () => (countryFilter ? rows.filter((row) => row.country === countryFilter) : rows),
    [rows, countryFilter],
  );

  const countryOptions = useMemo(() => {
    const list = [...countries];
    if (countryFilter && !list.includes(countryFilter)) list.push(countryFilter);
    return list;
  }, [countries, countryFilter]);

  const columns: Column<InterfaceRecord>[] = [
    { key: "country", header: "Country", sortValue: (row) => row.country, className: "whitespace-nowrap", render: (row) => row.country },
    { key: "name", header: "Interface Name", sortValue: (row) => row.interface_name, className: "font-medium", render: (row) => row.interface_name },
    { key: "description", header: "Description", sortValue: (row) => row.description, className: "text-muted max-w-md", render: (row) => <span className="line-clamp-2">{row.description || "—"}</span> },
    { key: "protocol", header: "Protocol", sortValue: (row) => row.protocol, className: "whitespace-nowrap", render: (row) => row.protocol },
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
          Manage interfaces per channel. Add them manually or upload an Excel (.xlsx) with columns Country, Interface name, Description, Protocol, Source, Destination. A valid upload replaces that channel&apos;s interfaces.
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
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          aria-label="Filter by country"
          value={countryFilter}
          options={[{ value: "", label: "All countries" }, ...countryOptions.map((item) => ({ value: item, label: item }))]}
          onChange={(next) => {
            setCountryFilter(next);
            const nextParams = new URLSearchParams(params);
            if (next) nextParams.set("country", next);
            else nextParams.delete("country");
            setParams(nextParams);
          }}
        />
      </div>
      {error && <p className="text-alert">{error}</p>}
      {problems.length > 0 && (
        <ul className="max-h-56 overflow-auto rounded-lg border border-hairline p-3 text-alert space-y-1" aria-label="Upload problems">
          {problems.map((problem, index) => (
            <li key={index}>
              Row {problem.row}, {problem.field}: {problem.message}
            </li>
          ))}
        </ul>
      )}
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
        searchText={(row) => `${row.country} ${row.interface_name} ${row.description} ${row.protocol} ${row.source} ${row.destination}`}
        searchLabel={`Search ${channel} interfaces`}
        searchPlaceholder={`Search ${channel} interfaces`}
        toolbar={
          canEdit ? (
            <div className="flex items-center gap-2">
              <button type="button" className="btn" onClick={() => setForm({})}>
                <span className="material-symbols-outlined text-base">add</span>
                Add
              </button>
              <label className={`btn btn-primary cursor-pointer ${uploading ? "opacity-50" : ""}`}>
                <span className="material-symbols-outlined text-base">upload</span>
                {uploading ? "Uploading…" : "Upload Excel"}
                <input
                  className="hidden"
                  type="file"
                  aria-label={`Upload ${channel} Excel`}
                  accept=".xlsx"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                  }}
                />
              </label>
            </div>
          ) : undefined
        }
      />
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
