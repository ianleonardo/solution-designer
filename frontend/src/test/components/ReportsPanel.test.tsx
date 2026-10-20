import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { ReportsPanel } from "../../components/ReportsPanel";

const report = {
  report_id: "r1",
  country: "SG",
  system_code: "SPL",
  report_code: "RPT-01",
  report_name: "Daily Balance",
  description: "End of day",
  layout: "A|B",
  created_at: "2026-10-17T00:00:00",
  last_modified: "2026-10-17T00:00:00",
};

const other = {
  ...report,
  report_id: "r2",
  country: "MY",
  system_code: "DGE",
  report_code: "RPT-02",
  report_name: "MY Summary",
  description: "Malaysia only",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("filters reports by country and search", async () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(
          json([
            { system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: true, has_capability: false },
            { system_code: "DGE", system_name: "DGE", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: true, has_capability: false },
          ]),
        );
      if (url === "/api/reports") return Promise.resolve(json([report, other]));
      return Promise.resolve(json([]));
    }),
  );
  render(
    <MemoryRouter>
      <ReportsPanel />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("Daily Balance")).toBeTruthy());
  expect(screen.getByText("RPT-01")).toBeTruthy();
  expect(screen.queryByText("MY Summary")).toBeNull();

  fireEvent.click(screen.getByLabelText("Filter by country"));
  fireEvent.click(screen.getByRole("option", { name: "SG" }));
  expect(screen.getByText("Daily Balance")).toBeTruthy();
  expect(screen.queryByText("MY Summary")).toBeNull();

  fireEvent.change(screen.getByLabelText("Search Reports"), { target: { value: "Balance" } });
  expect(screen.getByText("Daily Balance")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search Reports"), { target: { value: "zzzz" } });
  expect(screen.queryByText("Daily Balance")).toBeNull();
});

test("sorts reports by frequency", async () => {
  const weekly = { ...report, report_id: "r3", report_code: "RPT-03", report_name: "Weekly Close", frequency: "Weekly", frequency_other: "" };
  const daily = { ...report, report_id: "r4", report_code: "RPT-04", report_name: "Morning Snapshot", frequency: "Daily", frequency_other: "" };
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: true, has_capability: false }]));
      if (url === "/api/reports") return Promise.resolve(json([weekly, daily]));
      return Promise.resolve(json([]));
    }),
  );
  render(
    <MemoryRouter>
      <ReportsPanel />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("Weekly Close")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Frequency" }));
  const names = screen
    .getAllByRole("button")
    .map((node) => node.textContent)
    .filter((name) => name === "Morning Snapshot" || name === "Weekly Close");
  expect(names).toEqual(["Morning Snapshot", "Weekly Close"]);
});
