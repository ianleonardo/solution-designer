import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { Dashboard } from "../types";

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Dashboard>("/api/dashboard").then(setData).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load dashboard"));
  }, []);

  if (!user) return null;

  return (
    <div className="p-6 max-w-[1400px]">
      <h1 className="font-headline text-3xl font-semibold mb-4">Dashboard</h1>
      {error && <p className="text-alert mb-3">{error}</p>}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          ["Total Projects", data?.total_projects ?? "—"],
          ["Total Documents", data?.total_documents ?? "—"],
          ["Documents Generated", data?.documents_generated ?? "—"],
        ].map(([label, value]) => (
          <article key={String(label)} className="bg-panel border border-hairline rounded-lg p-4">
            <p className="font-label text-[10px] uppercase text-muted">{label}</p>
            <p className="font-headline text-3xl mt-2">{value}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
