import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LayoutEditorPage } from "../../../pages/settings/LayoutEditorPage";
import type { LayoutDetail, LayoutTemplate } from "../../../types";

const template = (id: string, name: string, order: number, parent: string | null, extra: Partial<LayoutTemplate> = {}): LayoutTemplate => ({
  layout_id: "runbook",
  template_id: id,
  parent_id: parent,
  section_name: name,
  sequence_order: order,
  system_prompt: `Write ${name}`,
  temperature: 0.2,
  max_words: 2000,
  content_kind: "prose",
  blocks: [{ type: "prose" }],
  hint: "",
  ...extra,
});

let detail: LayoutDetail;
let calls: { url: string; method: string; body: string }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("localStorage", { getItem: () => null });
  detail = {
    layout_id: "runbook",
    name: "Runbook",
    description: "Ops",
    is_system: false,
    section_count: 3,
    document_count: 0,
    created_at: "",
    updated_at: "",
    templates: [
      template("runbook--intro", "Intro", 100, null),
      template("runbook--scope", "Scope", 101, "runbook--intro"),
      template("runbook--ops", "Operations", 200, null),
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = String(init?.body ?? "");
      calls.push({ url, method, body });
      if (url.endsWith("/order") && method === "PUT") {
        const sections = JSON.parse(body).sections as { template_id: string; children: { template_id: string; children: never[] }[] }[];
        const order = { n: 0 };
        const flatten = (nodes: typeof sections, parent: string | null): LayoutTemplate[] =>
          nodes.flatMap((node) => {
            order.n += 1;
            return [
              { ...detail.templates.find((item) => item.template_id === node.template_id)!, parent_id: parent, sequence_order: order.n },
              ...flatten(node.children ?? [], node.template_id),
            ];
          });
        detail = { ...detail, templates: flatten(sections, null) };
        return new Response(JSON.stringify(detail), { status: 200 });
      }
      if (url.startsWith("/api/templates/") && method === "PUT") {
        const values = JSON.parse(body);
        const current = detail.templates.find((item) => url.endsWith(item.template_id))!;
        return new Response(
          JSON.stringify({ ...current, section_name: values.section_name, blocks: values.blocks, system_prompt: values.system_prompt, hint: values.hint, max_words: values.max_words }),
          { status: 200 },
        );
      }
      if (url.endsWith("/templates") && method === "POST") {
        const values = JSON.parse(body);
        return new Response(JSON.stringify(template("runbook--new", values.section_name, 300, values.parent_id)), { status: 200 });
      }
      if (method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify(detail), { status: 200 });
    }),
  );
});
afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/settings/layouts/runbook"]}>
      <Routes>
        <Route path="/settings/layouts/:layoutId" element={<LayoutEditorPage />} />
        <Route path="/settings/layouts" element={<p>list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

test("shows the section tree and opens the first section", async () => {
  renderPage();
  const sections = await screen.findByLabelText("Sections");
  expect(within(sections).getByText("Intro")).toBeTruthy();
  expect(within(sections).getByText("Scope")).toBeTruthy();
  expect(within(sections).getByText("Operations")).toBeTruthy();
  const form = screen.getByRole("form", { name: "Section settings" });
  expect((within(form).getByLabelText("Section name") as HTMLInputElement).value).toBe("Intro");
  expect((within(form).getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("Write Intro");
});

test("saving a section sends name, blocks, prompt and limits", async () => {
  renderPage();
  const form = await screen.findByRole("form", { name: "Section settings" });
  fireEvent.change(within(form).getByLabelText("Section name"), { target: { value: "Introduction" } });
  fireEvent.click(within(form).getByRole("button", { name: /Table$/ }));
  fireEvent.change(within(form).getByLabelText("Prompt"), { target: { value: "Custom prompt" } });
  fireEvent.change(within(form).getByLabelText("Max words"), { target: { value: "450" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save section" }));
  await waitFor(() => expect(calls.some((call) => call.method === "PUT" && call.url === "/api/templates/runbook--intro")).toBe(true));
  const call = calls.find((item) => item.url === "/api/templates/runbook--intro")!;
  const sent = JSON.parse(call.body);
  expect(sent.section_name).toBe("Introduction");
  expect(sent.system_prompt).toBe("Custom prompt");
  expect(sent.max_words).toBe(450);
  expect(sent.blocks.map((block: { type: string }) => block.type)).toEqual(["prose", "table"]);
  await screen.findByText("Section saved");
});

function dropOn(name: string, clientY: number) {
  const row = screen.getByRole("button", { name }).parentElement as HTMLElement;
  const rect = new DOMRect(0, 100, 200, 40);
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = () => rect;
  try {
    row.dispatchEvent(new MouseEvent("drop", { bubbles: true, cancelable: true, clientY }));
  } finally {
    HTMLElement.prototype.getBoundingClientRect = original;
  }
}

test("dragging a section onto the edge of a sibling reorders it", async () => {
  renderPage();
  await screen.findByLabelText("Sections");
  fireEvent.dragStart(screen.getByRole("button", { name: "Operations" }));
  dropOn("Intro", 101);
  await waitFor(() => expect(calls.some((call) => call.url === "/api/layouts/runbook/order")).toBe(true));
  const sent = JSON.parse(calls.find((call) => call.url === "/api/layouts/runbook/order")!.body);
  expect(sent.sections).toEqual([
    { template_id: "runbook--ops", children: [] },
    { template_id: "runbook--intro", children: [{ template_id: "runbook--scope", children: [] }] },
  ]);
});

test("dropping a section on another section nests it there", async () => {
  renderPage();
  await screen.findByLabelText("Sections");
  fireEvent.dragStart(screen.getByRole("button", { name: "Operations" }));
  dropOn("Intro", 120);
  await waitFor(() => expect(calls.some((call) => call.url === "/api/layouts/runbook/order")).toBe(true));
  const sent = JSON.parse(calls.find((call) => call.url === "/api/layouts/runbook/order")!.body);
  expect(sent.sections).toEqual([
    {
      template_id: "runbook--intro",
      children: [
        { template_id: "runbook--scope", children: [] },
        { template_id: "runbook--ops", children: [] },
      ],
    },
  ]);
});

test("a sub-section can move to another parent", async () => {
  renderPage();
  await screen.findByLabelText("Sections");
  fireEvent.click(screen.getByRole("button", { name: "Scope" }));
  fireEvent.click(await screen.findByLabelText("Parent section"));
  fireEvent.click(screen.getByRole("option", { name: "Operations" }));
  await waitFor(() => expect(calls.some((call) => call.url === "/api/layouts/runbook/order")).toBe(true));
  const sent = JSON.parse(calls.find((call) => call.url === "/api/layouts/runbook/order")!.body);
  expect(sent.sections[1]).toEqual({ template_id: "runbook--ops", children: [{ template_id: "runbook--scope", children: [] }] });
});

test("a sub-section can be promoted to a main section", async () => {
  renderPage();
  await screen.findByLabelText("Sections");
  fireEvent.click(screen.getByRole("button", { name: "Scope" }));
  fireEvent.click(await screen.findByLabelText("Parent section"));
  fireEvent.click(screen.getByRole("option", { name: "Main section" }));
  await waitFor(() => expect(calls.some((call) => call.url === "/api/layouts/runbook/order")).toBe(true));
  const sent = JSON.parse(calls.find((call) => call.url === "/api/layouts/runbook/order")!.body);
  expect(sent.sections.map((section: { template_id: string }) => section.template_id)).toEqual(["runbook--intro", "runbook--scope", "runbook--ops"]);
  expect(sent.sections[1].children).toEqual([]);
});

test("dropping a section on a sub-section nests it there", async () => {
  renderPage();
  await screen.findByLabelText("Sections");
  fireEvent.dragStart(screen.getByRole("button", { name: "Operations" }));
  fireEvent.drop(screen.getByRole("button", { name: "Scope" }));
  await waitFor(() => expect(calls.some((call) => call.url === "/api/layouts/runbook/order")).toBe(true));
  const sent = JSON.parse(calls.find((call) => call.url === "/api/layouts/runbook/order")!.body);
  expect(sent.sections).toEqual([
    {
      template_id: "runbook--intro",
      children: [{ template_id: "runbook--scope", children: [{ template_id: "runbook--ops", children: [] }] }],
    },
  ]);
});

test("adds a sub-section under the selected sub-section", async () => {
  renderPage();
  await screen.findByLabelText("Sections");
  fireEvent.click(screen.getByRole("button", { name: "Scope" }));
  fireEvent.click(screen.getByRole("button", { name: /Add sub-section/ }));
  const dialog = screen.getByRole("dialog", { name: "Add sub-section to Scope" });
  fireEvent.change(within(dialog).getByLabelText("Section name"), { target: { value: "Goals" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  await screen.findByRole("button", { name: "Goals" });
  const post = calls.find((call) => call.method === "POST")!;
  expect(JSON.parse(post.body)).toMatchObject({ section_name: "Goals", parent_id: "runbook--scope" });
});

test("adds a sub-section under the selected section", async () => {
  renderPage();
  await screen.findByLabelText("Sections");
  fireEvent.click(screen.getByRole("button", { name: /Add sub-section/ }));
  const dialog = screen.getByRole("dialog", { name: "Add sub-section to Intro" });
  fireEvent.change(within(dialog).getByLabelText("Section name"), { target: { value: "Goals" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  await screen.findByRole("button", { name: "Goals" });
  const post = calls.find((call) => call.method === "POST")!;
  expect(JSON.parse(post.body)).toMatchObject({ section_name: "Goals", parent_id: "runbook--intro" });
});

test("deleting a section asks for confirmation", async () => {
  renderPage();
  const form = await screen.findByRole("form", { name: "Section settings" });
  fireEvent.click(within(form).getByRole("button", { name: /Delete section/ }));
  expect(within(screen.getByRole("alertdialog")).getByText(/Documents already created keep their own structure/)).toBeTruthy();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.url === "/api/templates/runbook--intro")).toBe(true));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Scope" })).toBeNull());
});
