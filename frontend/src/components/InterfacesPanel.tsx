import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type RowError } from "../api";
import type { InterfaceChannel, InterfaceRecord } from "../types";
import { type Column, DataTable } from "./DataTable";

export const INTERFACES_PAGE_SIZE = 50;
export const CHANNELS: InterfaceChannel[] = ["SPL", "DGE", "PIB", "WSM", "EAI"];

const COLUMNS: Column<InterfaceRecord>[] = [
  { key: "country", header: "Country", sortValue: (row) => row.country, className: "whitespace-nowrap", render: (row) => row.country },
  { key: "name", header: "Interface Name", sortValue: (row) => row.interface_name, className: "font-medium", render: (row) => row.interface_name },
  { key: "description", header: "Description", sortValue: (row) => row.description, className: "text-muted max-w-md", render: (row) => <span className="line-clamp-2">{row.description || "—"}</span> },
  { key: "protocol", header: "Protocol", sortValue: (row) => row.protocol, className: "whitespace-nowrap", render: (row) => row.protocol },
  { key: "source", header: "Source", sortValue: (row) => row.source, className: "font-label text-xs whitespace-nowrap", render: (row) => row.source },
  { key: "destination", header: "Destination", sortValue: (row) => row.destination, className: "font-label text-xs whitespace-nowrap", render: (row) => row.destination },
];

export function InterfacesPanel() {
  const [params, setParams] = useSearchParams();
  const requested = (params.get("tab") ?? "").toUpperCase();
  const channel = (CHANNELS as string[]).includes(requested) ? (requested as InterfaceChannel) : CHANNELS[0];
  const [rows, setRows] = useState<InterfaceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<RowError[]>([]);
  const [notice, setNotice] = useState("");

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

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">Interfaces</h1>
        <p className="text-muted mt-0.5">
          Upload an Excel file (.xlsx) per channel with the columns Country, Interface name, Description, Protocol, Source, Destination. A valid upload replaces that channel&apos;s interfaces.
        </p>
      </div>
      <div role="tablist" aria-label="Interface channels" className="flex gap-1 border-b border-hairline">
        {CHANNELS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === channel}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${item === channel ? "border-[var(--accent,currentColor)] font-semibold" : "border-transparent text-muted hover:text-inherit"}`}
            onClick={() => setParams({ tab: item })}
          >
            {item}
          </button>
        ))}
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
        key={channel}
        rows={rows}
        columns={COLUMNS}
        rowKey={(row) => row.interface_id}
        pageSize={INTERFACES_PAGE_SIZE}
        emptyLabel={loading ? "Loading…" : `No ${channel} interfaces found.`}
        searchText={(row) => `${row.country} ${row.interface_name} ${row.description} ${row.protocol} ${row.source} ${row.destination}`}
        searchLabel={`Search ${channel} interfaces`}
        searchPlaceholder={`Search ${channel} interfaces`}
        toolbar={
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
        }
      />
    </div>
  );
}
