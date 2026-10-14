import { FormEvent, useEffect, useState } from "react";
import { ApiError } from "../api";

export function ProjectDialog({
  title,
  submitLabel,
  initialName = "",
  initialDescription = "",
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initialName?: string;
  initialDescription?: string;
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(name.trim(), description.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the project");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-xl font-semibold mb-4">{title}</h2>
        <label className="block mb-3">
          <span className="font-label text-[10px] uppercase text-muted">Project name</span>
          <input className="field mt-1" value={name} onChange={(event) => setName(event.target.value)} aria-label="Project name" required autoFocus />
        </label>
        <label className="block mb-4">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[96px]" value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Project description" maxLength={2000} />
        </label>
        {error && <p className="text-alert mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
