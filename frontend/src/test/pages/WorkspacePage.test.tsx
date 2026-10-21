import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => ({ diagramType: "flowchart" })),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 800 400"></svg>' })),
  },
}));
import { AuthProvider } from "../../auth";
import { WorkspacePage } from "../../pages/WorkspacePage";
import type { ProjectDocument, Role, Template, WorkspaceData } from "../../types";

const template = (id: string, layout: string, name: string, order: number): Template => ({
  layout_id: layout,
  template_id: id,
  parent_id: null,
  section_name: name,
  sequence_order: order,
  system_prompt: "p",
  temperature: 0.2,
  max_words: 2000,
  content_kind: "table",
});

const document = (id: string, layout: string, name: string, sectionId: string, sectionName: string, blocks: ProjectDocument["content_json"]["sections"][string]["blocks"]): ProjectDocument => ({
  sdd_id: id,
  document_id: id,
  project_id: "p1",
  layout_id: layout,
  name,
  content_json: { sections: { [sectionId]: { template_id: sectionId, title: sectionName, blocks, missing: [] } } },
  last_modified: "",
  generated_at: null,
  templates: [template(sectionId, layout, sectionName, 100)],
});

let workspace: WorkspaceData;
let sectionsReply: (method: string, url: string, body: string) => ProjectDocument;
let calls: { url: string; method: string; body: string }[];
let prepareWorkspace: ((data: WorkspaceData) => void) | null = null;

function setup(role: Role, path = "/projects/p1") {
  vi.stubGlobal("localStorage", { getItem: () => "token", setItem: () => undefined, removeItem: () => undefined });
  workspace = {
    project: { project_id: "p1", project_name: "Payments", description: "Settlement platform", owner_id: "u", owner_name: "M", owner_role: "Analyst", created_at: "", last_modified: "" },
    documents: [
      document("d1", "sdd", "Solution Design Document", "scope", "Scope", [{ type: "table", columns: ["Item", "Detail"], rows: [["a", "b"]] }]),
      document("d2", "ifc", "Interface Specifications Document", "intro", "Introduction", [
        { type: "header", text: "Interfaces", level: 1 },
        { type: "image", url: "", caption: "Context", alt: "" },
      ]),
    ],
    layouts: [
      { layout_id: "sdd", name: "Solution Design Document", description: "", is_system: true, allow_multiple: false, section_count: 5, document_count: 1, created_at: "", updated_at: "" },
      { layout_id: "ifc", name: "Interface Specifications Document", description: "", is_system: true, allow_multiple: false, section_count: 5, document_count: 1, created_at: "", updated_at: "" },
      { layout_id: "run", name: "Runbook", description: "", is_system: false, allow_multiple: false, section_count: 2, document_count: 0, created_at: "", updated_at: "" },
    ],
    references: [],
  };
  prepareWorkspace?.(workspace);
  prepareWorkspace = null;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: String(init?.body ?? "") });
      if (url === "/api/auth/me") return new Response(JSON.stringify({ user_id: "u", username: "User", login_id: "u", role_name: role, created_at: "" }), { status: 200 });
      if (url === "/api/projects/p1/workspace") return new Response(JSON.stringify(workspace), { status: 200 });
      if (url === "/api/projects/p1/documents" && method === "POST") {
        return new Response(JSON.stringify(document("d3", "run", "Runbook", "ops", "Operations", [{ type: "table", columns: ["Step"], rows: [[""]] }])), { status: 200 });
      }
      if (url.includes("/generate")) {
        const done = { event: "complete", document: workspace.documents[0] };
        return new Response(`data: ${JSON.stringify(done)}\n\n`, { status: 200 });
      }
      if (url.startsWith("/api/projects/p1/documents/d2/sections")) {
        return new Response(JSON.stringify(sectionsReply(method, url, String(init?.body ?? ""))), { status: 200 });
      }
      if (method === "PUT") {
        return new Response(JSON.stringify({ ...workspace.documents[1], content_json: JSON.parse(String(init?.body)).content_json }), { status: 200 });
      }
      if (method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/projects/:projectId" element={<WorkspacePage />} />
          <Route path="/projects/:projectId/documents/:documentId" element={<WorkspacePage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("shows the first document, a read-only description, and no Draft badge, Baselines or Validate", async () => {
  setup("Analyst");
  await screen.findByRole("tablist", { name: "Documents" });
  expect(screen.getByRole("tab", { name: /Solution Design Document/ }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("Settlement platform").tagName).toBe("P");
  expect(screen.queryByText(/Validate Completeness/)).toBeNull();
  expect(screen.queryByText(/Baselines/)).toBeNull();
  expect(screen.queryByText("draft")).toBeNull();
  expect(screen.getByRole("button", { name: /References \(0\)/ })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Scope" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add diagram" })).toBeNull();
});

test("opens the document from the route and switches tabs", async () => {
  setup("Analyst", "/projects/p1/documents/d2");
  expect(await screen.findByRole("heading", { name: "Introduction" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Interface Specifications Document/ }).getAttribute("aria-selected")).toBe("true");
  expect((screen.getByLabelText("Header") as HTMLInputElement).value).toBe("Interfaces");
  expect(screen.getByLabelText("Upload image")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /Solution Design Document/ }));
  expect(await screen.findByRole("heading", { name: "Scope" })).toBeTruthy();
});

test("adds another diagram under the current one and can remove it", async () => {
  const diagram = document("d1", "sdd", "Solution Design Document", "scope", "Scope", [
    { type: "diagram", sequence: false, mermaid: "flowchart LR\n  A-->B" },
  ]);
  diagram.templates[0].blocks = [{ type: "diagram", sequence: false }];
  prepareWorkspace = (data) => {
    data.documents[0] = diagram;
  };
  setup("Analyst");
  await screen.findByRole("heading", { name: "Scope" });
  expect(screen.queryByRole("button", { name: "Remove diagram" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add diagram" }));
  expect(screen.getAllByLabelText("Mermaid source")).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Remove diagram" })).toHaveLength(2);
  await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true), { timeout: 3000 });
  const saved = JSON.parse(calls.find((call) => call.method === "PUT")!.body).content_json.sections.scope.blocks;
  expect(saved.map((block: { type: string }) => block.type)).toEqual(["diagram", "diagram"]);
  fireEvent.click(screen.getAllByRole("button", { name: "Remove diagram" })[1]);
  expect(screen.getAllByLabelText("Mermaid source")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Remove diagram" })).toBeNull();
  await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2), { timeout: 3000 });
});

test("does not offer Add diagram on a section whose layout has no diagram", async () => {
  const prose = document("d1", "sdd", "Solution Design Document", "scope", "Scope", [{ type: "prose", markdown: "Notes" }]);
  prose.templates[0].blocks = [{ type: "prose" }];
  prepareWorkspace = (data) => {
    data.documents[0] = prose;
  };
  setup("Analyst");
  await screen.findByRole("heading", { name: "Scope" });
  expect(screen.queryByRole("button", { name: "Add diagram" })).toBeNull();
});

test("editing a header saves to that document's endpoint", async () => {
  setup("Analyst", "/projects/p1/documents/d2");
  const header = (await screen.findByLabelText("Header")) as HTMLInputElement;
  fireEvent.change(header, { target: { value: "Interface overview" } });
  await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true), { timeout: 3000 });
  const put = calls.find((call) => call.method === "PUT")!;
  expect(put.url).toBe("/api/projects/p1/documents/d2");
  expect(JSON.parse(put.body).content_json.sections.intro.blocks[0].text).toBe("Interface overview");
});

test("adds a document from an unused layout and opens it", async () => {
  setup("Analyst");
  await screen.findByRole("tablist", { name: "Documents" });
  fireEvent.click(screen.getByRole("button", { name: /Add document/ }));
  const dialog = screen.getByRole("dialog", { name: "Add document" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Document type" }));
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.click(screen.getByRole("option", { name: /Runbook/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  expect(await screen.findByRole("heading", { name: "Operations" })).toBeTruthy();
  const post = calls.find((call) => call.url === "/api/projects/p1/documents" && call.method === "POST")!;
  expect(JSON.parse(post.body)).toEqual({ layout_id: "run" });
});

test("readers can browse documents but not manage them", async () => {
  setup("Viewer");
  await screen.findByRole("tablist", { name: "Documents" });
  expect(screen.queryByRole("button", { name: /Add document/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Regenerate All/ })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: /Interface Specifications Document/ }));
  expect((await screen.findByLabelText("Header") as HTMLInputElement).readOnly).toBe(true);
  expect(screen.queryByLabelText("Upload image")).toBeNull();
});

function twoSectionDoc(names: [string, string]): ProjectDocument {
  const base = workspace.documents[1];
  const first = { ...template("intro", "ifc", names[0], 100), blocks: [{ type: "prose" as const }] };
  const second = { ...template("extra", "ifc", names[1], 200), blocks: [{ type: "prose" as const }] };
  return {
    ...base,
    templates: [first, second],
    content_json: {
      sections: {
        intro: { template_id: "intro", title: names[0], blocks: [{ type: "prose", markdown: "one" }], missing: [] },
        extra: { template_id: "extra", title: names[1], blocks: [{ type: "prose", markdown: "two" }], missing: [] },
      },
    },
  };
}

test("only project writers can edit the structure", async () => {
  for (const role of ["Viewer"] as const) {
    setup(role, "/projects/p1/documents/d2");
    await screen.findByRole("heading", { name: "Introduction" });
    expect(screen.queryByRole("button", { name: /Edit structure/ })).toBeNull();
    cleanup();
  }
  setup("Analyst", "/projects/p1/documents/d2");
  await screen.findByRole("heading", { name: "Introduction" });
  expect(screen.getByRole("button", { name: /Edit structure/ })).toBeTruthy();
});

test("renames a section from the outline and shows the new title", async () => {
  setup("Analyst", "/projects/p1/documents/d2");
  sectionsReply = () => ({ ...workspace.documents[1], templates: [{ ...template("intro", "ifc", "Overview", 100) }], content_json: { sections: { intro: { template_id: "intro", title: "Overview", blocks: [{ type: "header", text: "Interfaces", level: 1 }, { type: "image", url: "", caption: "Context", alt: "" }], missing: [] } } } });
  await screen.findByRole("heading", { name: "Introduction" });
  fireEvent.click(screen.getByRole("button", { name: /Edit structure/ }));
  const input = screen.getByLabelText("Section name Introduction");
  fireEvent.change(input, { target: { value: "Overview" } });
  fireEvent.blur(input);
  expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
  const patch = calls.find((call) => call.method === "PATCH")!;
  expect(patch.url).toBe("/api/projects/p1/documents/d2/sections/intro");
  expect(JSON.parse(patch.body)).toEqual({ section_name: "Overview" });
});

test("adds a section with the dialog, opens it, and can move it up", async () => {
  setup("Analyst", "/projects/p1/documents/d2");
  sectionsReply = (method) => (method === "POST" ? twoSectionDoc(["Introduction", "Security"]) : twoSectionDoc(["Security", "Introduction"]));
  await screen.findByRole("heading", { name: "Introduction" });
  fireEvent.click(screen.getByRole("button", { name: /Edit structure/ }));
  fireEvent.click(screen.getByRole("button", { name: /^add Add section$|Add section/ }));
  const dialog = screen.getByRole("dialog", { name: "Add section" });
  fireEvent.change(within(dialog).getByLabelText("Section name"), { target: { value: "Security" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  expect(await screen.findByRole("heading", { name: "Security" })).toBeTruthy();
  const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/sections"))!;
  expect(JSON.parse(post.body)).toMatchObject({ section_name: "Security", parent_id: null, blocks: [{ type: "prose" }] });

  fireEvent.click(screen.getByLabelText("Move up Security"));
  await waitFor(() => expect(calls.some((call) => call.url.endsWith("/sections-order"))).toBe(true));
  const order = calls.find((call) => call.url.endsWith("/sections-order"))!;
  expect(order.method).toBe("PUT");
  expect(JSON.parse(order.body).sections).toEqual([
    { template_id: "extra", children: [] },
    { template_id: "intro", children: [] },
  ]);
});

test("deleting a section asks first, then removes it", async () => {
  setup("Analyst", "/projects/p1/documents/d2");
  sectionsReply = (method) => (method === "DELETE" ? { ...twoSectionDoc(["Introduction", "Security"]), templates: [twoSectionDoc(["Introduction", "Security"]).templates[0]] } : twoSectionDoc(["Introduction", "Security"]));
  await screen.findByRole("heading", { name: "Introduction" });
  fireEvent.click(screen.getByRole("button", { name: /Edit structure/ }));
  fireEvent.click(screen.getByLabelText("Delete Introduction"));
  const confirm = screen.getByRole("alertdialog", { name: "Delete section" });
  expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.url === "/api/projects/p1/documents/d2/sections/intro")).toBe(true));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

test("section settings send the changed blocks and prompt", async () => {
  setup("Analyst", "/projects/p1/documents/d2");
  sectionsReply = () => twoSectionDoc(["Introduction", "Security"]);
  await screen.findByRole("heading", { name: "Introduction" });
  fireEvent.click(screen.getByRole("button", { name: /Edit structure/ }));
  fireEvent.click(screen.getByLabelText("Settings Introduction"));
  const dialog = screen.getByRole("dialog", { name: "Section settings" });
  fireEvent.change(within(dialog).getByLabelText("Section prompt"), { target: { value: "Write it differently" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
  const body = JSON.parse(calls.find((call) => call.method === "PATCH")!.body);
  expect(body.system_prompt).toBe("Write it differently");
  expect(body.section_name).toBe("Introduction");
});

test("the header size can be changed in the document and is saved", async () => {
  setup("Analyst", "/projects/p1/documents/d2");
  const size = await screen.findByRole("button", { name: "Header size" });
  expect(size.textContent).toContain("Large");
  fireEvent.click(size);
  fireEvent.click(screen.getByRole("option", { name: "Small" }));
  await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true), { timeout: 3000 });
  const put = calls.find((call) => call.method === "PUT")!;
  expect(JSON.parse(put.body).content_json.sections.intro.blocks[0]).toMatchObject({ text: "Interfaces", level: 3 });
});

test("viewers cannot change the header size", async () => {
  setup("Viewer", "/projects/p1/documents/d2");
  expect(((await screen.findByRole("button", { name: "Header size" })) as HTMLButtonElement).disabled).toBe(true);
});

test("a writer auto fills one section with an extra instruction", async () => {
  setup("Analyst", "/projects/p1/documents/d2");
  sectionsReply = () => workspace.documents[1];
  await screen.findByRole("heading", { name: "Introduction" });
  fireEvent.click(screen.getByRole("button", { name: /auto_fix_high\s*Auto fill$/ }));
  const dialog = screen.getByRole("dialog", { name: "Auto fill section" });
  expect(within(dialog).queryByRole("alert")).toBeNull();
  fireEvent.change(within(dialog).getByLabelText("Extra instruction"), { target: { value: "  Focus on risk " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Auto fill" }));
  await waitFor(() => expect(calls.some((call) => call.url.endsWith("/sections/intro/regenerate"))).toBe(true));
  const call = calls.find((item) => item.url.endsWith("/sections/intro/regenerate"))!;
  expect(call.method).toBe("POST");
  expect(JSON.parse(call.body)).toEqual({ instruction: "Focus on risk" });
  expect(screen.queryByRole("dialog", { name: "Auto fill section" })).toBeNull();
});

test("auto fill warns before replacing a section that already has content, and can be cancelled", async () => {
  setup("Analyst");
  await screen.findByRole("heading", { name: "Scope" });
  fireEvent.click(screen.getByRole("button", { name: /auto_fix_high\s*Auto fill$/ }));
  const dialog = screen.getByRole("dialog", { name: "Auto fill section" });
  expect(within(dialog).getByRole("alert").textContent).toContain("already has content");
  expect(within(dialog).getByRole("button", { name: "Replace and fill" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Auto fill section" })).toBeNull();
  expect(calls.some((call) => call.url.includes("regenerate"))).toBe(false);
});

test("auto fill for the document fills empty sections only unless told to replace everything", async () => {
  setup("Analyst");
  await screen.findByRole("heading", { name: "Scope" });
  fireEvent.click(screen.getByRole("button", { name: /Auto fill Document/ }));
  let dialog = screen.getByRole("dialog", { name: "Auto fill document" });
  expect((within(dialog).getByLabelText("Fill empty sections only") as HTMLInputElement).checked).toBe(true);
  expect(within(dialog).queryByRole("alert")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Auto fill" }));
  await waitFor(() => expect(calls.some((call) => call.url.includes("/generate"))).toBe(true));
  expect(calls.find((call) => call.url.includes("/generate"))!.url).toBe("/api/projects/p1/documents/d1/generate?only_empty=true");

  await waitFor(() => expect((screen.getByRole("button", { name: /Auto fill Document/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /Auto fill Document/ }));
  dialog = screen.getByRole("dialog", { name: "Auto fill document" });
  fireEvent.click(within(dialog).getByLabelText("Regenerate every section"));
  expect(within(dialog).getByRole("alert").textContent).toContain("including your edits");
  fireEvent.click(within(dialog).getByRole("button", { name: "Replace and fill" }));
  await waitFor(() => expect(calls.filter((call) => call.url.includes("/generate"))).toHaveLength(2));
  expect(calls.filter((call) => call.url.includes("/generate"))[1].url).toBe("/api/projects/p1/documents/d1/generate");
});

test("project readers do not get auto fill", async () => {
  for (const role of ["Viewer"] as const) {
    setup(role);
    await screen.findByRole("heading", { name: "Scope" });
    expect(screen.queryByRole("button", { name: /Auto fill/ })).toBeNull();
    cleanup();
  }
});
