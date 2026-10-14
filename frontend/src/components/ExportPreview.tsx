import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import { authHeaders } from "../api";
import { MermaidPreview } from "./DiagramBlock";

export type ExportFormat = "md" | "html" | "pdf";

const TITLES: Record<ExportFormat, string> = {
  md: "Markdown preview",
  html: "HTML preview",
  pdf: "PDF preview",
};

// html:false keeps raw tags in the generated markdown from being injected into the page.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

// The Markdown export puts a line break inside a table cell as <br>. Raw HTML stays off, so only that one tag is
// recognised, and it becomes a real line break instead of showing as text.
markdown.inline.ruler.before("escape", "line_break_tag", (state, silent) => {
  const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push("hardbreak", "br", 0);
  state.pos += match[0].length;
  return true;
});

type Segment = { kind: "markdown"; text: string } | { kind: "mermaid"; text: string };

export function splitMermaid(source: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```mermaid\n([\s\S]*?)\n```/g;
  let last = 0;
  for (const match of source.matchAll(fence)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "markdown", text: source.slice(last, start) });
    segments.push({ kind: "mermaid", text: match[1] });
    last = start + match[0].length;
  }
  if (last < source.length) segments.push({ kind: "markdown", text: source.slice(last) });
  return segments;
}

function MarkdownView({ source }: { source: string }) {
  const segments = useMemo(() => splitMermaid(source), [source]);
  return (
    <div className="md-preview p-6" aria-label="Rendered markdown">
      {segments.map((segment, index) =>
        segment.kind === "mermaid" ? (
          <MermaidPreview key={index} source={segment.text} />
        ) : (
          <div key={index} dangerouslySetInnerHTML={{ __html: markdown.render(segment.text) }} />
        ),
      )}
    </div>
  );
}

export function ExportPreview({
  projectId,
  documentId,
  projectName,
  format,
  onClose,
}: {
  projectId: string;
  /** Omit to export the project's first document. */
  documentId?: string;
  projectName: string;
  format: ExportFormat;
  onClose: () => void;
}) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    async function load() {
      const response = await fetch(`/api/projects/${projectId}${documentId ? `/documents/${documentId}` : ""}/export?format=${format}`, { headers: authHeaders() });
      if (!response.ok) {
        let detail = "Preview failed";
        try {
          const body = (await response.json()) as { detail?: string };
          if (body.detail) detail = body.detail;
        } catch {
          // keep the generic message
        }
        throw new Error(detail);
      }
      let data: Blob;
      let body = "";
      if (format === "pdf") {
        data = await response.blob();
      } else {
        body = await response.text();
        data = new Blob([body], { type: response.headers.get("Content-Type") || "text/plain" });
      }
      if (cancelled) return;
      if (format === "pdf") {
        objectUrl = URL.createObjectURL(data);
        setUrl(objectUrl);
      } else {
        setText(body);
      }
      setBlob(data);
    }
    load().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Preview failed");
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, documentId, format]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function download() {
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${projectName || "sdd"}.${format}`;
    link.click();
    URL.revokeObjectURL(href);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={TITLES[format]} className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-hairline bg-panel shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
          <h2 className="font-headline text-lg font-semibold">{TITLES[format]}</h2>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={download} disabled={!blob}>
              Download
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {error && <p className="p-4 text-alert">{error}</p>}
          {!error && !blob && <p className="p-4 text-muted">Preparing preview…</p>}
          {!error && blob && format === "md" && <MarkdownView source={text} />}
          {!error && blob && format === "html" && <iframe title="HTML preview" sandbox="" srcDoc={text} className="h-full w-full bg-white" />}
          {!error && blob && format === "pdf" && url && <iframe title="PDF preview" src={url} className="h-full w-full bg-white" />}
        </div>
      </div>
    </div>
  );
}
