import { describe, expect, it } from "vitest";
import { DEFAULT_FLOWCHART, defaultFlowchart, flowToMermaid, flowchartToMermaid, mermaidToFlow, mermaidToFlowchart, normalizeFlowchart } from "./flow";

const CHART = ["flowchart TD", "  A[Start] --> B{Is it OK?}", "  B -->|Yes| C(Done)", "  B -- No --> A", "  C --> D --> E"].join("\n");

// These cases mirror backend/tests/test_flow.py: the two converters must agree.
describe("flowchart <-> mermaid", () => {
  it("reads the supported subset", () => {
    const flow = mermaidToFlowchart(CHART)!;
    expect(flow.direction).toBe("TB");
    const shapes = Object.fromEntries(flow.nodes.map((node) => [node.id, [node.data.label, node.data.shape]]));
    expect(shapes.A).toEqual(["Start", "rect"]);
    expect(shapes.B).toEqual(["Is it OK?", "decision"]);
    expect(shapes.C).toEqual(["Done", "round"]);
    expect(shapes.D).toEqual(["D", "rect"]);
    expect(flow.edges.map((edge) => [edge.source, edge.target, edge.label])).toEqual([
      ["A", "B", ""],
      ["B", "C", "Yes"],
      ["B", "A", "No"],
      ["C", "D", ""],
      ["D", "E", ""],
    ]);
  });

  it("round-trips through Mermaid and writes the same text as the backend", () => {
    const flow = mermaidToFlowchart(CHART)!;
    const text = flowchartToMermaid(flow);
    expect(text.split("\n")[0]).toBe("flowchart TB");
    expect(text).toContain('B{"Is it OK?"}');
    expect(text).toContain('C("Done")');
    expect(text).toContain("B -->|Yes| C");
    const again = mermaidToFlowchart(text)!;
    expect(again.nodes.map((node) => [node.id, node.data])).toEqual(flow.nodes.map((node) => [node.id, node.data]));
    expect(again.edges.map((edge) => [edge.source, edge.target, edge.label])).toEqual(flow.edges.map((edge) => [edge.source, edge.target, edge.label]));
  });

  it("lays the default chart out left to right", () => {
    const flow = defaultFlowchart();
    expect(flow.nodes.map((node) => node.id)).toEqual(["Source", "System", "Destination"]);
    expect(flow.nodes.map((node) => node.position.x)).toEqual([0, 240, 480]);
    expect(mermaidToFlowchart(DEFAULT_FLOWCHART)!.edges[0].source).toBe("Source");
  });

  it("ignores edges that loop back when laying out", () => {
    const flow = mermaidToFlowchart("flowchart LR\n A --> B\n B --> C\n C --> A\n B --> X")!;
    const at = Object.fromEntries(flow.nodes.map((node) => [node.id, node.position]));
    expect(at.A).toEqual({ x: 0, y: 0 });
    expect(at.B).toEqual({ x: 240, y: 0 });
    expect(at.C.x).toBe(480);
    expect(at.X).toEqual({ x: 480, y: 110 });
  });

  it("leaves unsupported Mermaid as text", () => {
    for (const source of [
      "flowchart LR\n subgraph s\n A --> B\n end",
      "flowchart LR\n A --> B\n style A fill:#fff",
      "flowchart LR\n A -.-> B",
      "flowchart RL\n A --> B",
      "flowchart LR\n A & B --> C",
      "sequenceDiagram\n A->>B: hi",
      "pie\n a: 1",
      "",
    ]) {
      expect(mermaidToFlowchart(source), source).toBeNull();
    }
  });

  it("tolerates comments and semicolons and keeps quotes", () => {
    const flow = mermaidToFlowchart('graph LR;\n%% a note\n A["Say #quot;hi#quot;"] --> B;')!;
    expect(flow.nodes[0].data.label).toBe('Say "hi"');
    expect(flowchartToMermaid(flow)).toContain('A["Say #quot;hi#quot;"]');
  });

  it("makes text safe for Mermaid", () => {
    const text = flowchartToMermaid({
      direction: "TB",
      nodes: [
        { id: "end", position: { x: 1, y: 2 }, data: { label: 'He said "x"\nnext', shape: "round" } },
        { id: "2nd", position: { x: 0, y: 0 }, data: { label: "", shape: "weird" as never } },
      ],
      edges: [{ id: "e1", source: "end", target: "2nd", label: "a|b" }],
    });
    expect(text).toContain('end_("He said #quot;x#quot; next")');
    expect(text).toContain('n2nd["2nd"]');
    expect(text).toContain("end_ -->|a/b| n2nd");
  });

  it("normalizes stored flowcharts", () => {
    expect(normalizeFlowchart(null)).toBeNull();
    expect(normalizeFlowchart({ nodes: [] })).toBeNull();
    expect(normalizeFlowchart({ nodes: "x" })).toBeNull();
    const clean = normalizeFlowchart({
      direction: "RL",
      nodes: [{ id: "a", position: { x: "1", y: 5 }, data: { label: "A", shape: "decision" } }, { id: "a", data: { label: "dup" } }, { id: 3 }, "junk"],
      edges: [{ source: "a", target: "zzz" }, { source: "a", target: "a", label: "self" }, 7],
    });
    expect(clean).toEqual({
      direction: "LR",
      nodes: [{ id: "a", position: { x: 0, y: 5 }, data: { label: "A", shape: "decision" } }],
      edges: [{ id: "e2", source: "a", target: "a", label: "self" }],
    });
  });
});

describe("sequence text", () => {
  it("is read strictly, like the backend", () => {
    const flow = mermaidToFlow("sequenceDiagram\n  actor U as User\n  U->>Core: Pay\n  Core-->>U: Done")!;
    expect(flow.nodes.map((node) => [node.id, node.data.label, node.data.actor])).toEqual([["U", "User", true], ["Core", "Core", false]]);
    expect(flow.edges.map((edge) => [edge.source, edge.target, edge.data.kind])).toEqual([["U", "Core", "request"], ["Core", "U", "reply"]]);
    for (const source of [
      "sequenceDiagram\n  A->>B: hi\n  Note over A,B: no",
      "sequenceDiagram\n  autonumber\n  A->>B: hi",
      "sequenceDiagram\n  A->>B: hi\n  loop every day\n  B->>A: x\n  end",
      "flowchart LR\n A --> B",
      "",
      "sequenceDiagram",
    ]) {
      expect(mermaidToFlow(source), source).toBeNull();
    }
  });

  it("allows spaces in participant names", () => {
    const text = "sequenceDiagram\n    participant Source System\n    participant Integration Layer\n    Source System->>Integration Layer: Request Data (e.g., Create)\n    Integration Layer-->>Source System: Done";
    const flow = mermaidToFlow(text)!;
    expect(flow.nodes.map((node) => node.id)).toEqual(["Source System", "Integration Layer"]);
    expect(flow.edges.map((edge) => [edge.source, edge.target, edge.label])).toEqual([
      ["Source System", "Integration Layer", "Request Data (e.g., Create)"],
      ["Integration Layer", "Source System", "Done"],
    ]);
    const rewritten = flowToMermaid(flow);
    expect(rewritten).toContain("participant SourceSystem as Source System");
    expect(rewritten).toContain("SourceSystem->>IntegrationLayer: Request Data (e.g., Create)");
  });
});
