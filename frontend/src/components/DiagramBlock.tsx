import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { defaultFlow, defaultFlowchart, flowToMermaid, flowchartToMermaid, isFlowchart, mermaidToFlow, mermaidToFlowchart } from "../flow";
import type { Block, Flowchart } from "../types";
import { FlowchartEditor } from "./FlowchartEditor";
import { SequenceEditor } from "./SequenceEditor";

/** Rendered diagrams are shown at half of Mermaid's natural size; they were too large on the page. */
export const DIAGRAM_SCALE = 0.5;

/** The width Mermaid would draw the SVG at: its viewBox, or the max-width it sets. */
function naturalWidth(svg: SVGSVGElement): number {
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 0) return box.width;
  const fromStyle = /max-width:\s*([\d.]+)px/.exec(svg.getAttribute("style") ?? "");
  return fromStyle ? Number(fromStyle[1]) : 0;
}

export function MermaidPreview({ source, scale = DIAGRAM_SCALE }: { source: string; scale?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${Math.random().toString(36).slice(2)}`;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
    });
    mermaid
      .render(id, source || "flowchart LR\n  A[Empty]")
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSvg("");
          setError(err instanceof Error ? err.message : "Diagram could not be rendered");
        }
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
    element.style.maxWidth = "100%";
    element.style.height = "auto";
    element.removeAttribute("height");
  }, [svg, scale]);

  if (error) return <p className="text-alert text-sm">{error}</p>;
  return <div ref={holder} className="overflow-auto rounded border border-hairline bg-inset p-3" dangerouslySetInnerHTML={{ __html: svg }} />;
}

type DiagramValue = Extract<Block, { type: "diagram" }>;

/** Keep dragged positions when the Mermaid text is re-read, so typing does not reshuffle the drawing. */
function keepPositions(next: Flowchart, previous: Flowchart | null): Flowchart {
  if (!previous) return next;
  const known = new Map(previous.nodes.map((node) => [node.id, node.position]));
  return { ...next, nodes: next.nodes.map((node) => ({ ...node, position: known.get(node.id) ?? node.position })) };
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
  const [showSource, setShowSource] = useState(false);
  const sequence = block.sequence;
  const chart = !sequence && isFlowchart(block.flow) ? block.flow : null;
  const steps = sequence && block.flow && !isFlowchart(block.flow) ? block.flow : null;
  // Mermaid the drawing cannot represent is edited as text only.
  const textOnly = !chart && !steps;

  function editText(mermaid: string) {
    if (sequence) {
      onChange({ ...block, mermaid, flow: mermaidToFlow(mermaid) });
      return;
    }
    const parsed = mermaidToFlowchart(mermaid);
    onChange({ ...block, mermaid, flow: parsed ? keepPositions(parsed, chart) : null });
  }

  function startNewDrawing() {
    if (sequence) {
      const fresh = defaultFlow();
      onChange({ ...block, flow: fresh, mermaid: flowToMermaid(fresh) });
    } else {
      const fresh = defaultFlowchart();
      onChange({ ...block, flow: fresh, mermaid: flowchartToMermaid(fresh) });
    }
  }

  return (
    <div className="space-y-2">
      {chart && (
        <FlowchartEditor flow={chart} readOnly={readOnly} onChange={(next) => onChange({ ...block, flow: next, mermaid: flowchartToMermaid(next) })} />
      )}
      {steps && (
        <SequenceEditor flow={steps} readOnly={readOnly} onChange={(next) => onChange({ ...block, flow: next, mermaid: flowToMermaid(next) })} />
      )}
      {textOnly && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-hairline bg-inset px-3 py-2 text-xs text-muted" role="note">
          <span className="flex-1">This diagram uses Mermaid features the drawing editor does not support, so it is edited as text.</span>
          {!readOnly && (
            <button type="button" className="btn" onClick={startNewDrawing}>
              Start a new drawing
            </button>
          )}
        </div>
      )}
      {!textOnly && (
        <div className="flex justify-end">
          <button type="button" className="btn" onClick={() => setShowSource((value) => !value)}>
            {showSource ? "Hide Mermaid" : "Edit Mermaid"}
          </button>
        </div>
      )}
      {(showSource || textOnly) && (
        <textarea
          className="field font-label min-h-40"
          readOnly={readOnly}
          value={block.mermaid}
          aria-label="Mermaid source"
          spellCheck={false}
          onChange={(event) => editText(event.target.value)}
        />
      )}
      <MermaidPreview source={block.mermaid} />
    </div>
  );
}
