import { FormEvent, useEffect, useState } from "react";
import { ApiError } from "../api";
import type { BlockSpec, Template } from "../types";
import { BlockBuilder } from "./BlockBuilder";

export type SectionValues = {
  section_name: string;
  blocks: BlockSpec[];
  hint: string;
  /** Left out when empty on a new section so the server writes a default prompt. */
  system_prompt?: string;
  temperature: number;
  max_words: number;
};

export type SectionDialogMode = { kind: "add"; parentName?: string } | { kind: "edit"; template: Template };

export function SectionDialog({
  mode,
  onSubmit,
  onClose,
}: {
  mode: SectionDialogMode;
  onSubmit: (values: SectionValues) => Promise<void>;
  onClose: () => void;
}) {
  const template = mode.kind === "edit" ? mode.template : null;
  const [name, setName] = useState(template?.section_name ?? "");
  const [hint, setHint] = useState(template?.hint ?? "");
  const [prompt, setPrompt] = useState(template?.system_prompt ?? "");
  const [temperature, setTemperature] = useState(template?.temperature ?? 0.2);
  const [maxWords, setMaxWords] = useState(template?.max_words ?? 2000);
  const [blocks, setBlocks] = useState<BlockSpec[]>(template?.blocks ?? [{ type: "prose" }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const title = mode.kind === "add" ? (mode.parentName ? `Add sub-section to ${mode.parentName}` : "Add section") : "Section settings";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocks.length === 0) {
      setError("A section needs at least one block.");
      return;
    }
    if (mode.kind === "edit" && !prompt.trim()) {
      setError("The section prompt is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        section_name: name.trim(),
        blocks,
        hint: hint.trim(),
        ...(prompt.trim() ? { system_prompt: prompt } : {}),
        temperature,
        max_words: maxWords || 2000,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the section");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="font-headline text-xl font-semibold">{title}</h2>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Section name</span>
          <input className="field mt-1" aria-label="Section name" value={name} maxLength={150} onChange={(event) => setName(event.target.value)} required autoFocus />
        </label>
        <div>
          <p className="font-label text-[10px] uppercase text-muted mb-1">Content blocks</p>
          <BlockBuilder blocks={blocks} onChange={setBlocks} />
          <p className="text-xs text-muted mt-1">Content stays with the blocks that remain. A removed block loses its content when you save.</p>
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Hint</span>
          <input className="field mt-1" aria-label="Hint" value={hint} maxLength={1000} onChange={(event) => setHint(event.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Section prompt (used by Auto fill)</span>
          <textarea
            className="field mt-1 min-h-28"
            aria-label="Section prompt"
            value={prompt}
            placeholder={mode.kind === "add" ? "Leave empty to use a default prompt built from the name and hint" : ""}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Temperature {temperature.toFixed(2)}
            <input className="w-full" type="range" aria-label="Temperature" min={0} max={1} step={0.05} value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} />
          </label>
          <label className="block text-sm">
            Max words
            <input
              className="field mt-1"
              type="text"
              inputMode="numeric"
              aria-label="Max words"
              value={maxWords || ""}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "");
                setMaxWords(digits === "" ? 0 : Number(digits));
              }}
            />
          </label>
        </div>
        {error && <p className="text-alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {mode.kind === "add" ? "Add" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
