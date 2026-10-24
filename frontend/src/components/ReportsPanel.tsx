import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, authHeaders, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type { Catalogs, KbReportRecord, ReportSample, SystemRecord } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FrequencyField, REPORT_FREQUENCY_CHOICES, frequencyText, selectedFrequencies } from "./FrequencyField";
import { FileDrop } from "./FileDrop";
import { appliesToCountry, countryLabel } from "../countries";
import { renderMarkdown } from "../markdown";
import { ProcessingRulesEditor } from "./ProcessingRulesEditor";
import { SelectField } from "./SelectField";
import { SortHeader, sortRows, toggleColumnSort, type ColumnSort } from "./SortHeader";
import { PageSlice } from "./TablePager";
import { can } from "../permissions";

function SamplePreviewDialog({
  filename,
  mediaType,
  reportId,
  file,
  onClose,
}: {
  filename: string;
  mediaType: string;
  reportId?: string;
  file?: File | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const plain = mediaType.startsWith("text/");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setUrl("");
    setText("");
    setError("");
    if (file) {
      if (plain) {
        file.text().then((value) => {
          if (!cancelled) setText(value);
        });
        return () => {
          cancelled = true;
        };
      }
      objectUrl = URL.createObjectURL(file);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (!reportId) return undefined;
    fetch(`/api/reports/${encodeURIComponent(reportId)}/sample`, { headers: authHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the sample");
        const blob = await response.blob();
        if (cancelled) return;
        if (plain) {
          setText(await blob.text());
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the sample");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, plain, reportId]);

  const image = mediaType.startsWith("image/");
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Preview ${filename}`} className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-hairline bg-panel shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <h3 className="font-headline text-lg font-semibold m-0 truncate">{filename}</h3>
          <button type="button" className="icon-btn" aria-label="Close preview" onClick={onClose}>
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {error && <p className="text-alert text-sm">{error}</p>}
          {!url && !text && !error && <p className="text-muted text-sm">Loading…</p>}
          {plain && text && <pre className="whitespace-pre-wrap text-sm bg-inset rounded border border-hairline p-4">{text}</pre>}
          {url && image && <img src={url} alt={filename} className="max-w-full rounded border border-hairline" />}
          {url && !image && !plain && <iframe title={filename} src={url} className="h-[70vh] w-full rounded border border-hairline bg-white" />}
        </div>
      </div>
    </div>
  );
}

function UploadReportsDialog({
  countries,
  systems,
  onUploaded,
  onClose,
}: {
  countries: string[];
  systems: SystemRecord[];
  onUploaded: (reports: KbReportRecord[]) => void;
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
      const response = await api<{ reports: KbReportRecord[]; uploaded: number }>("/api/reports/upload", { method: "POST", body });
      onUploaded(response.reports);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      if (err instanceof ApiError) setProblems(err.errors);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label="Upload reports" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4" onSubmit={(e) => void submit(e)}>
        <div>
          <h2 className="font-headline text-xl font-semibold">Upload Reports</h2>
          <p className="text-xs text-muted mt-1">
            Excel (.xlsx) with columns: REPORT_ID, REPORT_NAME, REPORT_DESCRIPTION, FREQUENCY, REPORT_LAYOUT. FREQUENCY is comma-separated: Adhoc, Daily, Weekly, Monthly, Quarterly, or Other. Write Other as Other: note. Leave FREQUENCY empty when it does not apply.
          </p>
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

function ReportFormDialog({
  report,
  countries,
  systems,
  onSaved,
  onChanged,
  onClose,
}: {
  report?: KbReportRecord;
  countries: string[];
  systems: SystemRecord[];
  onSaved: (saved: KbReportRecord) => void;
  onChanged?: (saved: KbReportRecord) => void;
  onClose: () => void;
}) {
  const editing = Boolean(report);
  const [country, setCountry] = useState(report?.country ?? (countries.includes("SG") ? "SG" : countries[0] ?? "SG"));
  const [system, setSystem] = useState(report?.system_code ?? systems[0]?.system_code ?? "");
  const [code, setCode] = useState(report?.report_code ?? "");
  const [name, setName] = useState(report?.report_name ?? "");
  const [frequency, setFrequency] = useState(selectedFrequencies(report?.frequency, REPORT_FREQUENCY_CHOICES));
  const [frequencyOther, setFrequencyOther] = useState(report?.frequency_other ?? "");
  const [description, setDescription] = useState(report?.description ?? "");
  const [layout, setLayout] = useState(report?.layout ?? "");
  const [sample, setSample] = useState<ReportSample | null>(report?.sample ?? null);
  const [pending, setPending] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing && !system && systems[0]) setSystem(systems[0].system_code);
  }, [systems, system, editing]);

  const systemChoices = useMemo(() => {
    if (editing && report && !systems.some((item) => item.system_code === report.system_code)) {
      return [...systems, { system_code: report.system_code, system_name: report.system_code } as SystemRecord];
    }
    return systems;
  }, [systems, editing, report]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        country,
        system_code: system,
        report_code: code.trim(),
        report_name: name.trim(),
        frequency: frequency.join(", "),
        frequency_other: frequency.includes("Other") ? frequencyOther.trim() : "",
        description: description.trim(),
        layout: layout.trim(),
      };
      let saved = report
        ? await api<KbReportRecord>(`/api/reports/${encodeURIComponent(report.report_id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<KbReportRecord>("/api/reports", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      if (!report && pending) {
        const body = new FormData();
        body.append("file", pending);
        saved = await api<KbReportRecord>(`/api/reports/${encodeURIComponent(saved.report_id)}/sample`, { method: "POST", body });
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save report");
      setBusy(false);
    }
  }

  async function uploadSample(file: File) {
    if (!report) {
      setPending(file);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const saved = await api<KbReportRecord>(`/api/reports/${encodeURIComponent(report.report_id)}/sample`, { method: "POST", body });
      setSample(saved.sample ?? null);
      onChanged?.(saved);
      setBusy(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload the sample");
      setBusy(false);
    }
  }

  async function removeSample() {
    if (!report) {
      setPending(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api<KbReportRecord>(`/api/reports/${encodeURIComponent(report.report_id)}/sample`, { method: "DELETE" });
      setSample(saved.sample ?? null);
      onChanged?.(saved);
      setBusy(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the sample");
      setBusy(false);
    }
  }

  const sampleName = pending?.name || sample?.filename || "";
  const sampleType = pending?.type || sample?.media_type || "";
  const title = editing ? "Edit report" : "Add report";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3" onSubmit={(e) => void submit(e)}>
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
          <span className="font-label text-[10px] uppercase text-muted">Report ID</span>
          <input className="field mt-1" aria-label="Report ID" value={code} required maxLength={50} disabled={busy} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Report name</span>
          <input className="field mt-1" aria-label="Report name" value={name} required disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <FrequencyField
          choices={REPORT_FREQUENCY_CHOICES}
          selected={frequency}
          other={frequencyOther}
          disabled={busy}
          onChange={(next, other) => {
            setFrequency(next);
            setFrequencyOther(other);
          }}
        />
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[70px]" aria-label="Report description" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="block">
          <span className="font-label text-[10px] uppercase text-muted">Layout</span>
          <div className="mt-1">
            <ProcessingRulesEditor value={layout} onChange={setLayout} readOnly={busy} label="Report layout" toolbarLabel="Report layout formatting" />
          </div>
        </div>
        <div className="block space-y-2">
          <span className="font-label text-[10px] uppercase text-muted">Report sample</span>
          {sampleName ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm min-w-0 truncate">{sampleName}</span>
              <button type="button" className="btn" disabled={busy} onClick={() => setPreviewing(true)}>
                Preview
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void removeSample()}>
                Delete
              </button>
            </div>
          ) : (
            <FileDrop accept=".pdf,.txt,.png,.jpg,.jpeg,.gif,.webp" ariaLabel="Upload report sample" disabled={busy} buttonLabel="Upload" idleLabel="PDF, text, or image" onFile={(file) => void uploadSample(file)} />
          )}
        </div>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !code.trim() || !name.trim() || !system}>
            {editing ? "Save" : "Add report"}
          </button>
        </div>
      </form>
      {previewing && sampleName && (
        <SamplePreviewDialog filename={sampleName} mediaType={sampleType} reportId={pending ? undefined : report?.report_id} file={pending} onClose={() => setPreviewing(false)} />
      )}
    </div>
  );
}

export function ReportLayoutDialog({ report, onClose, layerClass = "z-50" }: { report: KbReportRecord; onClose: () => void; layerClass?: string }) {
  const [previewing, setPreviewing] = useState(false);
  return (
    <div className={`fixed inset-0 ${layerClass} flex items-center justify-center bg-black/50 p-4`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Report ${report.report_name}`} className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-lg border border-hairline bg-panel shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-hairline p-5">
          <div className="min-w-0">
            <div className="font-label text-[11px] uppercase text-muted">
              {report.country} · {report.system_code}
              {report.report_code ? ` · ${report.report_code}` : ""}
            </div>
            <h2 className="font-headline text-xl font-semibold mt-0.5">{report.report_name}</h2>
            {frequencyText(report.frequency, report.frequency_other, REPORT_FREQUENCY_CHOICES) && (
              <p className="text-sm mt-1">Frequency: {frequencyText(report.frequency, report.frequency_other, REPORT_FREQUENCY_CHOICES)}</p>
            )}
            <p className="text-sm text-muted mt-1">{report.description || "No description."}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div>
            <h3 className="font-label text-[10px] uppercase text-muted mb-2">Layout</h3>
            {report.layout.trim() ? (
              <div className="md-preview rounded-lg border border-hairline bg-inset p-4" aria-label="Report layout" dangerouslySetInnerHTML={{ __html: renderMarkdown(report.layout) }} />
            ) : (
              <p className="text-sm text-muted">No layout provided.</p>
            )}
          </div>
          <div>
            <h3 className="font-label text-[10px] uppercase text-muted mb-2">Report sample</h3>
            {report.sample ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{report.sample.filename}</span>
                <button type="button" className="btn" onClick={() => setPreviewing(true)}>
                  Preview
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted">No sample provided.</p>
            )}
          </div>
        </div>
      </div>
      {previewing && report.sample && (
        <SamplePreviewDialog filename={report.sample.filename} mediaType={report.sample.media_type} reportId={report.report_id} onClose={() => setPreviewing(false)} />
      )}
    </div>
  );
}

export function ReportDetailsDialog({ reportId, onClose, layerClass = "z-50" }: { reportId: string; onClose: () => void; layerClass?: string }) {
  const [report, setReport] = useState<KbReportRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<KbReportRecord>(`/api/reports/${encodeURIComponent(reportId)}`)
      .then(setReport)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load report"));
  }, [reportId]);

  if (!report) {
    return (
      <div className={`fixed inset-0 ${layerClass} flex items-center justify-center bg-black/50 p-4`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" aria-label="Report details" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl">
          <p className={error ? "text-alert text-sm" : "text-muted"}>{error || "Loading…"}</p>
          <div className="flex justify-end pt-3">
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }
  return <ReportLayoutDialog report={report} onClose={onClose} layerClass={layerClass} />;
}

type Group = { key: string; country: string; system: string; reports: KbReportRecord[] };

export function ReportsPanel() {
  const auth = useOptionalAuth();
  // Without a signed-in user (component previews) editing stays on, as before.
  const canEdit = !auth?.user || can(auth.user, "knowledge", "write");
  const [searchParams] = useSearchParams();
  const [reports, setReports] = useState<KbReportRecord[]>([]);
  const [countries, setCountries] = useState<string[]>(["SG", "MY", "TH", "VN", "ID"]);
  const [systems, setSystems] = useState<SystemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState(() => searchParams.get("country") || "SG");
  const [systemFilter, setSystemFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<{ report?: KbReportRecord } | null>(null);
  const [inspecting, setInspecting] = useState<KbReportRecord | null>(null);
  const [deleting, setDeleting] = useState<KbReportRecord | null>(null);
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
    api<KbReportRecord[]>("/api/reports")
      .then((data) => {
        setReports(data);
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load reports"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setCountryFilter((current) => (countries.includes(current) ? current : countries.includes("SG") ? "SG" : countries[0] ?? "SG"));
  }, [countries]);

  async function remove() {
    if (!deleting) return;
    await api(`/api/reports/${encodeURIComponent(deleting.report_id)}`, { method: "DELETE" });
    const id = deleting.report_id;
    setReports((current) => current.filter((item) => item.report_id !== id));
    setDeleting(null);
  }

  const systemsForAdd = useMemo(() => systems.filter((item) => item.has_report), [systems]);

  const systemsForFilter = useMemo(() => {
    const present = new Set(
      reports
        .filter((item) => appliesToCountry(item.country, countryFilter))
        .map((item) => item.system_code),
    );
    const known = systems.filter((item) => present.has(item.system_code));
    const knownCodes = new Set(known.map((item) => item.system_code));
    const extras = [...present]
      .filter((code) => !knownCodes.has(code))
      .sort()
      .map((system_code) => ({ system_code, system_name: system_code }));
    return [...known.map((item) => ({ system_code: item.system_code, system_name: item.system_name })), ...extras];
  }, [reports, systems, countryFilter]);

  useEffect(() => {
    if (!systemsForFilter.some((item) => item.system_code === systemFilter)) {
      setSystemFilter(systemsForFilter[0]?.system_code ?? "");
    }
  }, [systemsForFilter, systemFilter]);

  const groups = useMemo<Group[]>(() => {
    const needle = search.trim().toLowerCase();
    const map = new Map<string, Group>();
    for (const row of reports) {
      if (!appliesToCountry(row.country, countryFilter)) continue;
      if (row.system_code !== systemFilter) continue;
      if (
        needle &&
        !`${row.report_code} ${row.report_name} ${frequencyText(row.frequency, row.frequency_other, REPORT_FREQUENCY_CHOICES)} ${row.description} ${row.layout} ${row.sample?.filename ?? ""} ${row.country} ${row.system_code}`
          .toLowerCase()
          .includes(needle)
      ) {
        continue;
      }
      const key = `${row.country}|${row.system_code}`;
      let group = map.get(key);
      if (!group) {
        group = { key, country: countryLabel(row.country), system: row.system_code, reports: [] };
        map.set(key, group);
      }
      group.reports.push(row);
    }
    return Array.from(map.values());
  }, [reports, search, countryFilter, systemFilter]);

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-headline text-2xl font-semibold">Reports</h1>
          <p className="text-muted mt-0.5">Reports organized by country and system. Click a report to view its layout.</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button type="button" className="btn" onClick={() => setForm({})}>
              <span className="material-symbols-outlined text-base">add</span>
              Add report
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
          aria-label="Search Reports"
          placeholder="Search reports"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {groups.length === 0 ? (
        <div className="bg-panel border border-hairline rounded-lg p-6 text-muted">{loading ? "Loading…" : "No reports found."}</div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="bg-panel border border-hairline rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-hairline bg-inset px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="font-label text-xs text-accent">{group.system}</span>
                </div>
                <span className="font-label text-[11px] text-muted">
                  {group.reports.length} {group.reports.length === 1 ? "report" : "reports"}
                </span>
              </div>
              <PageSlice
                rows={sortRows(group.reports, sort, (row) => {
                  if (sort?.key === "frequency") return frequencyText(row.frequency, row.frequency_other, REPORT_FREQUENCY_CHOICES);
                  if (sort?.key === "report_code") return row.report_code;
                  return row.report_name;
                })}
                resetKey={`${search}|${countryFilter}|${systemFilter}|${sort?.key ?? ""}|${sort?.dir ?? ""}`}
              >
                {(visible, pager) => (
                  <>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-hairline font-label text-[10px] uppercase text-muted">
                    <th className="py-2.5 px-3 w-36" aria-sort={sort?.key === "report_code" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <SortHeader label="Report ID" active={sort?.key === "report_code" ? sort.dir : null} onClick={() => setSort((current) => toggleColumnSort(current, "report_code"))} />
                    </th>
                    <th className="py-2.5 px-3 w-72" aria-sort={sort?.key === "report_name" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <SortHeader label="Report Name" active={sort?.key === "report_name" ? sort.dir : null} onClick={() => setSort((current) => toggleColumnSort(current, "report_name"))} />
                    </th>
                    <th className="py-2.5 px-3 w-40" aria-sort={sort?.key === "frequency" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <SortHeader label="Frequency" active={sort?.key === "frequency" ? sort.dir : null} onClick={() => setSort((current) => toggleColumnSort(current, "frequency"))} />
                    </th>
                    <th className="py-2.5 px-3">Description</th>
                    {canEdit && <th className="py-2.5 px-3 w-24" />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.report_id} className="border-b border-hairline last:border-b-0 hover:bg-inset/50">
                      <td className="py-2.5 px-3 font-label text-xs font-medium whitespace-nowrap cursor-pointer" onClick={() => setInspecting(row)}>
                        {row.report_code || "—"}
                      </td>
                      <td className="py-2.5 px-3 font-label text-xs font-medium">
                        <button type="button" className="text-left text-accent hover:underline" onClick={() => setInspecting(row)}>
                          {row.report_name}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-muted cursor-pointer" onClick={() => setInspecting(row)}>
                        {frequencyText(row.frequency, row.frequency_other, REPORT_FREQUENCY_CHOICES) || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-muted cursor-pointer" onClick={() => setInspecting(row)}>
                        {row.description || "—"}
                      </td>
                      {canEdit && (
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1 justify-end">
                            <button type="button" className="icon-btn" aria-label={`Edit ${row.report_name}`} title="Edit" onClick={() => setForm({ report: row })}>
                              <span className="material-symbols-outlined text-base">edit</span>
                            </button>
                            <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.report_name}`} title="Delete" onClick={() => setDeleting(row)}>
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
        <UploadReportsDialog
          countries={countries}
          systems={systemsForAdd}
          onClose={() => setUploading(false)}
          onUploaded={(data) => {
            setReports(data);
            setUploading(false);
            setNotice("Reports uploaded.");
          }}
        />
      )}
      {form && (
        <ReportFormDialog
          report={form.report}
          countries={countries}
          systems={systemsForAdd}
          onClose={() => setForm(null)}
          onChanged={(saved) => setReports((current) => current.map((item) => (item.report_id === saved.report_id ? saved : item)))}
          onSaved={(saved) => {
            setReports((current) => {
              const exists = current.some((item) => item.report_id === saved.report_id);
              return exists ? current.map((item) => (item.report_id === saved.report_id ? saved : item)) : [...current, saved];
            });
            setForm(null);
            setNotice(form.report ? "Report updated." : "Report added.");
          }}
        />
      )}
      {inspecting && <ReportLayoutDialog report={inspecting} onClose={() => setInspecting(null)} />}
      {deleting && (
        <ConfirmDialog title="Delete report" message={`Delete report ${deleting.report_name}? This cannot be undone.`} onConfirm={remove} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
