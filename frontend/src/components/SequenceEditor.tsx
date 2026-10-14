import { useEffect, useState } from "react";
import {
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SequenceFlow } from "../types";

function toNodes(flow: SequenceFlow): Node[] {
  return flow.nodes.map((node) => ({
    id: node.id,
    position: node.position,
    data: { label: node.data.label },
    type: "default",
  }));
}

export function SequenceEditor({
  flow,
  onChange,
  readOnly,
}: {
  flow: SequenceFlow;
  onChange: (flow: SequenceFlow) => void;
  readOnly: boolean;
}) {
  const [nodes, setNodes] = useState<Node[]>(() => toNodes(flow));

  useEffect(() => {
    setNodes(toNodes(flow));
  }, [flow]);

  function commit(next: SequenceFlow) {
    onChange({ ...next, nodes: [...next.nodes].sort((a, b) => a.position.x - b.position.x) });
  }

  function onNodesChange(changes: NodeChange[]) {
    if (readOnly) return;
    setNodes((current) => applyNodeChanges(changes, current));
    const moved = changes.find((change) => change.type === "position" && change.dragging === false && change.position);
    if (moved && moved.type === "position" && moved.position) {
      commit({
        ...flow,
        nodes: flow.nodes.map((node) => (node.id === moved.id ? { ...node, position: moved.position! } : node)),
      });
    }
  }

  function updateNode(id: string, label: string, actor: boolean) {
    commit({
      ...flow,
      nodes: flow.nodes.map((node) => (node.id === id ? { ...node, data: { label, actor } } : node)),
    });
  }

  return (
    <div className="space-y-3">
      <div className="h-64 w-full relative rounded border border-hairline bg-inset">
        <ReactFlow
          nodes={nodes}
          edges={flow.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.label,
          }))}
          onNodesChange={onNodesChange}
          fitView
          nodesDraggable={!readOnly}
          nodesConnectable={false}
          elementsSelectable={!readOnly}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-2">
          <p className="font-label text-[10px] uppercase text-muted">Participants</p>
          {flow.nodes.map((node) => (
            <div key={node.id} className="flex gap-2 items-center">
              <input
                className="field"
                aria-label={`Participant ${node.data.label}`}
                readOnly={readOnly}
                value={node.data.label}
                onChange={(event) => updateNode(node.id, event.target.value, node.data.actor)}
              />
              <label className="text-xs text-muted flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={node.data.actor}
                  disabled={readOnly}
                  onChange={(event) => updateNode(node.id, node.data.label, event.target.checked)}
                />
                Actor
              </label>
              {!readOnly && (
                <button
                  type="button"
                  className="text-alert text-xs"
                  onClick={() =>
                    commit({
                      ...flow,
                      nodes: flow.nodes.filter((item) => item.id !== node.id),
                      edges: flow.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id),
                    })
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                const id = `n${Date.now()}`;
                commit({
                  ...flow,
                  nodes: [
                    ...flow.nodes,
                    { id, position: { x: flow.nodes.length * 220, y: 0 }, data: { label: "Participant", actor: false } },
                  ],
                });
              }}
            >
              Add participant
            </button>
          )}
        </div>
        <div className="space-y-2">
          <p className="font-label text-[10px] uppercase text-muted">Messages</p>
          {flow.edges.map((edge, index) => (
            <div
              key={edge.id}
              className="grid grid-cols-[1fr_1fr_1.4fr_5.5rem_auto] gap-1 items-center"
              draggable={!readOnly}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const from = Number(event.dataTransfer.getData("text/plain"));
                if (Number.isNaN(from) || from === index) return;
                const edges = [...flow.edges];
                const [moved] = edges.splice(from, 1);
                edges.splice(index, 0, moved);
                commit({ ...flow, edges });
              }}
            >
              <select
                className="field"
                aria-label={`Message ${index + 1} source`}
                disabled={readOnly}
                value={edge.source}
                onChange={(event) =>
                  commit({ ...flow, edges: flow.edges.map((item) => (item.id === edge.id ? { ...item, source: event.target.value } : item)) })
                }
              >
                {flow.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.data.label}
                  </option>
                ))}
              </select>
              <select
                className="field"
                aria-label={`Message ${index + 1} target`}
                disabled={readOnly}
                value={edge.target}
                onChange={(event) =>
                  commit({ ...flow, edges: flow.edges.map((item) => (item.id === edge.id ? { ...item, target: event.target.value } : item)) })
                }
              >
                {flow.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.data.label}
                  </option>
                ))}
              </select>
              <input
                className="field"
                aria-label={`Message ${index + 1} label`}
                readOnly={readOnly}
                value={edge.label}
                onChange={(event) =>
                  commit({ ...flow, edges: flow.edges.map((item) => (item.id === edge.id ? { ...item, label: event.target.value } : item)) })
                }
              />
              <select
                className="field"
                aria-label={`Message ${index + 1} kind`}
                disabled={readOnly}
                value={edge.data?.kind === "reply" ? "reply" : "request"}
                onChange={(event) =>
                  commit({
                    ...flow,
                    edges: flow.edges.map((item) => (item.id === edge.id ? { ...item, data: { kind: event.target.value === "reply" ? "reply" : "request" } } : item)),
                  })
                }
              >
                <option value="request">Request</option>
                <option value="reply">Reply</option>
              </select>
              {!readOnly && (
                <button
                  type="button"
                  className="text-alert text-xs"
                  aria-label={`Delete message ${index + 1}`}
                  onClick={() => commit({ ...flow, edges: flow.edges.filter((item) => item.id !== edge.id) })}
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
              onClick={() =>
                commit({
                  ...flow,
                  edges: [
                    ...flow.edges,
                    {
                      id: `m${Date.now()}`,
                      source: flow.nodes[0].id,
                      target: flow.nodes[1].id,
                      label: "Message",
                      data: { kind: "request" },
                    },
                  ],
                })
              }
            >
              Add message
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
