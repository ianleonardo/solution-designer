import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { CapabilitiesPanel } from "../../components/CapabilitiesPanel";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => ({ diagramType: "sequence" })),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 800 400"></svg>' })),
  },
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <CapabilitiesPanel />
    </MemoryRouter>,
  );
}

const capability = {
  capability_id: "c1",
  country: "SG",
  system_code: "SPL",
  l1_capability: "Payments",
  l2_capability: "Card",
  l3_capability: "Auth",
  description: "Payments > Card > Auth",
  processing_rules: "",
  created_at: "2026-10-17T00:00:00",
  last_modified: "2026-10-17T00:00:00",
};

const myCapability = {
  ...capability,
  capability_id: "c2",
  country: "MY",
  system_code: "DGE",
  l1_capability: "Lending",
  l2_capability: "Origination",
  l3_capability: "Apply",
  description: "MY only",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("lists capabilities and filters by country", async () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: ["EAI"] }));
      if (url === "/api/systems")
        return Promise.resolve(
          json([
            { system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true },
            { system_code: "DGE", system_name: "DGE", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true },
          ]),
        );
      if (url === "/api/capabilities") return Promise.resolve(json([capability, myCapability]));
      if (url.startsWith("/api/capabilities/c1"))
        return Promise.resolve(json({ ...capability, interfaces: [], tables: [], batches: [], reports: [] }));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  await waitFor(() => expect(screen.getByText("Payments")).toBeTruthy());
  expect(screen.getByRole("tab", { name: "SG", selected: true })).toBeTruthy();
  expect(screen.queryByText("Lending")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "MY" }));
  await waitFor(() => expect(screen.getByText("Lending")).toBeTruthy());
  expect(screen.queryByText("Payments")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "SG" }));
  await waitFor(() => expect(screen.getByText("Payments")).toBeTruthy());

  fireEvent.click(screen.getByText("Payments"));
  const detail = await screen.findByRole("dialog", { name: "View capability" });
  await within(detail).findByLabelText("Capability system");
  for (const label of ["System", "Applicable for", "L1 capability", "Description", "Country specific behavior", "Diagrams", "Processing rules", "Interfaces", "Tables", "Batches", "Reports"]) {
    expect(within(detail).getByText(label)).toBeTruthy();
  }
  expect(within(detail).getByRole("button", { name: "Markdown" })).toBeTruthy();
  expect(within(detail).getByRole("button", { name: "PDF" })).toBeTruthy();
});

test("view hierarchy expands one branch at a time and opens the L3 detail", async () => {
  const transfer = { ...capability, capability_id: "c3", l2_capability: "Transfer", l3_capability: "Send" };
  const accounts = { ...capability, capability_id: "c4", l1_capability: "Accounts", l2_capability: "Savings", l3_capability: "Open" };
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true }]));
      if (url === "/api/capabilities") return Promise.resolve(json([capability, transfer, accounts, myCapability]));
      if (url.startsWith("/api/capabilities/c3")) return Promise.resolve(json({ ...transfer, interfaces: [], tables: [], batches: [], reports: [] }));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: /View Hierarchy/ }));
  const tree = screen.getByRole("dialog", { name: "Capability hierarchy" });
  expect(within(tree).getByText("SPL Core")).toBeTruthy();
  expect(within(tree).getByRole("button", { name: /Payments/ })).toBeTruthy();
  expect(within(tree).getByRole("button", { name: /Accounts/ })).toBeTruthy();
  expect(within(tree).queryByText("Lending")).toBeNull();
  expect(within(tree).queryByRole("button", { name: /Card/ })).toBeNull();
  expect(within(tree).queryByRole("button", { name: /Auth/ })).toBeNull();

  fireEvent.click(within(tree).getByRole("button", { name: /Payments/ }));
  expect(within(tree).getByRole("button", { name: /Card/ })).toBeTruthy();
  expect(within(tree).getByRole("button", { name: /Transfer/ })).toBeTruthy();
  expect(within(tree).queryByRole("button", { name: /Auth/ })).toBeNull();

  fireEvent.click(within(tree).getByRole("button", { name: /Accounts/ }));
  expect(within(tree).queryByRole("button", { name: /Card/ })).toBeNull();
  expect(within(tree).getByRole("button", { name: /Savings/ })).toBeTruthy();

  fireEvent.click(within(tree).getByRole("button", { name: /Payments/ }));
  fireEvent.click(within(tree).getByRole("button", { name: /Card/ }));
  expect(within(tree).getByRole("button", { name: /Auth/ })).toBeTruthy();
  expect(within(tree).queryByRole("button", { name: /Send/ })).toBeNull();

  fireEvent.click(within(tree).getByRole("button", { name: /Transfer/ }));
  expect(within(tree).queryByRole("button", { name: /Auth/ })).toBeNull();
  fireEvent.click(within(tree).getByRole("button", { name: /Send/ }));
  const detail = await screen.findByRole("dialog", { name: "View capability" });
  expect(await within(detail).findByDisplayValue("Send")).toBeTruthy();
});

test("shows a short description when description is empty", async () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: false }]));
      if (url === "/api/capabilities") return Promise.resolve(json([{ ...capability, description: "" }]));
      if (url.startsWith("/api/capabilities/c1"))
        return Promise.resolve(json({ ...capability, description: "", interfaces: [], tables: [], batches: [], reports: [] }));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  await waitFor(() => expect(screen.getByText("Provides auth as a card feature of payments.")).toBeTruthy());
  fireEvent.click(screen.getByText("Payments"));
  const detail = await screen.findByRole("dialog", { name: "View capability" });
  await waitFor(() => expect((within(detail).getByLabelText("Capability description") as HTMLInputElement).value).toBe("Provides Auth as a Card feature of Payments."));
});

test("applicable for lists every country, and the form saves all countries or a selection", async () => {
  const rows = [
    capability,
    { ...capability, capability_id: "c-all", country: "", l3_capability: "Everywhere", description: "Applies everywhere" },
    { ...capability, capability_id: "c-both", country: "SG,MY", l3_capability: "Regional", description: "Two countries" },
  ];
  const calls: { url: string; method: string; body: string }[] = [];
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: String(init?.body ?? "") });
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true }]));
      if (url === "/api/capabilities" && method === "POST") return Promise.resolve(json({ ...capability, capability_id: "new", ...(JSON.parse(String(init?.body)) as object) }));
      if (url === "/api/capabilities") return Promise.resolve(json(rows));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  await waitFor(() => expect(screen.getByText("Everywhere")).toBeTruthy());
  expect(screen.getByText("Regional")).toBeTruthy();
  expect(screen.queryByRole("columnheader", { name: "Applicable for" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /Add capability/ }));
  const dialog = screen.getByRole("dialog", { name: "Add capability" });
  expect(within(dialog).getByLabelText("Capability system")).toBeTruthy();
  expect((within(dialog).getByLabelText("SG") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByLabelText("All countries"));
  expect((within(dialog).getByLabelText("SG") as HTMLInputElement).checked).toBe(false);
  expect(within(dialog).getByLabelText("Country specific behavior")).toBeTruthy();
  expect(within(dialog).getByRole("heading", { name: "Interfaces" })).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("L1 capability"), { target: { value: "Pay" } });
  fireEvent.change(within(dialog).getByLabelText("L2 capability"), { target: { value: "Card" } });
  fireEvent.change(within(dialog).getByLabelText("L3 capability"), { target: { value: "Hold" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url === "/api/capabilities")).toBe(true));
  expect(JSON.parse(calls.find((call) => call.method === "POST")!.body)).toMatchObject({ country: "" });

  fireEvent.click(screen.getByRole("button", { name: /Add capability/ }));
  const again = screen.getByRole("dialog", { name: "Add capability" });
  fireEvent.click(within(again).getByLabelText("MY"));
  fireEvent.change(within(again).getByLabelText("L1 capability"), { target: { value: "Pay" } });
  fireEvent.change(within(again).getByLabelText("L2 capability"), { target: { value: "Card" } });
  fireEvent.change(within(again).getByLabelText("L3 capability"), { target: { value: "Both" } });
  fireEvent.click(within(again).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(calls.filter((call) => call.method === "POST" && call.url === "/api/capabilities")).toHaveLength(2));
  const second = calls.filter((call) => call.method === "POST" && call.url === "/api/capabilities")[1];
  expect(JSON.parse(second.body).country).toBe("SG,MY");
});

test("upload dialog asks for system and excel", async () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(
          json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true }]),
        );
      if (url === "/api/capabilities") return Promise.resolve(json([]));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  await waitFor(() => expect(screen.getByRole("button", { name: /Upload$/ })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Upload$/ }));
  const dialog = screen.getByRole("dialog", { name: "Upload capabilities" });
  expect(within(dialog).queryByLabelText("All countries")).toBeNull();
  expect(within(dialog).getByText(/COUNTRY is comma-separated/)).toBeTruthy();
  expect(within(dialog).getByLabelText("System")).toBeTruthy();
  expect(within(dialog).getByLabelText("Excel file")).toBeTruthy();
});

test("shows table columns and offers tables, batches and reports for the selected countries", async () => {
  const tableLink = {
    table_id: "t-sg",
    country: "SG",
    database_name: "PIB",
    schema_name: "DBO",
    table_name: "ACCT",
    description: "Accounts",
  };
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: ["EAI"] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true }]));
      if (url === "/api/capabilities") return Promise.resolve(json([capability]));
      if (url.startsWith("/api/capabilities/c1"))
        return Promise.resolve(
          json({
            ...capability,
            interfaces: [],
            tables: [tableLink],
            batches: [{ batch_id: "b-sg", country: "SG", system_code: "SPL", batch_name: "Nightly SG", batch_type: "incoming", description: "" }],
            reports: [{ report_id: "r-sg", country: "SG", system_code: "SPL", report_name: "SG Daily", description: "" }],
          }),
        );
      if (url === "/api/batches/b-sg")
        return Promise.resolve(
          json({
            batch_id: "b-sg",
            country: "SG",
            system_code: "SPL",
            batch_name: "Nightly SG",
            batch_type: "incoming",
            frequency: "Daily",
            frequency_other: "",
            to_from_systems: "DGE",
            description: "Nightly settlement",
            batch_filename: "settle.in",
            file_layout: "Col A | Col B",
            created_at: "",
            last_modified: "",
          }),
        );
      if (url === "/api/reports/r-sg")
        return Promise.resolve(
          json({
            report_id: "r-sg",
            country: "SG",
            system_code: "SPL",
            report_code: "R1",
            report_name: "SG Daily",
            frequency: "Daily",
            frequency_other: "",
            description: "End of day",
            layout: "Account | Balance",
            created_at: "",
            last_modified: "",
          }),
        );
      if (url === "/api/tables/t-sg")
        return Promise.resolve(
          json({
            ...tableLink,
            column_count: 1,
            created_at: "",
            last_modified: "",
            columns: [
              {
                column_id: "col1",
                table_id: "t-sg",
                column_name: "ACCT_NO",
                data_type: "VARCHAR",
                is_null: "N",
                primary_key: "Y",
                foreign_key: "",
                description: "Account number",
                created_at: "",
                last_modified: "",
              },
            ],
          }),
        );
      if (url === "/api/tables")
        return Promise.resolve(
          json([
            { ...tableLink, column_count: 1, created_at: "", last_modified: "" },
            { table_id: "t-my", country: "MY", database_name: "PIB", schema_name: "DBO", table_name: "LOAN", description: "", column_count: 0, created_at: "", last_modified: "" },
          ]),
        );
      if (url === "/api/batches")
        return Promise.resolve(
          json([
            { batch_id: "b-sg", country: "SG", system_code: "SPL", batch_name: "Nightly SG", batch_type: "Inbound", frequency: "", frequency_other: "", to_from_systems: "", description: "", batch_filename: "", file_layout: "", created_at: "", last_modified: "" },
            { batch_id: "b-my", country: "MY", system_code: "SPL", batch_name: "Nightly MY", batch_type: "Inbound", frequency: "", frequency_other: "", to_from_systems: "", description: "", batch_filename: "", file_layout: "", created_at: "", last_modified: "" },
          ]),
        );
      if (url === "/api/reports")
        return Promise.resolve(
          json([
            { report_id: "r-sg", country: "SG", system_code: "SPL", report_code: "R1", report_name: "SG Daily", frequency: "", frequency_other: "", description: "", layout: "", created_at: "", last_modified: "" },
            { report_id: "r-my", country: "MY", system_code: "SPL", report_code: "R2", report_name: "MY Daily", frequency: "", frequency_other: "", description: "", layout: "", created_at: "", last_modified: "" },
          ]),
        );
      if (url.startsWith("/api/interfaces/")) return Promise.resolve(json([]));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  await waitFor(() => expect(screen.getByText("Payments")).toBeTruthy());
  fireEvent.click(screen.getByText("Payments"));
  const detail = await screen.findByRole("dialog", { name: "View capability" });
  fireEvent.click(await within(detail).findByRole("button", { name: "PIB.DBO.ACCT" }));
  const table = await screen.findByRole("dialog", { name: "Table ACCT" });
  expect(await within(table).findByText("ACCT_NO")).toBeTruthy();
  expect(within(table).getByText("VARCHAR")).toBeTruthy();
  expect(within(table).getByText("Account number")).toBeTruthy();

  fireEvent.click(within(detail).getByRole("button", { name: "SPL · Nightly SG" }));
  const batch = await screen.findByRole("dialog", { name: "Batch Nightly SG" });
  expect(await within(batch).findByText("settle.in")).toBeTruthy();
  expect(within(batch).getByText("Col A | Col B")).toBeTruthy();
  fireEvent.click(within(batch).getByRole("button", { name: "Close" }));

  fireEvent.click(within(detail).getByRole("button", { name: "SPL · SG Daily" }));
  const report = await screen.findByRole("dialog", { name: "Report SG Daily" });
  expect(await within(report).findByText("Account | Balance")).toBeTruthy();
  expect(within(report).getByText("End of day")).toBeTruthy();
  fireEvent.click(within(report).getByRole("button", { name: "Close" }));

  fireEvent.click(screen.getByRole("button", { name: /Add capability/ }));
  const add = screen.getByRole("dialog", { name: "Add capability" });
  fireEvent.click(within(add).getByRole("button", { name: "Add tables" }));
  const tablePicker = await screen.findByRole("dialog", { name: "Link tables" });
  expect(await within(tablePicker).findByText("ACCT")).toBeTruthy();
  expect(within(tablePicker).queryByText("LOAN")).toBeNull();
  fireEvent.click(within(tablePicker).getByRole("button", { name: "Cancel" }));

  fireEvent.click(within(add).getByRole("button", { name: "Add batches" }));
  const batchPicker = await screen.findByRole("dialog", { name: "Link batches" });
  expect(await within(batchPicker).findByText("Nightly SG")).toBeTruthy();
  expect(within(batchPicker).queryByText("Nightly MY")).toBeNull();
  fireEvent.click(within(batchPicker).getByRole("button", { name: "Cancel" }));

  fireEvent.click(within(add).getByRole("button", { name: "Add reports" }));
  const reportPicker = await screen.findByRole("dialog", { name: "Link reports" });
  expect(await within(reportPicker).findByText("SG Daily")).toBeTruthy();
  expect(within(reportPicker).queryByText("MY Daily")).toBeNull();
});

test("link picker is a searchable table that links several items at once", async () => {
  const batch = (batch_id: string, batch_name: string, country = "SG") => ({
    batch_id, country, system_code: "SPL", batch_name, batch_type: "incoming", frequency: "", frequency_other: "",
    to_from_systems: "", description: "", batch_filename: "", file_layout: "", created_at: "", last_modified: "",
  });
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: ["EAI"] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true }]));
      if (url === "/api/capabilities") return Promise.resolve(json([capability]));
      if (url === "/api/batches")
        return Promise.resolve(json([batch("b1", "Nightly GL"), batch("b2", "Nightly Cards"), batch("b3", "Month-end Close"), batch("b4", "Nightly MY", "MY")]));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  await waitFor(() => expect(screen.getByText("Payments")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Add capability/ }));
  const add = screen.getByRole("dialog", { name: "Add capability" });
  fireEvent.click(within(add).getByRole("button", { name: "Add batches" }));
  const picker = await screen.findByRole("dialog", { name: "Link batches" });
  expect(await within(picker).findByText("Month-end Close")).toBeTruthy();
  expect(within(picker).queryByText("Nightly MY")).toBeNull();

  fireEvent.change(within(picker).getByRole("searchbox", { name: "Search batches" }), { target: { value: "nightly" } });
  expect(within(picker).queryByText("Month-end Close")).toBeNull();
  fireEvent.click(within(picker).getByRole("checkbox", { name: "Select all 2 shown" }));
  expect(within(picker).getByText("2 of 3 shown · 2 selected")).toBeTruthy();
  fireEvent.click(within(picker).getByRole("button", { name: "Link 2 selected" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Link batches" })).toBeNull());
  expect(within(add).getByText("SPL · Nightly GL")).toBeTruthy();
  expect(within(add).getByText("SPL · Nightly Cards")).toBeTruthy();
  expect(within(add).queryByText("SPL · Month-end Close")).toBeNull();
});

test("each capability diagram opens a zoomable viewer", async () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: ["EAI"] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true }]));
      if (url === "/api/capabilities") return Promise.resolve(json([capability]));
      if (url.startsWith("/api/capabilities/c1"))
        return Promise.resolve(
          json({
            ...capability,
            sequence_diagrams: [
              { id: "d1", title: "Pay flow", mermaid: "sequenceDiagram\n  A->>B: pay" },
              { id: "d2", title: "Refund flow", mermaid: "sequenceDiagram\n  A->>B: refund" },
            ],
            interfaces: [],
            tables: [],
            batches: [],
            reports: [],
          }),
        );
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  fireEvent.click(await screen.findByText("Payments"));
  const detail = await screen.findByRole("dialog", { name: "View capability" });
  expect(await within(detail).findByRole("button", { name: "Expand Pay flow" })).toBeTruthy();
  expect(within(detail).getByRole("button", { name: "Expand Refund flow" })).toBeTruthy();

  fireEvent.click(within(detail).getByRole("button", { name: "Expand Pay flow" }));
  const viewer = screen.getByRole("dialog", { name: "Diagram viewer" });
  expect(within(viewer).getByRole("heading", { name: "Pay flow" })).toBeTruthy();
  fireEvent.click(within(viewer).getByRole("button", { name: "Zoom in" }));
  expect(within(viewer).getByRole("button", { name: "Reset zoom" }).textContent).toBe("125%");
  fireEvent.click(within(viewer).getByRole("button", { name: "Close diagram viewer" }));
  expect(screen.queryByRole("dialog", { name: "Diagram viewer" })).toBeNull();
});

test("a linked interface opens its specification", async () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG"], databases: [], interface_channels: ["SPL"] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true }]));
      if (url === "/api/capabilities") return Promise.resolve(json([capability]));
      if (url.startsWith("/api/capabilities/c1"))
        return Promise.resolve(
          json({
            ...capability,
            interfaces: [
              {
                interface_id: "i1",
                channel: "SPL",
                country: "SG",
                interface_name: "Balance API",
                endpoint: "/balance",
                description: "Get balance",
                protocol: "API",
                source: "SPL",
                destination: "DGE",
              },
            ],
            tables: [],
            batches: [],
            reports: [],
          }),
        );
      if (url === "/api/interfaces/SPL/i1")
        return Promise.resolve(
          json({
            interface_id: "i1",
            channel: "SPL",
            country: "SG",
            interface_name: "Balance API",
            endpoint: "/balance",
            description: "Get balance",
            protocol: "API",
            source: "SPL",
            destination: "DGE",
            processing_rules: "Return the ledger balance.",
            validation_rules: "",
            fields: [
              { field_id: "f1", direction: "request", position: 0, field_path: "account.currency", field_type: "string", required: "Y", length: "3", validation: "ISO currency", description: "Currency", example: "SGD" },
            ],
          }),
        );
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  fireEvent.click(await screen.findByText("Payments"));
  const detail = await screen.findByRole("dialog", { name: "View capability" });
  fireEvent.click(await within(detail).findByRole("button", { name: "SPL · Balance API" }));
  const spec = await screen.findByRole("dialog", { name: "Interface specification" });
  expect(await within(spec).findByText("account.currency")).toBeTruthy();
  expect(within(spec).getByText("ISO currency")).toBeTruthy();
  expect(within(spec).getByText("Return the ledger balance.")).toBeTruthy();
  expect(within(spec).getByText("No validation rules.")).toBeTruthy();
});
