import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { Dashboard, KbCountryStats } from "../types";

const KB_COLUMNS: { key: Exclude<keyof KbCountryStats, "country">; label: string; slug: string }[] = [
  { key: "capabilities", label: "Capabilities", slug: "capabilities" },
  { key: "interfaces", label: "Interfaces", slug: "interfaces" },
  { key: "tables", label: "Tables", slug: "tables" },
  { key: "batches", label: "Batches", slug: "batches" },
  { key: "reports", label: "Reports", slug: "reports" },
];

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Dashboard>("/api/dashboard").then(setData).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load dashboard"));
  }, []);

  if (!user) return null;

  const kbRows = data?.kb_by_country ?? [];

  return (
    <div className="p-6 max-w-[1400px] space-y-8">
      <div>
        <h1 className="font-headline text-3xl font-semibold mb-4">Dashboard</h1>
        {error && <p className="text-alert mb-3">{error}</p>}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Link
            to="/projects"
            className="bg-panel border border-hairline rounded-lg p-4 block hover:border-[var(--focus,currentColor)] transition-colors"
            aria-label="Open projects"
          >
            <p className="font-label text-[10px] uppercase text-muted">Total Projects</p>
            <p className="font-headline text-3xl mt-2">{data?.total_projects ?? "—"}</p>
          </Link>
          <article className="bg-panel border border-hairline rounded-lg p-4">
            <p className="font-label text-[10px] uppercase text-muted">Total Documents</p>
            <p className="font-headline text-3xl mt-2">{data?.total_documents ?? "—"}</p>
          </article>
        </section>
      </div>

      <section>
        <h2 className="font-headline text-xl font-semibold">Knowledge Base</h2>
        <p className="text-muted mt-0.5 mb-3">Inventory counts by country for capabilities, interfaces, tables, batches and reports. Click a count to open that inventory filtered by country.</p>
        <div className="bg-panel border border-hairline rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-hairline bg-inset font-label text-[10px] uppercase text-muted">
                <th className="py-2.5 px-3">Country</th>
                {KB_COLUMNS.map((column) => (
                  <th key={column.key} className="py-2.5 px-3 text-right">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kbRows.length === 0 ? (
                <tr>
                  <td colSpan={KB_COLUMNS.length + 1} className="py-6 px-3 text-center text-muted">
                    {data ? "No knowledge base countries configured." : "Loading…"}
                  </td>
                </tr>
              ) : (
                kbRows.map((row) => (
                  <tr key={row.country} className="border-b border-hairline last:border-b-0">
                    <td className="py-2.5 px-3 font-label text-xs font-medium">{row.country}</td>
                    {KB_COLUMNS.map((column) => (
                      <td key={column.key} className="py-2.5 px-3 text-right font-label text-xs tabular-nums">
                        <Link
                          to={`/knowledge/${column.slug}?country=${encodeURIComponent(row.country)}`}
                          className="text-accent hover:underline"
                          aria-label={`${column.label} for ${row.country}: ${row[column.key]}`}
                        >
                          {row[column.key]}
                        </Link>
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
