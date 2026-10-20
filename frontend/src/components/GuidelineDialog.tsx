import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { Guideline } from "../types";
import { FileDrop } from "./FileDrop";

export const GUIDELINE_ACCEPT = ".md,.markdown,.pdf,.txt";

export function GuidelineDialog({ onAdded, onClose }: { onAdded: (guideline: Guideline) => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
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
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("title", title.trim());
      body.append("description", description.trim());
      body.append("file", file);
      onAdded(await api<Guideline>("/api/guidelines", { method: "POST", body }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the guideline");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form role="dialog" aria-modal="true" aria-label="Add guideline" className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-xl font-semibold mb-4">Add guideline</h2>
        <label className="block mb-3">
          <span className="font-label text-[10px] uppercase text-muted">Guideline title</span>
          <input className="field mt-1" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Guideline title" maxLength={200} required autoFocus disabled={busy} />
        </label>
        <label className="block mb-3">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[96px]" value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Guideline description" maxLength={2000} disabled={busy} />
        </label>
        <div className="mb-4">
          <span className="font-label text-[10px] uppercase text-muted">File</span>
          <div className="mt-1">
            <FileDrop accept={GUIDELINE_ACCEPT} ariaLabel="Guideline file" file={file} disabled={busy} grow idleLabel="Drop md, pdf or txt" onFile={setFile} />
          </div>
        </div>
        {busy && <p className="text-accent mb-3">Generating embeddings… large files can take a moment.</p>}
        {error && <p className="text-alert mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !title.trim() || !file}>
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
