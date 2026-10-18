import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LayoutsPage } from "../../../pages/settings/LayoutsPage";
import type { LayoutSummary } from "../../../types";

const layout = (id: string, name: string, extra: Partial<LayoutSummary> = {}): LayoutSummary => ({
  layout_id: id,
  name,
  description: `${name} description`,
  is_system: false,
  section_count: 3,
  document_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  ...extra,
});

let calls: { url: string; method: string; body: string }[];

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/settings/layouts"]}>
      <Routes>
        <Route path="/settings/layouts" element={<LayoutsPage />} />
        <Route path="/settings/layouts/:layoutId" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: String(init?.body ?? "") });
      if (url === "/api/layouts" && method === "POST") {
        return new Response(JSON.stringify({ ...layout("runbook", "Runbook"), templates: [] }), { status: 200 });
      }
      if (method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(
        JSON.stringify([
          layout("sdd", "Solution Design Document", { is_system: true, section_count: 40, document_count: 5 }),
          layout("interface-spec", "Interface Specifications Document", { is_system: true }),
          layout("runbook", "Runbook"),
        ]),
        { status: 200 },
      );
    }),
  );
});
afterEach(cleanup);

test("lists layouts; only custom layouts can be deleted", async () => {
  renderPage();
  await screen.findByText("Runbook");
  expect(screen.queryByText("Built-in")).toBeNull();
  expect(screen.getByText("5 documents")).toBeTruthy();
  expect(screen.queryByLabelText("Delete Solution Design Document")).toBeNull();
  expect(screen.getByLabelText("Delete Runbook")).toBeTruthy();
  expect(screen.getByLabelText("Edit Interface Specifications Document")).toBeTruthy();
});

test("sorts by sections", async () => {
  renderPage();
  await screen.findByText("Runbook");
  fireEvent.click(screen.getByRole("button", { name: /Sections/ }));
  const first = screen.getAllByRole("row")[1];
  expect(within(first).getByText("Interface Specifications Document")).toBeTruthy();
});

test("add layout creates it and opens the editor", async () => {
  renderPage();
  await screen.findByText("Runbook");
  fireEvent.click(screen.getByRole("button", { name: /Add layout/ }));
  const dialog = screen.getByRole("dialog", { name: "Add layout" });
  fireEvent.change(within(dialog).getByLabelText("Document name"), { target: { value: "Runbook" } });
  fireEvent.change(within(dialog).getByLabelText("Start from"), { target: { value: "interface-spec" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create layout" }));
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/settings/layouts/runbook"));
  const post = calls.find((call) => call.method === "POST")!;
  expect(JSON.parse(post.body)).toEqual({ name: "Runbook", description: "", copy_from: "interface-spec" });
});

test("delete asks for confirmation", async () => {
  renderPage();
  await screen.findByText("Runbook");
  fireEvent.click(screen.getByLabelText("Delete Runbook"));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByText("Runbook")).toBeNull());
  expect(calls.some((call) => call.method === "DELETE" && call.url === "/api/layouts/runbook")).toBe(true);
});
