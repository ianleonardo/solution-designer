import { useEffect, useState } from "react";

export type AutoFillRequest = { instruction: string; onlyEmpty: boolean };

/** Asks how to auto fill: one section (optionally with an extra instruction) or the whole document. */
export function AutoFillDialog({
  scope,
  sectionName,
  hasContent,
  onConfirm,
  onClose,
}: {
  scope: "section" | "document";
  sectionName?: string;
  /** For a single section: whether it already holds content that would be replaced. */
  hasContent?: boolean;
  onConfirm: (request: AutoFillRequest) => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const title = scope === "section" ? "Auto fill section" : "Auto fill document";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const replaces = scope === "section" ? !!hasContent : !onlyEmpty;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg space-y-3 rounded-xl border border-hairline bg-panel p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({ instruction: instruction.trim(), onlyEmpty: scope === "document" && onlyEmpty });
        }}
      >
        <h2 className="font-headline text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">
          {scope === "section"
            ? `The model writes “${sectionName ?? "this section"}” from the section prompt, the project's documents and the knowledge base.`
            : "The model writes each section from its section prompt, the project's documents and the knowledge base."}
        </p>
        {scope === "document" && (
          <fieldset className="space-y-1 text-sm">
            <legend className="font-label text-[10px] uppercase text-muted">Which sections</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={onlyEmpty} onChange={() => setOnlyEmpty(true)} />
              Fill empty sections only
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={!onlyEmpty} onChange={() => setOnlyEmpty(false)} />
              Regenerate every section
            </label>
          </fieldset>
        )}
        <label className="block space-y-1 text-sm">
          <span className="font-label text-[10px] uppercase text-muted">Extra instruction (optional, this run only)</span>
          <textarea
            className="field min-h-24"
            aria-label="Extra instruction"
            placeholder={
              scope === "section"
                ? "For example: focus on settlement risk, keep it under five bullets"
                : "For example: focus on settlement risk. This applies to every section filled in this run."
            }
            maxLength={1000}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        {replaces && (
          <p className="rounded border border-hairline bg-inset px-3 py-2 text-sm text-alert" role="alert">
            {scope === "section" ? "This section already has content. Auto fill replaces it." : "Sections that already have content are replaced, including your edits."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {replaces ? "Replace and fill" : "Auto fill"}
          </button>
        </div>
      </form>
    </div>
  );
}
