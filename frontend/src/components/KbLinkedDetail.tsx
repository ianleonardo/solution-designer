import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { Catalogs, KbLink, SystemRecord } from "../types";
import { BatchDetailsDialog } from "./BatchesPanel";
import { CapabilityFormDialog } from "./CapabilitiesPanel";
import { CapabilityNodeWindow, type CapabilityNodeRef } from "./CapabilityNodeDetails";
import { InterfaceDetailDialog } from "./InterfaceSpec";
import { ReportDetailsDialog } from "./ReportsPanel";
import { TableDetailsDialog } from "./TablesPanel";

/** The Knowledge Base record behind a document row's chain icon. */
export function KbLinkedDetail({ link, onClose }: { link: KbLink; onClose: () => void }) {
  if (link.kind === "capability") return <CapabilityView capabilityId={link.id} onClose={onClose} />;
  if (link.kind === "interface") return <InterfaceView link={link} onClose={onClose} />;
  if (link.kind === "report") return <ReportDetailsDialog reportId={link.id} onClose={onClose} layerClass="z-[60]" />;
  if (link.kind === "batch") return <BatchDetailsDialog batchId={link.id} onClose={onClose} layerClass="z-[60]" />;
  if (link.kind === "column" && link.table_id) {
    return <TableDetailsDialog tableId={link.table_id} canEdit={false} onTableChanged={() => undefined} onClose={onClose} layerClass="z-[60]" />;
  }
  return null;
}

function CapabilityView({ capabilityId, onClose }: { capabilityId: string; onClose: () => void }) {
  const [countries, setCountries] = useState<string[] | null>(null);
  const [systems, setSystems] = useState<SystemRecord[]>([]);
  const [node, setNode] = useState<CapabilityNodeRef | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([api<Catalogs>("/api/catalogs").catch(() => null), api<SystemRecord[]>("/api/systems").catch(() => [] as SystemRecord[])]).then(
      ([catalogs, loaded]) => {
        if (!current) return;
        setCountries(catalogs?.countries?.length ? catalogs.countries : ["SG", "MY", "TH", "VN", "ID"]);
        setSystems(loaded);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  if (!countries) return null;
  return (
    <>
      <CapabilityFormDialog
        capabilityId={capabilityId}
        readOnly
        countries={countries}
        systems={systems}
        onSaved={() => undefined}
        onOpenLevel={setNode}
        onClose={onClose}
      />
      {node && (
        <CapabilityNodeWindow node={node} country="" countries={countries} canEdit={false} onClose={() => setNode(null)} />
      )}
    </>
  );
}

function InterfaceView({ link, onClose }: { link: KbLink; onClose: () => void }) {
  const [channel, setChannel] = useState(link.channel ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (channel) return;
    let current = true;
    api<{ channel: string }>(`/api/interfaces/id/${encodeURIComponent(link.id)}`)
      .then((record) => {
        if (current) setChannel(record.channel);
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof ApiError ? err.message : "Could not load interface");
      });
    return () => {
      current = false;
    };
  }, [channel, link.id]);

  if (!channel) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" aria-label="Interface specification" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl">
          <p className={error ? "text-alert text-sm" : "text-muted"}>{error || "Loading…"}</p>
          <div className="flex justify-end pt-3">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }
  return <InterfaceDetailDialog channel={channel} interfaceId={link.id} fallbackName="Interface" layerClass="z-[60]" onClose={onClose} />;
}
