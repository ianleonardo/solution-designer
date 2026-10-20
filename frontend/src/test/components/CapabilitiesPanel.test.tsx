import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { CapabilitiesPanel } from "../../components/CapabilitiesPanel";

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
  expect(screen.queryByText("Lending")).toBeNull();

  fireEvent.click(screen.getByLabelText("Filter by country"));
  fireEvent.click(screen.getByRole("option", { name: "SG" }));
  expect(screen.getByText("Payments")).toBeTruthy();
  expect(screen.queryByText("Lending")).toBeNull();

  fireEvent.click(screen.getByText("Payments"));
  const detail = await screen.findByRole("dialog", { name: "View capability" });
  await within(detail).findByLabelText("Capability system");
  for (const label of ["System", "Applicable for", "L1 capability", "Description", "Country specific behavior", "Sequence diagrams", "Processing rules", "Interfaces", "Tables", "Batches", "Reports"]) {
    expect(within(detail).getByText(label)).toBeTruthy();
  }
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
  await waitFor(() => expect(screen.getByText("Provides Auth as a Card feature of Payments.")).toBeTruthy());
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
  expect(within(screen.getByRole("region", { name: "All countries SPL" })).getAllByText("All countries").length).toBeGreaterThan(0);
  expect(within(screen.getByRole("region", { name: "SG, MY SPL" })).getAllByText("SG, MY").length).toBeGreaterThan(0);

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

test("upload dialog asks for country, system and excel", async () => {
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
  expect(within(dialog).getByLabelText("All countries")).toBeTruthy();
  expect(within(dialog).getByLabelText("SG")).toBeTruthy();
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
      if (url.startsWith("/api/capabilities/c1")) return Promise.resolve(json({ ...capability, interfaces: [], tables: [tableLink], batches: [], reports: [] }));
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
