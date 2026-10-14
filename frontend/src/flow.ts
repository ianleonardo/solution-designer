import type { DiagramFlow, Flowchart, FlowchartEdge, FlowchartNode, FlowchartShape, SequenceFlow } from "./types";

export function flowToMermaid(flow: SequenceFlow): string {
  const nodes = [...flow.nodes].sort((left, right) => left.position.x - right.position.x);
  const lines = ["sequenceDiagram"];
  const used = new Set<string>();
  const aliases = new Map<string, string>();
  for (const node of nodes) {
    let alias = (node.data.label || node.id).replace(/[^A-Za-z0-9_]/g, "") || "Node";
    if (!/^[A-Za-z]/.test(alias)) alias = `N${alias}`;
    let unique = alias;
    let count = 2;
    while (used.has(unique)) {
      unique = `${alias}${count}`;
      count += 1;
    }
    used.add(unique);
    aliases.set(node.id, unique);
    const kind = node.data.actor ? "actor" : "participant";
    lines.push(`    ${kind} ${unique} as ${node.data.label.replace(/:/g, " ")}`);
  }
  for (const edge of flow.edges) {
    const arrow = edge.data?.kind === "reply" ? "-->>" : "->>";
    const source = aliases.get(edge.source) ?? edge.source;
    const target = aliases.get(edge.target) ?? edge.target;
    lines.push(`    ${source}${arrow}${target}: ${(edge.label || "").replace(/:/g, " ")}`);
  }
  return lines.join("\n");
}

// Mermaid allows spaces in a participant's name (`participant Source System`), and models write them that way.
const SEQ_PARTICIPANT = /^(actor|participant)\s+(.+?)(?:\s+as\s+(.+))?$/;
const SEQ_MESSAGE = /^(.+?)\s*(-->>|->>)\s*(.+?)\s*:\s*(.*)$/;

/**
 * Read a sequence diagram (participants and ->> / -->> messages) into a drawing. Mirrors `mermaid_to_flow` in
 * backend/app/flow.py. A participant that is only mentioned in a message is added. Null when the text is not a
 * sequence diagram or uses anything else (notes, loops, activations): it then stays text.
 */
export function mermaidToFlow(source: string): SequenceFlow | null {
  const lines = (source || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
  if (lines.length === 0 || lines[0] !== "sequenceDiagram") return null;
  const nodes: SequenceFlow["nodes"] = [];
  const edges: SequenceFlow["edges"] = [];
  const addNode = (alias: string, label: string | null, actor: boolean) => {
    const found = nodes.find((node) => node.id === alias);
    if (found) {
      if (label !== null) found.data = { label, actor };
      return;
    }
    nodes.push({ id: alias, position: { x: nodes.length * 220, y: 0 }, data: { label: label ?? alias, actor } });
  };
  for (const line of lines.slice(1)) {
    const participant = SEQ_PARTICIPANT.exec(line);
    if (participant) {
      addNode(participant[2].trim(), (participant[3] ?? participant[2]).trim(), participant[1] === "actor");
      continue;
    }
    const message = SEQ_MESSAGE.exec(line);
    if (!message) return null;
    const [from, to] = [message[1].trim(), message[3].trim()];
    addNode(from, null, false);
    addNode(to, null, false);
    edges.push({ id: `m${edges.length + 1}`, source: from, target: to, label: message[4].trim(), data: { kind: message[2] === "-->>" ? "reply" : "request" } });
  }
  return nodes.length ? { nodes, edges } : null;
}

export function defaultFlow(): SequenceFlow {
  return {
    nodes: [
      { id: "user", position: { x: 0, y: 0 }, data: { label: "User", actor: true } },
      { id: "system", position: { x: 220, y: 0 }, data: { label: "System", actor: false } },
    ],
    edges: [
      { id: "m1", source: "user", target: "system", label: "Request", data: { kind: "request" } },
      { id: "m2", source: "system", target: "user", label: "Response", data: { kind: "reply" } },
    ],
  };
}

// --- Flowcharts ---------------------------------------------------------------------------------------------------
// Mirrors backend/app/flow.py. Change both together. Only a small Mermaid subset is understood (nodes with [] () {}
// shapes, --> arrows with an optional label); anything else makes mermaidToFlowchart return null and the diagram
// stays Mermaid text.

export const DEFAULT_FLOWCHART = "flowchart LR\n    Source[Source] --> System[System]\n    System --> Destination[Destination]";

const CHART_SHAPES: FlowchartShape[] = ["rect", "round", "decision"];
const MAX_CHART_NODES = 200;
const RESERVED = new Set(["end", "graph", "flowchart", "subgraph", "style", "class", "classdef", "click", "default", "linkstyle", "direction"]);
const OPEN: Record<FlowchartShape, [string, string]> = { rect: ["[", "]"], round: ["(", ")"], decision: ["{", "}"] };
const NODE = /(?<id>[A-Za-z_][A-Za-z0-9_]*)(?:(?<open>\(\[|\(\(|\[\[|\[|\(|\{)(?<body>"[^"]*"|[^\])}"]*)(?<close>\]\)|\)\)|\]\]|\]|\)|\}))?/y;
const ARROW = /\s*(?:-->\|(?<l1>[^|]*)\||--\s+(?<l2>[^>-][^>]*?)\s+-->|-->)\s*/y;
const HEADER = /^(?:flowchart|graph)\s+(LR|TB|TD)\s*;?$/i;

export function isFlowchart(flow: DiagramFlow | null | undefined): flow is Flowchart {
  return !!flow && "direction" in flow;
}

function chartAlias(id: string, used: Set<string>): string {
  let safe = id.replace(/[^A-Za-z0-9_]/g, "") || "n";
  if (!/^[A-Za-z]/.test(safe)) safe = `n${safe}`;
  if (RESERVED.has(safe.toLowerCase())) safe += "_";
  let alias = safe;
  let index = 2;
  while (used.has(alias)) {
    alias = `${safe}${index}`;
    index += 1;
  }
  used.add(alias);
  return alias;
}

const nodeText = (value: string) => (value || "").replace(/\n/g, " ").replace(/"/g, "#quot;");
const edgeText = (value: string) => (value || "").replace(/\n/g, " ").replace(/\|/g, "/").replace(/"/g, "'").trim();

export function flowchartToMermaid(flow: Flowchart | null | undefined): string {
  const chart = normalizeFlowchart(flow);
  if (!chart) return DEFAULT_FLOWCHART;
  const lines = [`flowchart ${chart.direction}`];
  const used = new Set<string>();
  const alias = new Map<string, string>();
  for (const node of chart.nodes) {
    const name = chartAlias(node.id, used);
    alias.set(node.id, name);
    const [opening, closing] = OPEN[node.data.shape];
    lines.push(`    ${name}${opening}"${nodeText(node.data.label || node.id)}"${closing}`);
  }
  for (const edge of chart.edges) {
    const label = edgeText(edge.label);
    lines.push(`    ${alias.get(edge.source)} ${label ? `-->|${label}|` : "-->"} ${alias.get(edge.target)}`);
  }
  return lines.join("\n");
}

/** The clean form of a flowchart, or null when it is not usable. */
export function normalizeFlowchart(flow: unknown): Flowchart | null {
  if (!flow || typeof flow !== "object") return null;
  const raw = flow as { nodes?: unknown; edges?: unknown; direction?: unknown };
  if (!Array.isArray(raw.nodes)) return null;
  const nodes: FlowchartNode[] = [];
  const seen = new Set<string>();
  for (const item of raw.nodes.slice(0, MAX_CHART_NODES)) {
    const node = item as { id?: unknown; position?: { x?: unknown; y?: unknown }; data?: { label?: unknown; shape?: unknown } } | null;
    if (!node || typeof node !== "object" || typeof node.id !== "string" || !node.id || seen.has(node.id)) continue;
    const data = node.data && typeof node.data === "object" ? node.data : {};
    const position = node.position && typeof node.position === "object" ? node.position : {};
    const shape = CHART_SHAPES.includes(data.shape as FlowchartShape) ? (data.shape as FlowchartShape) : "rect";
    const coordinate = (value: unknown) => (typeof value === "number" ? value : 0);
    seen.add(node.id);
    nodes.push({ id: node.id.slice(0, 64), position: { x: coordinate(position.x), y: coordinate(position.y) }, data: { label: String(data.label || "").slice(0, 200), shape } });
  }
  if (nodes.length === 0) return null;
  const known = new Set(nodes.map((node) => node.id));
  const edges: FlowchartEdge[] = [];
  (Array.isArray(raw.edges) ? raw.edges : []).forEach((item, index) => {
    const edge = item as { id?: unknown; source?: unknown; target?: unknown; label?: unknown } | null;
    if (!edge || typeof edge !== "object" || typeof edge.source !== "string" || typeof edge.target !== "string") return;
    if (!known.has(edge.source) || !known.has(edge.target)) return;
    const id = typeof edge.id === "string" && edge.id ? edge.id : `e${index + 1}`;
    edges.push({ id: id.slice(0, 64), source: edge.source, target: edge.target, label: String(edge.label || "").slice(0, 200) });
  });
  return { direction: raw.direction === "TB" ? "TB" : "LR", nodes, edges };
}

function layout(order: string[], edges: [string, string][], direction: "LR" | "TB"): Map<string, { x: number; y: number }> {
  const index = new Map(order.map((id, position) => [id, position]));
  const level = new Map(order.map((id) => [id, 0]));
  for (const id of order) {
    for (const [source, target] of edges) {
      if (target === id && (index.get(source) ?? 0) < (index.get(target) ?? 0)) {
        level.set(id, Math.max(level.get(id) ?? 0, (level.get(source) ?? 0) + 1));
      }
    }
  }
  const counters = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of order) {
    const column = level.get(id) ?? 0;
    const row = counters.get(column) ?? 0;
    counters.set(column, row + 1);
    positions.set(id, direction === "LR" ? { x: column * 240, y: row * 110 } : { x: row * 240, y: column * 120 });
  }
  return positions;
}

function unquote(body: string): string {
  let text = body.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  return text.replace(/#quot;/g, '"').trim();
}

/** Parse the supported Mermaid subset into a flowchart; null when anything in it is not supported. */
export function mermaidToFlowchart(source: string): Flowchart | null {
  const lines = (source || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/;+$/, "").trim())
    .filter((line) => line && !line.startsWith("%%"));
  if (lines.length === 0) return null;
  const header = HEADER.exec(lines[0]);
  if (!header) return null;
  const direction: "LR" | "TB" = ["TB", "TD"].includes(header[1].toUpperCase()) ? "TB" : "LR";
  const labels = new Map<string, string>();
  const shapes = new Map<string, FlowchartShape>();
  const order: string[] = [];
  const edges: [string, string, string][] = [];

  function take(text: string, position: number): [string, number] | null {
    NODE.lastIndex = position;
    const match = NODE.exec(text);
    if (!match?.groups) return null;
    const id = match.groups.id;
    if (RESERVED.has(id.toLowerCase())) return null;
    if (!order.includes(id)) order.push(id);
    const opening = match.groups.open;
    if (opening) {
      shapes.set(id, opening === "{" ? "decision" : opening.startsWith("(") ? "round" : "rect");
      labels.set(id, unquote(match.groups.body ?? ""));
    }
    return [id, NODE.lastIndex];
  }

  for (const line of lines.slice(1)) {
    const first = take(line, 0);
    if (!first) return null;
    let [previous, position] = first;
    while (position < line.length) {
      ARROW.lastIndex = position;
      const arrow = ARROW.exec(line);
      if (!arrow?.groups) return null;
      const label = arrow.groups.l1 ?? arrow.groups.l2 ?? "";
      const following = take(line, ARROW.lastIndex);
      if (!following) return null;
      const [target, next] = following;
      edges.push([previous, target, unquote(label)]);
      previous = target;
      position = next;
    }
  }
  if (order.length === 0 || order.length > MAX_CHART_NODES) return null;
  const positions = layout(order, edges.map(([from, to]) => [from, to]), direction);
  return {
    direction,
    nodes: order.map((id) => ({ id, position: positions.get(id) ?? { x: 0, y: 0 }, data: { label: labels.get(id) ?? id, shape: shapes.get(id) ?? "rect" } })),
    edges: edges.map(([source, target, label], index) => ({ id: `e${index + 1}`, source, target, label })),
  };
}

export function defaultFlowchart(): Flowchart {
  return mermaidToFlowchart(DEFAULT_FLOWCHART) ?? { direction: "LR", nodes: [], edges: [] };
}
