import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DocumentTabs } from "./DocumentTabs";
import type { LayoutSummary, ProjectDocument } from "../types";

const doc = (id: string, layout: string, name: string): ProjectDocument => ({
  sdd_id: id,
  document_id: id,
  project_id: "p1",
  layout_id: layout,
  name,
  content_json: { sections: {} },
  last_modified: "",
  generated_at: null,
  templates: [],
});

const layout = (id: string, name: string, sections = 3): LayoutSummary => ({
  layout_id: id,
  name,
  description: "",
  is_system: false,
  section_count: sections,
  document_count: 0,
  created_at: "",
  updated_at: "",
});

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof DocumentTabs>[0]> = {}) {
  const props = {
    documents: [doc("d1", "sdd", "Solution Design Document"), doc("d2", "ifc", "Interface Specifications Document")],
    activeId: "d1",
    layouts: [layout("sdd", "Solution Design Document"), layout("ifc", "Interface Specifications Document"), layout("run", "Runbook"), layout("empty", "Empty", 0)],
    canManage: true,
    onSelect: vi.fn(),
    onAdd: vi.fn(async () => undefined),
    onRemove: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<DocumentTabs {...props} />);
  return props;
}

test("shows a tab per document and selects on click", () => {
  const props = setup();
  const tabs = screen.getAllByRole("tab");
  expect(tabs).toHaveLength(2);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(within(tabs[0]).queryByText("Approved")).toBeNull();
  expect(within(tabs[1]).queryByText("Draft")).toBeNull();
  fireEvent.click(tabs[1]);
  expect(props.onSelect).toHaveBeenCalledWith("d2");
});

test("adding offers only layouts that are unused and have sections", async () => {
  const props = setup();
  fireEvent.click(screen.getByRole("button", { name: /Add document/ }));
  const dialog = screen.getByRole("dialog", { name: "Add document" });
  const options = within(dialog).getAllByRole("option").map((option) => option.textContent);
  expect(options).toEqual(["Runbook"]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(props.onAdd).toHaveBeenCalledWith("run"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add document" })).toBeNull());
});

test("removing needs confirmation", async () => {
  const props = setup({ activeId: "d2" });
  fireEvent.click(screen.getByLabelText("Remove Interface Specifications Document"));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(props.onRemove).toHaveBeenCalledWith(expect.objectContaining({ document_id: "d2" })));
});

test("viewers cannot add or remove, and a single document cannot be removed", () => {
  setup({ canManage: false });
  expect(screen.queryByRole("button", { name: /Add document/ })).toBeNull();
  expect(screen.queryByLabelText(/^Remove /)).toBeNull();
  cleanup();
  setup({ documents: [doc("d1", "sdd", "Solution Design Document")] });
  expect(screen.queryByLabelText(/^Remove /)).toBeNull();
});
