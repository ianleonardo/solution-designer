import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { BatchesPanel } from "../../components/BatchesPanel";

function renderPanel() {
  return render(
    <MemoryRouter>
      <BatchesPanel />
    </MemoryRouter>,
  );
}

const batch = {
  batch_id: "b1",
  country: "SG",
  system_code: "SPL",
  batch_name: "Nightly Settlement",
  batch_type: "incoming",
  to_from_systems: "CORE",
  description: "Settle cards",
  batch_filename: "settle.in",
  file_layout: "Col A | Col B",
  created_at: "2026-10-17T00:00:00",
  last_modified: "2026-10-17T00:00:00",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const myBatch = {
  ...batch,
  batch_id: "b2",
  country: "MY",
  system_code: "DGE",
  batch_name: "Malaysia Feed",
  batch_type: "outgoing",
  to_from_systems: "",
  description: "MY only",
};

test("lists batches by country and system and opens detail", async () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(
          json([
            { system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: true, has_report: false, has_capability: false },
            { system_code: "DGE", system_name: "DGE", description: "", upstreams: "", downstreams: "", has_batch: true, has_report: false, has_capability: false },
          ]),
        );
      if (url === "/api/batches") return Promise.resolve(json([batch, myBatch]));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  await waitFor(() => expect(screen.getByText("Nightly Settlement")).toBeTruthy());
  expect(screen.getByText("Incoming")).toBeTruthy();
  expect(screen.queryByText("Outgoing")).toBeNull();
  expect(screen.getByText("CORE")).toBeTruthy();
  expect(screen.getByText("Settle cards")).toBeTruthy();
  expect(screen.queryByText("Malaysia Feed")).toBeNull();

  expect(screen.getByRole("tab", { name: "SG", selected: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "MY" }));
  await waitFor(() => expect(screen.getByText("Malaysia Feed")).toBeTruthy());
  expect(screen.queryByText("Nightly Settlement")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "SG" }));
  await waitFor(() => expect(screen.getByText("Nightly Settlement")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Search Batches"), { target: { value: "Settlement" } });
  expect(screen.getByText("Nightly Settlement")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search Batches"), { target: { value: "zzzz" } });
  expect(screen.queryByText("Nightly Settlement")).toBeNull();
  fireEvent.change(screen.getByLabelText("Search Batches"), { target: { value: "" } });

  fireEvent.click(screen.getByRole("button", { name: "Nightly Settlement" }));
  const dialog = screen.getByRole("dialog", { name: "Batch Nightly Settlement" });
  expect(within(dialog).getByText(/To\/From:/)).toBeTruthy();
  expect(within(dialog).getByText("CORE")).toBeTruthy();
  expect(within(dialog).getByText("settle.in")).toBeTruthy();
  expect(within(dialog).getByText("Col A | Col B")).toBeTruthy();
});

test("sorts batches by frequency", async () => {
  const monthly = { ...batch, batch_id: "b3", batch_name: "Month End", frequency: "Monthly", frequency_other: "" };
  const daily = { ...batch, batch_id: "b4", batch_name: "Day Start", frequency: "Daily", frequency_other: "" };
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: true, has_report: false, has_capability: false }]));
      if (url === "/api/batches") return Promise.resolve(json([monthly, daily]));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  await waitFor(() => expect(screen.getByText("Month End")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Frequency" }));
  const names = screen
    .getAllByRole("button")
    .map((node) => node.textContent)
    .filter((name) => name === "Day Start" || name === "Month End");
  expect(names).toEqual(["Day Start", "Month End"]);
});

test("upload dialog asks for country, system and excel", async () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: true, has_report: false, has_capability: false }]));
      if (url === "/api/batches") return Promise.resolve(json([]));
      return Promise.resolve(json([]));
    }),
  );
  renderPanel();
  await waitFor(() => expect(screen.getByRole("button", { name: /Upload$/ })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Upload$/ }));
  const dialog = screen.getByRole("dialog", { name: "Upload batches" });
  expect(within(dialog).getByText(/FREQUENCY is comma-separated/)).toBeTruthy();
  expect(within(dialog).getByLabelText("Country")).toBeTruthy();
  expect(within(dialog).getByLabelText("System")).toBeTruthy();
  expect(within(dialog).getByLabelText("Excel file")).toBeTruthy();
});
