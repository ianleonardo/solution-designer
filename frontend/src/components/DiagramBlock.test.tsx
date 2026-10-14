import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DiagramBlock } from "./DiagramBlock";
import { mermaidToFlow, mermaidToFlowchart } from "../flow";

vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 800 400" width="100%" style="max-width: 800px;"></svg>' })) } }));
vi.mock("./SequenceEditor", () => ({
  SequenceEditor: ({ flow }: { flow: { nodes: unknown[] } }) => <p>sequence drawing with {flow.nodes.length} participants</p>,
}));
vi.mock("./FlowchartEditor", () => ({
  FlowchartEditor: ({ flow, onChange }: { flow: { nodes: unknown[] }; onChange: (flow: unknown) => void }) => (
    <button onClick={() => onChange({ ...flow, direction: "TB" })}>drawing with {flow.nodes.length} boxes</button>
  ),
}));

afterEach(cleanup);

const text = "flowchart LR\n  A[One] --> B[Two]";
const base = { type: "diagram" as const, sequence: false, mermaid: text, flow: mermaidToFlowchart(text) };

test("shows the drawing editor and rewrites the Mermaid text when it changes", () => {
  const onChange = vi.fn();
  render(<DiagramBlock block={base} readOnly={false} onChange={onChange} />);
  fireEvent.click(screen.getByText("drawing with 2 boxes"));
  expect(onChange.mock.calls[0][0].mermaid).toContain("flowchart TB");
  expect(screen.queryByLabelText("Mermaid source")).toBeNull();
});

test("editing the Mermaid text re-reads the drawing and keeps dragged positions", () => {
  const onChange = vi.fn();
  const dragged = { ...base.flow!, nodes: base.flow!.nodes.map((node) => ({ ...node, position: { x: 7, y: 9 } })) };
  render(<DiagramBlock block={{ ...base, flow: dragged }} readOnly={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Mermaid" }));
  fireEvent.change(screen.getByLabelText("Mermaid source"), { target: { value: `${text}\n  B --> C[Three]` } });
  const next = onChange.mock.calls[0][0];
  expect(next.flow.nodes.map((node: { id: string }) => node.id)).toEqual(["A", "B", "C"]);
  expect(next.flow.nodes[0].position).toEqual({ x: 7, y: 9 });
  expect(next.flow.nodes[2].position).not.toEqual({ x: 7, y: 9 });
});

test("unsupported Mermaid falls back to text only with a notice", () => {
  const onChange = vi.fn();
  const odd = "flowchart LR\n subgraph s\n A --> B\n end";
  render(<DiagramBlock block={{ ...base, mermaid: odd, flow: null }} readOnly={false} onChange={onChange} />);
  expect(screen.getByRole("note").textContent).toContain("edited as text");
  expect((screen.getByLabelText("Mermaid source") as HTMLTextAreaElement).value).toBe(odd);
  fireEvent.change(screen.getByLabelText("Mermaid source"), { target: { value: text } });
  expect(onChange.mock.calls[0][0].flow.nodes).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Start a new drawing" }));
  expect(onChange.mock.calls[1][0].flow.nodes).toHaveLength(3);
  expect(onChange.mock.calls[1][0].mermaid).toContain("Source");
});

test("readers cannot restart a text-only diagram", () => {
  render(<DiagramBlock block={{ ...base, flow: null }} readOnly onChange={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Start a new drawing" })).toBeNull();
});

test("the rendered diagram is shown at half of its natural width", async () => {
  const { container } = render(<DiagramBlock block={base} readOnly={false} onChange={vi.fn()} />);
  await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());
  const svg = container.querySelector("svg")!;
  await waitFor(() => expect(svg.style.width).toBe("400px"));
  expect(svg.style.maxWidth).toBe("100%");
});

const sequenceText = "sequenceDiagram\n  participant Source System\n  participant Core\n  Source System->>Core: Pay";

test("the Mermaid script of a sequence diagram can be edited and redraws the participants", () => {
  const onChange = vi.fn();
  const block = { type: "diagram" as const, sequence: true, mermaid: sequenceText, flow: mermaidToFlow(sequenceText) };
  render(<DiagramBlock block={block} readOnly={false} onChange={onChange} />);
  expect(screen.getByText("sequence drawing with 2 participants")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit Mermaid" }));
  const textarea = screen.getByLabelText("Mermaid source") as HTMLTextAreaElement;
  expect(textarea.value).toBe(sequenceText);
  fireEvent.change(textarea, { target: { value: `${sequenceText}\n  Core-->>Source System: Done` } });
  const next = onChange.mock.calls[0][0];
  expect(next.mermaid).toContain("Core-->>Source System: Done");
  expect(next.flow.edges).toHaveLength(2);
});

test("an unreadable sequence script falls back to text only and can start a new drawing", () => {
  const onChange = vi.fn();
  const odd = "sequenceDiagram\n  A->>B: hi\n  Note over A,B: careful";
  render(<DiagramBlock block={{ type: "diagram", sequence: true, mermaid: odd, flow: null }} readOnly={false} onChange={onChange} />);
  expect(screen.getByRole("note").textContent).toContain("edited as text");
  fireEvent.change(screen.getByLabelText("Mermaid source"), { target: { value: "sequenceDiagram\n  A->>B: hi" } });
  expect(onChange.mock.calls[0][0].flow.nodes).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Start a new drawing" }));
  expect(onChange.mock.calls[1][0].mermaid).toContain("participant");
  expect(onChange.mock.calls[1][0].flow.edges).toHaveLength(2);
});
