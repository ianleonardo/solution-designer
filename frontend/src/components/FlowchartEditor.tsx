import { useEffect, useMemo, useState } from "react";
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Flowchart, FlowchartShape } from "../types";

type ChartNodeData = { label: string; shape: FlowchartShape; direction: "LR" | "TB" };

const SHAPE_NAMES: Record<FlowchartShape, string> = { rect: "Box", round: "Rounded", decision: "Decision" };

function ChartNode({ data }: NodeProps) {
  const { label, shape, direction } = data as unknown as ChartNodeData;
  const horizontal = direction === "LR";
  return (
    <div className={`chart-node ${shape === "round" ? "chart-node-round" : shape === "decision" ? "chart-node-decision" : ""}`}>
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} />
      <span>{label}</span>
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} />
    </div>
  );
}

const NODE_TYPES = { chart: ChartNode };

function toNodes(flow: Flowchart): Node[] {
  return flow.nodes.map((node) => ({
    id: node.id,
    type: "chart",
    position: node.position,
    data: { label: node.data.label || node.id, shape: node.data.shape, direction: flow.direction },
  }));
}

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export function FlowchartEditor({
  flow,
  onChange,
  readOnly,
}: {
  flow: Flowchart;
  onChange: (flow: Flowchart) => void;
  readOnly: boolean;
}) {
  const [nodes, setNodes] = useState<Node[]>(() => toNodes(flow));

  useEffect(() => {
    setNodes(toNodes(flow));
  }, [flow]);

  const edges = useMemo<Edge[]>(
    () => flow.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label || undefined, markerEnd: { type: MarkerType.ArrowClosed } })),
    [flow.edges],
  );

  function removeNodes(ids: string[]) {
    if (flow.nodes.every((node) => ids.includes(node.id))) {
      // A diagram keeps at least one box.
      setNodes(toNodes(flow));
      return;
    }
    onChange({
      ...flow,
      nodes: flow.nodes.filter((node) => !ids.includes(node.id)),
      edges: flow.edges.filter((edge) => !ids.includes(edge.source) && !ids.includes(edge.target)),
    });
  }

  function onNodesChange(changes: NodeChange[]) {
    if (readOnly) return;
    // Removals go through onNodesDelete so the stored flowchart stays the single source of truth.
    const kept = changes.filter((change) => change.type !== "remove");
    setNodes((current) => applyNodeChanges(kept, current));
    const moved = changes.filter((change) => change.type === "position" && change.dragging === false && change.position);
    if (moved.length) {
      onChange({
        ...flow,
        nodes: flow.nodes.map((node) => {
          const change = moved.find((item) => item.type === "position" && item.id === node.id);
          return change && change.type === "position" && change.position ? { ...node, position: change.position } : node;
        }),
      });
    }
  }

  function onConnect(connection: Connection) {
    if (readOnly || !connection.source || !connection.target) return;
    onChange({ ...flow, edges: [...flow.edges, { id: uid("e"), source: connection.source, target: connection.target, label: "" }] });
  }

  function addNode(shape: FlowchartShape) {
    const last = flow.nodes.reduce(
      (far, node) => ({ x: Math.max(far.x, node.position.x), y: Math.max(far.y, node.position.y) }),
      { x: 0, y: 0 },
    );
    const position = flow.direction === "LR" ? { x: flow.nodes.length ? last.x + 240 : 0, y: 0 } : { x: 0, y: flow.nodes.length ? last.y + 120 : 0 };
    onChange({ ...flow, nodes: [...flow.nodes, { id: uid("n"), position, data: { label: SHAPE_NAMES[shape], shape } }] });
  }

  function updateNode(id: string, patch: Partial<Flowchart["nodes"][number]["data"]>) {
    onChange({ ...flow, nodes: flow.nodes.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)) });
  }

  function updateEdge(id: string, patch: Partial<Flowchart["edges"][number]>) {
    onChange({ ...flow, edges: flow.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)) });
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Flowchart tools">
          {(Object.keys(SHAPE_NAMES) as FlowchartShape[]).map((shape) => (
            <button key={shape} type="button" className="btn" onClick={() => addNode(shape)}>
              Add {SHAPE_NAMES[shape].toLowerCase()}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            Direction
            <select
              className="field w-40"
              aria-label="Flow direction"
              value={flow.direction}
              onChange={(event) => onChange({ ...flow, direction: event.target.value === "TB" ? "TB" : "LR" })}
            >
              <option value="LR">Left to right</option>
              <option value="TB">Top to bottom</option>
            </select>
          </label>
        </div>
      )}
      <div className="relative h-72 w-full rounded border border-hairline bg-inset">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodesDelete={(deleted) => !readOnly && removeNodes(deleted.map((node) => node.id))}
          onEdgesDelete={(deleted) => {
            if (readOnly) return;
            const gone = new Set(deleted.map((edge) => edge.id));
            if (flow.edges.some((edge) => gone.has(edge.id))) onChange({ ...flow, edges: flow.edges.filter((edge) => !gone.has(edge.id)) });
          }}
          fitView
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      {!readOnly && <p className="text-xs text-muted">Drag from a dot on one box to another to draw an arrow. Select a box or arrow and press Delete to remove it.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <p className="font-label text-[10px] uppercase text-muted">Boxes</p>
          {flow.nodes.map((node, index) => (
            <div key={node.id} className="flex items-center gap-2">
              <input
                className="field"
                aria-label={`Box ${index + 1} text`}
                readOnly={readOnly}
                value={node.data.label}
                onChange={(event) => updateNode(node.id, { label: event.target.value })}
              />
              <select
                className="field w-28 shrink-0"
                aria-label={`Box ${index + 1} shape`}
                disabled={readOnly}
                value={node.data.shape}
                onChange={(event) => updateNode(node.id, { shape: event.target.value as FlowchartShape })}
              >
                {(Object.keys(SHAPE_NAMES) as FlowchartShape[]).map((shape) => (
                  <option key={shape} value={shape}>
                    {SHAPE_NAMES[shape]}
                  </option>
                ))}
              </select>
              {!readOnly && (
                <button
                  type="button"
                  className="text-alert text-xs disabled:opacity-40"
                  aria-label={`Delete box ${index + 1}`}
                  disabled={flow.nodes.length <= 1}
                  onClick={() => removeNodes([node.id])}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <p className="font-label text-[10px] uppercase text-muted">Arrows</p>
          {flow.edges.map((edge, index) => (
            <div key={edge.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1">
              <select
                className="field"
                aria-label={`Arrow ${index + 1} from`}
                disabled={readOnly}
                value={edge.source}
                onChange={(event) => updateEdge(edge.id, { source: event.target.value })}
              >
                {flow.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.data.label || node.id}
                  </option>
                ))}
              </select>
              <select
                className="field"
                aria-label={`Arrow ${index + 1} to`}
                disabled={readOnly}
                value={edge.target}
                onChange={(event) => updateEdge(edge.id, { target: event.target.value })}
              >
                {flow.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.data.label || node.id}
                  </option>
                ))}
              </select>
              <input
                className="field"
                aria-label={`Arrow ${index + 1} label`}
                placeholder="Label"
                readOnly={readOnly}
                value={edge.label}
                onChange={(event) => updateEdge(edge.id, { label: event.target.value })}
              />
              {!readOnly && (
                <button
                  type="button"
                  className="text-alert text-xs"
                  aria-label={`Delete arrow ${index + 1}`}
                  onClick={() => onChange({ ...flow, edges: flow.edges.filter((item) => item.id !== edge.id) })}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
          {!readOnly && flow.nodes.length > 1 && (
            <button
              type="button"
              className="btn"
              onClick={() => onChange({ ...flow, edges: [...flow.edges, { id: uid("e"), source: flow.nodes[0].id, target: flow.nodes[1].id, label: "" }] })}
            >
              Add arrow
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
