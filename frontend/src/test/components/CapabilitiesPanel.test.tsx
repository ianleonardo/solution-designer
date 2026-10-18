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
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Capability detail" })).toBeTruthy());
  expect(within(screen.getByRole("dialog", { name: "Capability detail" })).getByText(/Processing rules/i)).toBeTruthy();
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
  await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Capability detail" })).getByText("Provides Auth as a Card feature of Payments.")).toBeTruthy());
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
  fireEvent.change(within(dialog).getByLabelText("Country specific behavior"), { target: { value: "Local cutoff" } });
  fireEvent.change(within(dialog).getByLabelText("L1 capability"), { target: { value: "Pay" } });
  fireEvent.change(within(dialog).getByLabelText("L2 capability"), { target: { value: "Card" } });
  fireEvent.change(within(dialog).getByLabelText("L3 capability"), { target: { value: "Hold" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url === "/api/capabilities")).toBe(true));
  expect(JSON.parse(calls.find((call) => call.method === "POST")!.body)).toMatchObject({ country: "", country_behavior: "Local cutoff" });

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
  expect(within(dialog).getByLabelText("Country")).toBeTruthy();
  expect(within(dialog).getByLabelText("System")).toBeTruthy();
  expect(within(dialog).getByLabelText("Excel file")).toBeTruthy();
});
