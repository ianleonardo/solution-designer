import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FlowchartEditor } from "./FlowchartEditor";
import type { Flowchart } from "../types";

const canvas = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    canvas.props = props;
    return <div data-testid="canvas" />;
  },
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  applyNodeChanges: (changes: { id: string; type: string; position?: { x: number; y: number } }[], nodes: { id: string }[]) =>
    nodes.map((node) => {
      const change = changes.find((item) => item.id === node.id && item.type === "position");
      return change ? { ...node, position: change.position } : node;
    }),
}));

afterEach(cleanup);

const flow: Flowchart = {
  direction: "LR",
  nodes: [
    { id: "a", position: { x: 0, y: 0 }, data: { label: "Start", shape: "rect" } },
    { id: "b", position: { x: 240, y: 0 }, data: { label: "Check", shape: "decision" } },
  ],
  edges: [{ id: "e1", source: "a", target: "b", label: "" }],
};

test("adds boxes in each shape and changes the direction", () => {
  const onChange = vi.fn();
  render(<FlowchartEditor flow={flow} readOnly={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Add rounded" }));
  const added = onChange.mock.calls[0][0] as Flowchart;
  expect(added.nodes).toHaveLength(3);
  expect(added.nodes[2]).toMatchObject({ position: { x: 480, y: 0 }, data: { label: "Rounded", shape: "round" } });
  fireEvent.click(screen.getByRole("button", { name: "Add decision" }));
  expect((onChange.mock.calls[1][0] as Flowchart).nodes[2].data.shape).toBe("decision");
  fireEvent.change(screen.getByLabelText("Flow direction"), { target: { value: "TB" } });
  expect((onChange.mock.calls[2][0] as Flowchart).direction).toBe("TB");
});

test("edits box text and shape, and arrow ends and labels", () => {
  const onChange = vi.fn();
  render(<FlowchartEditor flow={flow} readOnly={false} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Box 1 text"), { target: { value: "Begin" } });
  expect((onChange.mock.calls[0][0] as Flowchart).nodes[0].data.label).toBe("Begin");
  fireEvent.change(screen.getByLabelText("Box 2 shape"), { target: { value: "round" } });
  expect((onChange.mock.calls[1][0] as Flowchart).nodes[1].data.shape).toBe("round");
  fireEvent.change(screen.getByLabelText("Arrow 1 label"), { target: { value: "Yes" } });
  expect((onChange.mock.calls[2][0] as Flowchart).edges[0].label).toBe("Yes");
  fireEvent.change(screen.getByLabelText("Arrow 1 to"), { target: { value: "a" } });
  expect((onChange.mock.calls[3][0] as Flowchart).edges[0].target).toBe("a");
});

test("deleting a box removes its arrows, and the last box stays", () => {
  const onChange = vi.fn();
  const { rerender } = render(<FlowchartEditor flow={flow} readOnly={false} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText("Delete box 1"));
  const left = onChange.mock.calls[0][0] as Flowchart;
  expect(left.nodes.map((node) => node.id)).toEqual(["b"]);
  expect(left.edges).toEqual([]);
  rerender(<FlowchartEditor flow={left} readOnly={false} onChange={onChange} />);
  expect((screen.getByLabelText("Delete box 1") as HTMLButtonElement).disabled).toBe(true);
});

test("draws an arrow when the canvas connects two boxes, and saves a drag", () => {
  const onChange = vi.fn();
  render(<FlowchartEditor flow={flow} readOnly={false} onChange={onChange} />);
  (canvas.props.onConnect as (c: unknown) => void)({ source: "b", target: "a" });
  const connected = onChange.mock.calls[0][0] as Flowchart;
  expect(connected.edges).toHaveLength(2);
  expect(connected.edges[1]).toMatchObject({ source: "b", target: "a", label: "" });
  (canvas.props.onNodesChange as (c: unknown) => void)([{ id: "a", type: "position", dragging: false, position: { x: 10, y: 20 } }]);
  expect((onChange.mock.calls[1][0] as Flowchart).nodes[0].position).toEqual({ x: 10, y: 20 });
});

test("the keyboard delete on the canvas goes through the stored flowchart", () => {
  const onChange = vi.fn();
  render(<FlowchartEditor flow={flow} readOnly={false} onChange={onChange} />);
  (canvas.props.onNodesDelete as (n: unknown) => void)([{ id: "b" }]);
  expect((onChange.mock.calls[0][0] as Flowchart).nodes.map((node) => node.id)).toEqual(["a"]);
  (canvas.props.onEdgesDelete as (n: unknown) => void)([{ id: "e1" }]);
  expect((onChange.mock.calls[1][0] as Flowchart).edges).toEqual([]);
});

test("is view-only for readers", () => {
  const onChange = vi.fn();
  render(<FlowchartEditor flow={flow} readOnly onChange={onChange} />);
  expect(screen.queryByRole("button", { name: /Add/ })).toBeNull();
  expect(screen.queryByLabelText("Delete box 1")).toBeNull();
  expect((screen.getByLabelText("Box 1 text") as HTMLInputElement).readOnly).toBe(true);
  (canvas.props.onConnect as (c: unknown) => void)({ source: "a", target: "b" });
  (canvas.props.onNodesDelete as (n: unknown) => void)([{ id: "a" }]);
  expect(onChange).not.toHaveBeenCalled();
});
