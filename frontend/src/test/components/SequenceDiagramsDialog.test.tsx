import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SequenceDiagramsDialog } from "../../components/SequenceDiagramsDialog";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => ({ diagramType: "sequence" })),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 800 400"></svg>' })),
  },
}));

test("each diagram opens a zoomable viewer", () => {
  render(
    <SequenceDiagramsDialog
      diagrams={[
        { id: "d1", title: "Pay flow", mermaid: "sequenceDiagram\n  A->>B: pay" },
        { id: "d2", title: "Refund flow", mermaid: "sequenceDiagram\n  A->>B: refund" },
      ]}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Expand Pay flow" }));
  const viewer = screen.getByRole("dialog", { name: "Diagram viewer" });
  expect(within(viewer).getByRole("heading", { name: "Pay flow" })).toBeTruthy();
  fireEvent.click(within(viewer).getByRole("button", { name: "Zoom in" }));
  expect(within(viewer).getByRole("button", { name: "Reset zoom" }).textContent).toBe("125%");
  fireEvent.click(within(viewer).getByRole("button", { name: "Zoom out" }));
  expect(within(viewer).getByRole("button", { name: "Reset zoom" }).textContent).toBe("100%");
  fireEvent.click(within(viewer).getByRole("button", { name: "Close diagram viewer" }));
  expect(screen.queryByRole("dialog", { name: "Diagram viewer" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Refund flow" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Refund flow" }));
  expect(within(screen.getByRole("dialog", { name: "Diagram viewer" })).getByRole("heading", { name: "Refund flow" })).toBeTruthy();
});
