import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { SystemRecord } from "../types";

/** Adds a system, or edits one (its code is fixed once created because other systems and interfaces refer to it). */
export function SystemDialog({ system, onSaved, onClose }: { system?: SystemRecord; onSaved: (saved: SystemRecord) => void; onClose: () => void }) {
  const editing = Boolean(system);
  const [code, setCode] = useState(system?.system_code ?? "");
  const [name, setName] = useState(system?.system_name ?? "");
  const [description, setDescription] = useState(system?.description ?? "");
  const [upstreams, setUpstreams] = useState(system?.upstreams ?? "");
  const [downstreams, setDownstreams] = useState(system?.downstreams ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = { system_name: name.trim(), description: description.trim(), upstreams: upstreams.trim(), downstreams: downstreams.trim() };
    try {
      const saved = system
        ? await api<SystemRecord>(`/api/systems/${encodeURIComponent(system.system_code)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<SystemRecord>("/api/systems", { method: "POST", body: JSON.stringify({ ...body, system_code: code.trim() }) });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the system");
      setBusy(false);
    }
  }

  const title = editing ? "Edit system" : "Add system";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-xl font-semibold mb-4">{title}</h2>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <label className="block">
            <span className="font-label text-[10px] uppercase text-muted">System code</span>
            <input className="field mt-1" value={code} onChange={(event) => setCode(event.target.value)} aria-label="System code" maxLength={50} required readOnly={editing} autoFocus={!editing} disabled={busy} />
          </label>
          <label className="block col-span-2">
            <span className="font-label text-[10px] uppercase text-muted">System name</span>
            <input className="field mt-1" value={name} onChange={(event) => setName(event.target.value)} aria-label="System name" maxLength={200} required autoFocus={editing} disabled={busy} />
          </label>
        </div>
        <label className="block mb-3">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[80px]" value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Description" maxLength={2000} disabled={busy} />
        </label>
        <label className="block mb-3">
          <span className="font-label text-[10px] uppercase text-muted">Upstreams</span>
          <input className="field mt-1" value={upstreams} onChange={(event) => setUpstreams(event.target.value)} aria-label="Upstreams" placeholder="System codes separated by commas, or empty" disabled={busy} />
        </label>
        <label className="block mb-4">
          <span className="font-label text-[10px] uppercase text-muted">Downstreams</span>
          <input className="field mt-1" value={downstreams} onChange={(event) => setDownstreams(event.target.value)} aria-label="Downstreams" placeholder="System codes separated by commas, or empty" disabled={busy} />
        </label>
        {error && <p className="text-alert mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !code.trim() || !name.trim()}>
            {editing ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}
