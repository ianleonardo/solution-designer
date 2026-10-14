import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import mermaid from "mermaid";
import { DiagramBlock, errorLine, PREVIEW_DELAY_MS } from "./DiagramBlock";
import { MERMAID_TEMPLATES, STARTER_FLOWCHART, STARTER_SEQUENCE } from "../mermaidTemplates";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => ({ diagramType: "flowchart" })),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 800 400" width="100%" style="max-width: 800px;"></svg>' })),
  },
}));

const parse = mermaid.parse as unknown as ReturnType<typeof vi.fn>;
const render_ = mermaid.render as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  parse.mockClear();
  render_.mockClear();
});
afterEach(cleanup);

const text = "flowchart LR\n  A[One] --> B[Two]";
const base = { type: "diagram" as const, sequence: false, mermaid: text };

test("the Mermaid text is edited in a text area and reported as it changes", () => {
  const onChange = vi.fn();
  render(<DiagramBlock block={base} readOnly={false} onChange={onChange} />);
  const textarea = screen.getByLabelText("Mermaid source") as HTMLTextAreaElement;
  expect(textarea.value).toBe(text);
  fireEvent.change(textarea, { target: { value: `${text}\n  B --> C[Three]` } });
  expect(onChange).toHaveBeenCalledWith({ type: "diagram", sequence: false, mermaid: `${text}\n  B --> C[Three]` });
});

test("there is no drawing canvas any more", () => {
  render(<DiagramBlock block={base} readOnly={false} onChange={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Edit Mermaid" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start a new drawing" })).toBeNull();
});

test("a line-number gutter follows the text", () => {
  const { container, rerender } = render(<DiagramBlock block={base} readOnly={false} onChange={vi.fn()} />);
  const gutter = () => container.querySelector('[aria-hidden="true"]')!.textContent;
  expect(gutter()).toBe("12");
  rerender(<DiagramBlock block={{ ...base, mermaid: "a\nb\nc\nd" }} readOnly={false} onChange={vi.fn()} />);
  expect(gutter()).toBe("1234");
});

test("the rendered diagram is shown at half of its natural width", async () => {
  const { container } = render(<DiagramBlock block={base} readOnly={false} onChange={vi.fn()} />);
  await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());
  const svg = container.querySelector("svg")!;
  await waitFor(() => expect(svg.style.width).toBe("400px"));
  expect(svg.style.maxWidth).toBe("100%");
});

test("the preview waits for a pause in typing before redrawing", async () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(<DiagramBlock block={base} readOnly={false} onChange={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    const drawn = render_.mock.calls.length;
    rerender(<DiagramBlock block={{ ...base, mermaid: `${text}\n  B --> C` }} readOnly={false} onChange={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS - 50);
    });
    expect(render_.mock.calls.length).toBe(drawn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(render_.mock.calls.length).toBe(drawn + 1);
    expect(render_.mock.calls.at(-1)?.[1]).toContain("B --> C");
  } finally {
    vi.useRealTimers();
  }
});

test("a syntax error is shown next to the editor and its line is marked", async () => {
  parse.mockRejectedValueOnce(new Error("Parse error on line 2:\n...A --> \n-----^\nExpecting 'SEMI'"));
  const { container } = render(<DiagramBlock block={base} readOnly={false} onChange={vi.fn()} />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Parse error on line 2");
  expect(render_).not.toHaveBeenCalled();
  const marked = container.querySelector('[aria-hidden="true"] .text-alert');
  expect(marked?.textContent).toBe("2");
});

test("the error goes away once the text is fixed", async () => {
  parse.mockRejectedValueOnce(new Error("Parse error on line 1"));
  const { rerender } = render(<DiagramBlock block={{ ...base, mermaid: "nonsense" }} readOnly={false} onChange={vi.fn()} />);
  await screen.findByRole("alert");
  rerender(<DiagramBlock block={base} readOnly={false} onChange={vi.fn()} />);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("errorLine reads the line from a Mermaid message", () => {
  expect(errorLine("Parse error on line 12: x")).toBe(12);
  expect(errorLine("Syntax error in text")).toBeNull();
});

test("a template replaces a starter diagram straight away", () => {
  const onChange = vi.fn();
  render(<DiagramBlock block={{ ...base, mermaid: STARTER_FLOWCHART }} readOnly={false} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Diagram template"), { target: { value: "er" } });
  const er = MERMAID_TEMPLATES.find((item) => item.id === "er")!;
  expect(onChange).toHaveBeenCalledWith({ type: "diagram", sequence: false, mermaid: er.text });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("a template asks before it replaces something that was written", async () => {
  const onChange = vi.fn();
  render(<DiagramBlock block={base} readOnly={false} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Diagram template"), { target: { value: "sequence" } });
  expect(onChange).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog");
  expect(dialog.textContent).toContain("Sequence diagram");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Diagram template"), { target: { value: "sequence" } });
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Replace" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ type: "diagram", sequence: false, mermaid: STARTER_SEQUENCE }));
});

test("every template is valid Mermaid-looking text and the list covers the common diagrams", () => {
  expect(MERMAID_TEMPLATES.map((item) => item.id)).toEqual(["flowchart", "sequence", "class", "state", "er", "gantt", "pie"]);
  for (const template of MERMAID_TEMPLATES) expect(template.text.trim().length).toBeGreaterThan(10);
});

test("syntax help can be opened and closed", () => {
  render(<DiagramBlock block={base} readOnly={false} onChange={vi.fn()} />);
  expect(screen.queryByLabelText("Mermaid syntax help")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Syntax help" }));
  expect(screen.getByLabelText("Mermaid syntax help").textContent).toContain("sequenceDiagram");
  fireEvent.click(screen.getByRole("button", { name: "Hide syntax help" }));
  expect(screen.queryByLabelText("Mermaid syntax help")).toBeNull();
});

test("readers see the diagram and the text but cannot change either", () => {
  render(<DiagramBlock block={base} readOnly onChange={vi.fn()} />);
  expect((screen.getByLabelText("Mermaid source") as HTMLTextAreaElement).readOnly).toBe(true);
  expect(screen.queryByLabelText("Diagram template")).toBeNull();
  expect(screen.queryByRole("button", { name: "Syntax help" })).toBeNull();
});
