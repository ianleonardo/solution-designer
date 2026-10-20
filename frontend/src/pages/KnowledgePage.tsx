import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useOptionalAuth } from "../auth";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FileDrop } from "../components/FileDrop";
import { type Column, DataTable } from "../components/DataTable";
import { KB_PAGE_SIZES } from "../components/TablePager";
import { GuidelinesPanel } from "../components/GuidelinesPanel";
import { InterfacesPanel } from "../components/InterfacesPanel";
import { SystemsPanel } from "../components/SystemsPanel";
import { BatchesPanel } from "../components/BatchesPanel";
import { BitbucketReposPanel } from "../components/BitbucketReposPanel";
import { CapabilitiesPanel } from "../components/CapabilitiesPanel";
import { ReportsPanel } from "../components/ReportsPanel";
import { SelectField } from "../components/SelectField";
import { TablesPanel } from "../components/TablesPanel";
import { KNOWLEDGE_KINDS } from "../knowledge";
import type { Catalogs, RagItem } from "../types";

export const KNOWLEDGE_PAGE_SIZE = 25;

function details(item: RagItem) {
  return Object.entries(item.parsed ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

function itemCountry(item: RagItem): string {
  const parsed = item.parsed ?? {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key.toLowerCase() === "country" && String(value).trim()) return String(value).trim();
  }
  return "Unspecified";
}

export function KnowledgePage() {
  const { kind: slug } = useParams();
  if (slug === "table-definitions") return <Navigate to="/knowledge/tables" replace />;
  // Structured catalogues have their own screens. A generic inventory upload would bypass their validation.
  if (slug === "guidelines") return <GuidelinesPanel />;
  if (slug === "systems") return <SystemsPanel />;
  if (slug === "interfaces") return <InterfacesPanel />;
  if (slug === "tables") return <TablesPanel />;
  if (slug === "batches") return <BatchesPanel />;
  if (slug === "reports") return <ReportsPanel />;
  if (slug === "capabilities") return <CapabilitiesPanel />;
  if (slug === "bitbucket") return <BitbucketReposPanel />;
  return <InventoryPage />;
}

function InventoryPage() {
  const auth = useOptionalAuth();
  const canEdit = auth?.user?.role_name !== "Viewer";
  const { kind: slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = KNOWLEDGE_KINDS.find((item) => item.slug === slug);
  const [items, setItems] = useState<RagItem[]>([]);
  const [countries, setCountries] = useState<string[]>(["SG", "MY", "TH", "VN", "ID"]);
  const [deleting, setDeleting] = useState<RagItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [countryFilter, setCountryFilter] = useState(() => searchParams.get("country") ?? "");

  useEffect(() => {
    api<Catalogs>("/api/catalogs")
      .then((data) => {
        if (data.countries?.length) setCountries(data.countries);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setError("");
    api<RagItem[]>("/api/rag")
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load the knowledge base"));
  }, [slug]);

  useEffect(() => {
    setCountryFilter(searchParams.get("country") ?? "");
  }, [searchParams, slug]);

  const typeRows = useMemo(
    () => (kind ? items.filter((item) => item.inventory_type === kind.inventoryType) : []),
    [items, kind],
  );

  const countryOptions = useMemo(() => {
    const present = new Set(typeRows.map(itemCountry));
    const list = [...countries];
    for (const code of present) {
      if (!list.includes(code)) list.push(code);
    }
    if (countryFilter && !list.includes(countryFilter)) list.push(countryFilter);
    return list;
  }, [countries, typeRows, countryFilter]);

  const rows = useMemo(() => {
    if (!countryFilter) return typeRows;
    return typeRows.filter((item) => itemCountry(item).toLowerCase() === countryFilter.toLowerCase());
  }, [typeRows, countryFilter]);

  if (!kind) return <Navigate to={`/knowledge/${KNOWLEDGE_KINDS[0].slug}`} replace />;

  async function upload(file: File) {
    if (!kind) return;
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const created = await api<RagItem[]>(`/api/rag?inventory_type=${encodeURIComponent(kind.inventoryType)}`, { method: "POST", body });
      setItems((current) => [...created, ...current]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    await api(`/api/rag/${deleting.rag_id}`, { method: "DELETE" });
    const id = deleting.rag_id;
    setItems((current) => current.filter((row) => row.rag_id !== id));
    setDeleting(null);
  }

  const columns: Column<RagItem>[] = [
    { key: "id", header: "ID", sortValue: (row) => row.rag_id, className: "font-label text-xs whitespace-nowrap", render: (row) => row.rag_id },
    { key: "system", header: "System", sortValue: (row) => row.system_name, render: (row) => row.system_name },
    { key: "source", header: "Source", sortValue: (row) => row.source_name, className: "text-muted", render: (row) => row.source_name },
    { key: "details", header: "Details", sortValue: (row) => details(row), className: "text-muted max-w-xl", render: (row) => <span className="line-clamp-2">{details(row)}</span> },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            render: (row: RagItem) => (
              <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.rag_id}`} title="Delete" onClick={() => setDeleting(row)}>
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">{kind.label}</h1>
        <p className="text-muted mt-0.5">Shared knowledge-base entries used to ground generated documents.</p>
      </div>
      {error && <p className="text-alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          aria-label="Filter by country"
          value={countryFilter}
          options={[{ value: "", label: "All countries" }, ...countryOptions.map((item) => ({ value: item, label: item }))]}
          onChange={(next) => {
            setCountryFilter(next);
            const nextParams = new URLSearchParams(searchParams);
            if (next) nextParams.set("country", next);
            else nextParams.delete("country");
            setSearchParams(nextParams);
          }}
        />
      </div>
      <DataTable
        key={`${kind.slug}-${countryFilter}`}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.rag_id}
        pageSize={KNOWLEDGE_PAGE_SIZE}
        pageSizes={KB_PAGE_SIZES}
        emptyLabel={`No ${kind.label.toLowerCase()} found.`}
        searchText={(row) => `${row.rag_id} ${row.system_name} ${row.source_name} ${details(row)} ${row.raw_content ?? ""}`}
        searchLabel={`Search ${kind.label}`}
        searchPlaceholder={`Search ${kind.label.toLowerCase()}`}
        toolbar={
          canEdit ? (
            <FileDrop
              primary
              accept=".md,.markdown,.pdf,.html,.htm"
              ariaLabel={`Upload ${kind.label}`}
              disabled={uploading}
              idleLabel="Drop file"
              buttonLabel={
                <>
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    upload
                  </span>
                  {uploading ? "Uploading…" : "Upload"}
                </>
              }
              onFile={(file) => void upload(file)}
            />
          ) : undefined
        }
      />
      {deleting && (
        <ConfirmDialog title="Delete entry" message={`Delete ${deleting.rag_id}? This cannot be undone.`} onConfirm={remove} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
