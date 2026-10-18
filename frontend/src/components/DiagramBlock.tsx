import { useEffect, useRef, useState, type WheelEvent } from "react";
import mermaid from "mermaid";
import { MERMAID_SYNTAX_HELP, MERMAID_TEMPLATES, STARTER_DIAGRAMS, type MermaidTemplate } from "../mermaidTemplates";
import type { Block } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { SelectField } from "./SelectField";

/** Rendered diagrams are shown at half of Mermaid's natural size; they were too large on the page. */
export const DIAGRAM_SCALE = 0.5;

/** Zoom range for the expanded diagram viewer (1 = Mermaid natural size). */
export const POPUP_ZOOM_MIN = 0.25;
export const POPUP_ZOOM_MAX = 4;
export const POPUP_ZOOM_STEP = 0.25;
export const POPUP_ZOOM_DEFAULT = 1;

/** How long to wait after typing before the preview is redrawn. */
export const PREVIEW_DELAY_MS = 350;

/** The width Mermaid would draw the SVG at: its viewBox, or the max-width it sets. */
function naturalWidth(svg: SVGSVGElement): number {
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 0) return box.width;
  const fromStyle = /max-width:\s*([\d.]+)px/.exec(svg.getAttribute("style") ?? "");
  return fromStyle ? Number(fromStyle[1]) : 0;
}

/** The line a Mermaid parse error points at ("Parse error on line 3"), if it names one. */
export function errorLine(message: string): number | null {
  const found = /line\s+(\d+)/i.exec(message);
  return found ? Number(found[1]) : null;
}

export function MermaidPreview({
  source,
  scale = DIAGRAM_SCALE,
  fit = true,
  onError,
}: {
  source: string;
  scale?: number;
  /** When true, the SVG may shrink to the container width; turn off for zoomed popups. */
  fit?: boolean;
  /** Called with the syntax error, or "" when the diagram drew. */
  onError?: (message: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const report = useRef(onError);
  report.current = onError;
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${Math.random().toString(36).slice(2)}`;
    const text = source.trim() ? source : "flowchart LR\n  A[Empty]";
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
    });
    // Checking the syntax first keeps Mermaid from leaving its own error picture in the page.
    mermaid
      .parse(text)
      .then(() => mermaid.render(id, text))
      .then((result) => {
        if (cancelled) return;
        setSvg(result.svg);
        setError("");
        report.current?.("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Diagram could not be rendered";
        setSvg("");
        setError(message);
        report.current?.(message);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    const element = holder.current?.querySelector("svg");
    if (!element) return;
    const width = naturalWidth(element);
    if (width <= 0) return;
    element.style.width = `${Math.round(width * scale)}px`;
    element.style.maxWidth = fit ? "100%" : "none";
    element.style.height = "auto";
    element.removeAttribute("height");
  }, [svg, scale, fit]);

  if (error) {
    return (
      <pre role="alert" className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-alert bg-inset p-3 font-label text-xs text-alert">
        {error}
      </pre>
    );
  }
  return (
    <div
      ref={holder}
      className="overflow-auto rounded border border-hairline bg-inset p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function clampZoom(value: number): number {
  return Math.min(POPUP_ZOOM_MAX, Math.max(POPUP_ZOOM_MIN, Math.round(value / POPUP_ZOOM_STEP) * POPUP_ZOOM_STEP));
}

/** Full-screen diagram viewer with zoom in / out. */
export function DiagramPopup({ source, onClose }: { source: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(POPUP_ZOOM_DEFAULT);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((current) => clampZoom(current + POPUP_ZOOM_STEP));
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((current) => clampZoom(current - POPUP_ZOOM_STEP));
      }
      if (event.key === "0" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setZoom(POPUP_ZOOM_DEFAULT);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -POPUP_ZOOM_STEP : POPUP_ZOOM_STEP;
    setZoom((current) => clampZoom(current + delta));
  }

  const percent = Math.round(zoom * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Diagram viewer"
        className="flex h-[90vh] w-full max-w-6xl flex-col rounded-lg border border-hairline bg-panel shadow-xl"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
          <h2 className="font-headline text-lg font-semibold">Diagram</h2>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom out"
              title="Zoom out (−)"
              disabled={zoom <= POPUP_ZOOM_MIN}
              onClick={() => setZoom((current) => clampZoom(current - POPUP_ZOOM_STEP))}
            >
              <span className="material-symbols-outlined">zoom_out</span>
            </button>
            <button
              type="button"
              className="btn min-w-[4.5rem] tabular-nums"
              aria-label="Reset zoom"
              title="Reset zoom"
              onClick={() => setZoom(POPUP_ZOOM_DEFAULT)}
            >
              {percent}%
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom in"
              title="Zoom in (+)"
              disabled={zoom >= POPUP_ZOOM_MAX}
              onClick={() => setZoom((current) => clampZoom(current + POPUP_ZOOM_STEP))}
            >
              <span className="material-symbols-outlined">zoom_in</span>
            </button>
            <button type="button" className="icon-btn" aria-label="Close diagram viewer" title="Close" onClick={onClose}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div
          ref={stage}
          className="min-h-0 flex-1 overflow-auto p-4"
          onWheel={onWheel}
        >
          <div className="inline-block min-w-full">
            <MermaidPreview source={source} scale={zoom} fit={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

type DiagramValue = Extract<Block, { type: "diagram" }>;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Text area with a line-number gutter; the line a syntax error points at is marked. */
function SourceEditor({
  value,
  readOnly,
  errorAt,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  errorAt: number | null;
  onChange: (value: string) => void;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;
  return (
    <div className="flex h-72 overflow-hidden rounded border border-hairline bg-inset font-label text-xs leading-5">
      <div ref={gutter} aria-hidden="true" className="select-none overflow-hidden border-r border-hairline px-2 py-2 text-right text-muted">
        {Array.from({ length: Math.max(lines, 1) }, (_, index) => (
          <div key={index} className={errorAt === index + 1 ? "font-semibold text-alert" : undefined}>
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        className="h-full flex-1 resize-none bg-transparent p-2 leading-5 outline-none"
        aria-label="Mermaid source"
        spellCheck={false}
        wrap="off"
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}

export function DiagramBlock({
  block,
  onChange,
  readOnly,
}: {
  block: DiagramValue;
  onChange: (block: DiagramValue) => void;
  readOnly: boolean;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState<MermaidTemplate | null>(null);
  const [help, setHelp] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const preview = useDebounced(block.mermaid, PREVIEW_DELAY_MS);

  function applyTemplate(template: MermaidTemplate) {
    onChange({ ...block, mermaid: template.text });
    setPending(null);
  }

  function pickTemplate(id: string) {
    const template = MERMAID_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    const text = block.mermaid.trim();
    // Replacing something somebody wrote asks first; a blank or starter diagram is swapped straight away.
    if (text && !STARTER_DIAGRAMS.has(text) && text !== template.text.trim()) setPending(template);
    else applyTemplate(template);
  }

  return (
    <div className="space-y-2">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            Start from a template
            <SelectField
              aria-label="Diagram template"
              className="min-w-[12rem]"
              value=""
              options={[
                { value: "", label: "Choose…" },
                ...MERMAID_TEMPLATES.map((template) => ({
                  value: template.id,
                  label: template.label,
                  hint: template.hint,
                })),
              ]}
              onChange={(id) => {
                if (id) pickTemplate(id);
              }}
            />
          </label>
          <button type="button" className="btn ml-auto" aria-expanded={help} onClick={() => setHelp((value) => !value)}>
            {help ? "Hide syntax help" : "Syntax help"}
          </button>
        </div>
      )}
      {help && (
        <div className="grid gap-3 rounded border border-hairline bg-inset p-3 text-xs sm:grid-cols-3" aria-label="Mermaid syntax help">
          {MERMAID_SYNTAX_HELP.map((group) => (
            <div key={group.title}>
              <p className="mb-1 font-semibold">{group.title}</p>
              <pre className="whitespace-pre-wrap font-label text-muted">{group.lines.join("\n")}</pre>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <SourceEditor
          value={block.mermaid}
          readOnly={readOnly}
          errorAt={error ? errorLine(error) : null}
          onChange={(mermaidText) => onChange({ ...block, mermaid: mermaidText })}
        />
        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-end">
            <button
              type="button"
              className="btn"
              aria-label="Expand diagram"
              title="Expand diagram"
              disabled={Boolean(error)}
              onClick={() => setPopupOpen(true)}
            >
              <span className="material-symbols-outlined text-base">open_in_full</span>
              Expand
            </button>
          </div>
          <div className="overflow-auto lg:max-h-72">
            <MermaidPreview source={preview} onError={setError} />
          </div>
        </div>
      </div>
      {popupOpen && !error && <DiagramPopup source={preview} onClose={() => setPopupOpen(false)} />}
      {pending && (
        <ConfirmDialog
          title="Replace the diagram"
          message={`Replace the current Mermaid text with the ${pending.label} template? What you wrote will be lost.`}
          confirmLabel="Replace"
          onConfirm={async () => applyTemplate(pending)}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
