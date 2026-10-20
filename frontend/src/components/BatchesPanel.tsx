import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type { Catalogs, KbBatchRecord, SystemRecord } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileDrop } from "./FileDrop";
import { FrequencyField, frequencyText, selectedFrequencies } from "./FrequencyField";
import { SelectField } from "./SelectField";
import { SortHeader, sortRows, toggleColumnSort, type ColumnSort } from "./SortHeader";
import { PageSlice } from "./TablePager";

const BATCH_TYPE_OPTIONS = [
  { value: "incoming", label: "Incoming" },
  { value: "outgoing", label: "Outgoing" },
];

function UploadBatchesDialog({
  countries,
  systems,
  onUploaded,
  onClose,
}: {
  countries: string[];
  systems: SystemRecord[];
  onUploaded: (batches: KbBatchRecord[]) => void;
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
      const response = await api<{ batches: KbBatchRecord[]; uploaded: number }>("/api/batches/upload", { method: "POST", body });
      onUploaded(response.batches);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      if (err instanceof ApiError) setProblems(err.errors);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label="Upload batches" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4" onSubmit={(e) => void submit(e)}>
        <div>
          <h2 className="font-headline text-xl font-semibold">Upload Batches</h2>
          <p className="text-xs text-muted mt-1">Excel (.xlsx) with columns: BATCH_NAME, BATCH_TYPE, TO_FROM_SYSTEMS, DESCRIPTION, BATCH_FILENAME, FILE_LAYOUT. BATCH_TYPE must be incoming or outgoing. TO_FROM_SYSTEMS is comma-separated system codes.</p>
        </div>
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

function BatchFormDialog({
  batch,
  countries,
  systems,
  onSaved,
  onClose,
}: {
  batch?: KbBatchRecord;
  countries: string[];
  systems: SystemRecord[];
  onSaved: (saved: KbBatchRecord) => void;
  onClose: () => void;
}) {
  const editing = Boolean(batch);
  const [country, setCountry] = useState(batch?.country ?? (countries.includes("SG") ? "SG" : countries[0] ?? "SG"));
  const [system, setSystem] = useState(batch?.system_code ?? systems[0]?.system_code ?? "");
  const [name, setName] = useState(batch?.batch_name ?? "");
  const [batchType, setBatchType] = useState(batch?.batch_type ?? "incoming");
  const [frequency, setFrequency] = useState(selectedFrequencies(batch?.frequency));
  const [frequencyOther, setFrequencyOther] = useState(batch?.frequency_other ?? "");
  const [toFromSystems, setToFromSystems] = useState(batch?.to_from_systems ?? "");
  const [description, setDescription] = useState(batch?.description ?? "");
  const [filename, setFilename] = useState(batch?.batch_filename ?? "");
  const [layout, setLayout] = useState(batch?.file_layout ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing && !system && systems[0]) setSystem(systems[0].system_code);
  }, [systems, system, editing]);

  const systemChoices = useMemo(() => {
    if (editing && batch && !systems.some((item) => item.system_code === batch.system_code)) {
      return [...systems, { system_code: batch.system_code, system_name: batch.system_code } as SystemRecord];
    }
    return systems;
  }, [systems, editing, batch]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        country,
        system_code: system,
        batch_name: name.trim(),
        batch_type: batchType,
        frequency: frequency.join(", "),
        frequency_other: frequency.includes("Other") ? frequencyOther.trim() : "",
        to_from_systems: toFromSystems.trim(),
        description: description.trim(),
        batch_filename: filename.trim(),
        file_layout: layout.trim(),
      };
      const saved = batch
        ? await api<KbBatchRecord>(`/api/batches/${encodeURIComponent(batch.batch_id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<KbBatchRecord>("/api/batches", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save batch");
      setBusy(false);
    }
  }

  const title = editing ? "Edit batch" : "Add batch";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3" onSubmit={(e) => void submit(e)}>
        <h2 className="font-headline text-xl font-semibold">{title}</h2>
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
            <span className="font-label text-[10px] uppercase text-muted">System</span>
            <div className="mt-1">
              <SelectField
                aria-label="System"
                value={system}
                disabled={busy || systemChoices.length === 0}
                className="w-full [&_button]:w-full [&_button]:max-w-none"
                options={
                  systemChoices.length === 0
                    ? [{ value: "", label: "No systems" }]
                    : systemChoices.map((item) => ({ value: item.system_code, label: `${item.system_code} — ${item.system_name}` }))
                }
                onChange={setSystem}
              />
            </div>
          </label>
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Batch name</span>
          <input className="field mt-1" aria-label="Batch name" value={name} required disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Type</span>
          <div className="mt-1">
            <SelectField aria-label="Batch type" value={batchType} disabled={busy} className="w-full [&_button]:w-full [&_button]:max-w-none" options={BATCH_TYPE_OPTIONS} onChange={setBatchType} />
          </div>
          </label>
        <FrequencyField
          selected={frequency}
          other={frequencyOther}
          disabled={busy}
          onChange={(next, other) => {
            setFrequency(next);
            setFrequencyOther(other);
          }}
        />
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">To/From system(s)</span>
          <input
            className="field mt-1"
            aria-label="To/From system(s)"
            value={toFromSystems}
            disabled={busy}
            placeholder="System codes separated by commas, or empty"
            onChange={(e) => setToFromSystems(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <input className="field mt-1" aria-label="Batch description" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Batch filename</span>
          <input className="field mt-1" aria-label="Batch filename" value={filename} disabled={busy} onChange={(e) => setFilename(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">File layout</span>
          <textarea className="field mt-1 min-h-[120px] font-mono text-xs" aria-label="File layout" value={layout} disabled={busy} onChange={(e) => setLayout(e.target.value)} />
        </label>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !system}>
            {editing ? "Save" : "Add batch"}
          </button>
        </div>
      </form>
    </div>
  );
}

function BatchDetailDialog({ batch, onClose }: { batch: KbBatchRecord; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Batch ${batch.batch_name}`} className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-lg border border-hairline bg-panel shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-hairline p-5">
          <div className="min-w-0">
            <div className="font-label text-[11px] uppercase text-muted">
              {batch.country} · {batch.system_code} · {batch.batch_type === "outgoing" ? "Outgoing" : batch.batch_type === "incoming" ? "Incoming" : batch.batch_type}
              {frequencyText(batch.frequency, batch.frequency_other) ? ` · ${frequencyText(batch.frequency, batch.frequency_other)}` : ""}
            </div>
            <h2 className="font-headline text-xl font-semibold mt-0.5">{batch.batch_name}</h2>
            <p className="text-sm text-muted mt-1">{batch.description || "No description."}</p>
            {batch.to_from_systems && <p className="text-sm mt-1">To/From: <span className="font-label text-xs">{batch.to_from_systems}</span></p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div>
            <h3 className="font-label text-[10px] uppercase text-muted mb-2">Batch filename</h3>
            <p className="text-sm bg-inset rounded-lg p-4 border border-hairline font-mono">{batch.batch_filename || "No filename provided."}</p>
          </div>
          <div>
            <h3 className="font-label text-[10px] uppercase text-muted mb-2">File layout</h3>
            <pre className="whitespace-pre-wrap text-sm bg-inset rounded-lg p-4 border border-hairline min-h-[12rem]">{batch.file_layout || "No layout provided."}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

type Group = { key: string; country: string; system: string; batches: KbBatchRecord[] };

export function BatchesPanel() {
  const auth = useOptionalAuth();
  const canEdit = auth?.user?.role_name !== "Viewer";
  const [searchParams] = useSearchParams();
  const [batches, setBatches] = useState<KbBatchRecord[]>([]);
  const [countries, setCountries] = useState<string[]>(["SG", "MY", "TH", "VN", "ID"]);
  const [systems, setSystems] = useState<SystemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState(() => searchParams.get("country") ?? "");
  const [systemFilter, setSystemFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<{ batch?: KbBatchRecord } | null>(null);
  const [inspecting, setInspecting] = useState<KbBatchRecord | null>(null);
  const [deleting, setDeleting] = useState<KbBatchRecord | null>(null);
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
    api<KbBatchRecord[]>("/api/batches")
      .then((data) => {
        setBatches(data);
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load batches"))
      .finally(() => setLoading(false));
  }, []);

  async function remove() {
    if (!deleting) return;
    await api(`/api/batches/${encodeURIComponent(deleting.batch_id)}`, { method: "DELETE" });
    const id = deleting.batch_id;
    setBatches((current) => current.filter((item) => item.batch_id !== id));
    setDeleting(null);
  }

  const systemsForAdd = useMemo(() => systems.filter((item) => item.has_batch), [systems]);

  const systemsForFilter = useMemo(() => {
    const present = new Set(
      batches
        .filter((item) => !countryFilter || item.country === countryFilter)
        .map((item) => item.system_code),
    );
    const known = systems.filter((item) => present.has(item.system_code));
    const knownCodes = new Set(known.map((item) => item.system_code));
    const extras = [...present]
      .filter((code) => !knownCodes.has(code))
      .sort()
      .map((system_code) => ({ system_code, system_name: system_code }));
    return [...known.map((item) => ({ system_code: item.system_code, system_name: item.system_name })), ...extras];
  }, [batches, systems, countryFilter]);

  useEffect(() => {
    if (!systemsForFilter.some((item) => item.system_code === systemFilter)) {
      setSystemFilter(systemsForFilter[0]?.system_code ?? "");
    }
  }, [systemsForFilter, systemFilter]);

  const groups = useMemo<Group[]>(() => {
    const needle = search.trim().toLowerCase();
    const map = new Map<string, Group>();
    for (const row of batches) {
      if (countryFilter && row.country !== countryFilter) continue;
      if (row.system_code !== systemFilter) continue;
      if (
        needle &&
        !`${row.batch_name} ${row.batch_type} ${frequencyText(row.frequency, row.frequency_other)} ${row.to_from_systems} ${row.description} ${row.batch_filename} ${row.file_layout} ${row.country} ${row.system_code}`
          .toLowerCase()
          .includes(needle)
      ) {
        continue;
      }
      const key = `${row.country}|${row.system_code}`;
      let group = map.get(key);
      if (!group) {
        group = { key, country: row.country, system: row.system_code, batches: [] };
        map.set(key, group);
      }
      group.batches.push(row);
    }
    return Array.from(map.values());
  }, [batches, search, countryFilter, systemFilter]);

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-headline text-2xl font-semibold">Batches</h1>
          <p className="text-muted mt-0.5">Batches organized by country and system. Click a batch to view its filename and layout.</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button type="button" className="btn" onClick={() => setForm({})}>
              <span className="material-symbols-outlined text-base">add</span>
              Add batch
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
          aria-label="Search Batches"
          placeholder="Search batches"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {groups.length === 0 ? (
        <div className="bg-panel border border-hairline rounded-lg p-6 text-muted">{loading ? "Loading…" : "No batches found."}</div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="bg-panel border border-hairline rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-hairline bg-inset px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span>{group.country}</span>
                  <span className="text-muted">/</span>
                  <span className="font-label text-xs text-accent">{group.system}</span>
                </div>
                <span className="font-label text-[11px] text-muted">
                  {group.batches.length} {group.batches.length === 1 ? "batch" : "batches"}
                </span>
              </div>
              <PageSlice
                rows={sortRows(group.batches, sort, (row) => {
                  if (sort?.key === "batch_type") return row.batch_type;
                  if (sort?.key === "frequency") return frequencyText(row.frequency, row.frequency_other);
                  return row.batch_name;
                })}
                resetKey={`${search}|${countryFilter}|${systemFilter}|${sort?.key ?? ""}|${sort?.dir ?? ""}`}
              >
                {(visible, pager) => (
                  <>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-hairline font-label text-[10px] uppercase text-muted">
                    <th className="py-2.5 px-3 w-48" aria-sort={sort?.key === "batch_name" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <SortHeader label="Batch Name" active={sort?.key === "batch_name" ? sort.dir : null} onClick={() => setSort((current) => toggleColumnSort(current, "batch_name"))} />
                    </th>
                    <th className="py-2.5 px-3 w-24" aria-sort={sort?.key === "batch_type" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <SortHeader label="Type" active={sort?.key === "batch_type" ? sort.dir : null} onClick={() => setSort((current) => toggleColumnSort(current, "batch_type"))} />
                    </th>
                    <th className="py-2.5 px-3 w-40" aria-sort={sort?.key === "frequency" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <SortHeader label="Frequency" active={sort?.key === "frequency" ? sort.dir : null} onClick={() => setSort((current) => toggleColumnSort(current, "frequency"))} />
                    </th>
                    <th className="py-2.5 px-3 w-40">To/From</th>
                    <th className="py-2.5 px-3">Description</th>
                    {canEdit && <th className="py-2.5 px-3 w-24" />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.batch_id} className="border-b border-hairline last:border-b-0 hover:bg-inset/50">
                      <td className="py-2.5 px-3 font-label text-xs font-medium">
                        <button type="button" className="text-left text-accent hover:underline" onClick={() => setInspecting(row)}>
                          {row.batch_name}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-muted cursor-pointer" onClick={() => setInspecting(row)}>
                        {row.batch_type === "outgoing" ? "Outgoing" : row.batch_type === "incoming" ? "Incoming" : row.batch_type}
                      </td>
                      <td className="py-2.5 px-3 text-muted cursor-pointer" onClick={() => setInspecting(row)}>
                        {frequencyText(row.frequency, row.frequency_other) || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-muted cursor-pointer font-label text-xs" onClick={() => setInspecting(row)}>
                        {row.to_from_systems || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-muted cursor-pointer" onClick={() => setInspecting(row)}>
                        {row.description || "—"}
                      </td>
                      {canEdit && (
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1 justify-end">
                            <button type="button" className="icon-btn" aria-label={`Edit ${row.batch_name}`} title="Edit" onClick={() => setForm({ batch: row })}>
                              <span className="material-symbols-outlined text-base">edit</span>
                            </button>
                            <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.batch_name}`} title="Delete" onClick={() => setDeleting(row)}>
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
        <UploadBatchesDialog
          countries={countries}
          systems={systemsForAdd}
          onClose={() => setUploading(false)}
          onUploaded={(data) => {
            setBatches(data);
            setUploading(false);
            setNotice("Batches uploaded.");
          }}
        />
      )}
      {form && (
        <BatchFormDialog
          batch={form.batch}
          countries={countries}
          systems={systemsForAdd}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            setBatches((current) => {
              const exists = current.some((item) => item.batch_id === saved.batch_id);
              return exists ? current.map((item) => (item.batch_id === saved.batch_id ? saved : item)) : [...current, saved];
            });
            setForm(null);
            setNotice(form.batch ? "Batch updated." : "Batch added.");
          }}
        />
      )}
      {inspecting && <BatchDetailDialog batch={inspecting} onClose={() => setInspecting(null)} />}
      {deleting && (
        <ConfirmDialog title="Delete batch" message={`Delete batch ${deleting.batch_name}? This cannot be undone.`} onConfirm={remove} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
