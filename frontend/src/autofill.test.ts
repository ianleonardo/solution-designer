import { describe, expect, it } from "vitest";
import { sectionIsEmpty } from "./autofill";
import { defaultFlow, defaultFlowchart, flowToMermaid, flowchartToMermaid } from "./flow";
import type { Section, Template } from "./types";

const section = (blocks: Section["blocks"]): Section => ({ template_id: "s", title: "S", blocks, missing: [] });
const template = (blocks: Template["blocks"]): Template => ({
  layout_id: "l",
  template_id: "s",
  parent_id: null,
  section_name: "S",
  sequence_order: 100,
  system_prompt: "",
  temperature: 0.2,
  max_words: 100,
  content_kind: "mixed",
  blocks,
});

// Mirrors backend/tests/test_autofill.py.
describe("sectionIsEmpty", () => {
  it("treats blanks and a missing section as empty", () => {
    expect(sectionIsEmpty(undefined)).toBe(true);
    expect(sectionIsEmpty(section([{ type: "prose", markdown: "  " }, { type: "header", text: "H", level: 1 }, { type: "image", url: "", caption: "", alt: "" }]))).toBe(true);
  });

  it("sees written prose and uploaded images", () => {
    expect(sectionIsEmpty(section([{ type: "prose", markdown: " text " }]))).toBe(false);
    expect(sectionIsEmpty(section([{ type: "image", url: "/api/projects/p/images/a.png", caption: "", alt: "" }]))).toBe(false);
  });

  it("ignores the starter rows of a table but sees edits", () => {
    const starter = template([{ type: "table", columns: ["SN", "NFR", "Requirement"], rows: [["1", "Peak load", ""]] }]);
    const columns = ["SN", "NFR", "Requirement"];
    expect(sectionIsEmpty(section([{ type: "table", columns, rows: [["1", "Peak load", ""]] }]), starter)).toBe(true);
    expect(sectionIsEmpty(section([{ type: "table", columns, rows: [["1", "Peak load", "800"]] }]), starter)).toBe(false);
    expect(sectionIsEmpty(section([{ type: "table", columns, rows: [["1", "Peak load", ""]] }]))).toBe(false);
    expect(sectionIsEmpty(section([{ type: "table", columns, rows: [["", "", ""]] }]))).toBe(true);
  });

  it("ignores the starter diagrams but sees real ones", () => {
    const chart = defaultFlowchart();
    expect(sectionIsEmpty(section([{ type: "diagram", sequence: false, mermaid: flowchartToMermaid(chart), flow: chart }]))).toBe(true);
    const sequence = defaultFlow();
    expect(sectionIsEmpty(section([{ type: "diagram", sequence: true, mermaid: flowToMermaid(sequence), flow: sequence }]))).toBe(true);
    expect(sectionIsEmpty(section([{ type: "diagram", sequence: false, mermaid: "flowchart LR\n  A[Mine] --> B[Yours]", flow: null }]))).toBe(false);
  });
});
