import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { InterfaceRecord } from "../types";
import { InterfacesPanel } from "./InterfacesPanel";

function item(channel: string, name: string, country = "SG", overrides: Partial<InterfaceRecord> = {}): InterfaceRecord {
  return { interface_id: `${channel}-${name}`, channel: channel as InterfaceRecord["channel"], country, interface_name: name, description: "", protocol: "API", source: "SPL", destination: "DGE", ...overrides };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(upload?: () => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && upload) return upload();
    const channel = url.split("/").pop();
    if (channel === "SPL") return json([item("SPL", "Zeta"), item("SPL", "Alpha", "MY")]);
    return json([item(channel ?? "", `${channel} only`)]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path = "/knowledge/interfaces") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <InterfacesPanel />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("shows the five channel tabs and the interface columns, sortable", async () => {
  mockFetch();
  renderAt();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["SPL", "DGE", "PIB", "WSM", "EAI"]);
  await waitFor(() => expect(screen.getByText("Zeta")).toBeTruthy());
  for (const header of ["Country", "Interface Name", "Description", "Protocol", "Source", "Destination"]) expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toBeTruthy();
  const names = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[1].textContent);
  fireEvent.click(screen.getByRole("button", { name: /Interface Name/ }));
  expect(names()).toEqual(["Alpha", "Zeta"]);
});

test("each tab loads its own interfaces and the tab is kept in the address", async () => {
  const fetchMock = mockFetch();
  renderAt("/knowledge/interfaces?tab=pib");
  await waitFor(() => expect(screen.getByText("PIB only")).toBeTruthy());
  expect(screen.getByRole("tab", { name: "PIB" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "EAI" }));
  await waitFor(() => expect(screen.getByText("EAI only")).toBeTruthy());
  expect(screen.queryByText("PIB only")).toBeNull();
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/interfaces/PIB", "/api/interfaces/EAI"]);
});

test("uploads an Excel file to the current tab and shows the new rows", async () => {
  const fetchMock = mockFetch(() => json([item("DGE", "From excel"), item("DGE", "Second")]));
  renderAt("/knowledge/interfaces?tab=DGE");
  await waitFor(() => expect(screen.getByText("DGE only")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Upload DGE Excel"), { target: { files: [new File(["x"], "dge.xlsx")] } });
  await waitFor(() => expect(screen.getByText("From excel")).toBeTruthy());
  expect(screen.queryByText("DGE only")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("DGE now has 2 interfaces.");
  const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST")!;
  expect(post[0]).toBe("/api/interfaces/DGE/upload");
});

test("lists the row problems of a rejected upload and keeps the table", async () => {
  mockFetch(() =>
    json(
      {
        detail: "2 problem(s) found. Nothing was imported.",
        errors: [
          { row: 2, field: "Country", message: "'JP' is not allowed." },
          { row: 5, field: "Source", message: "'NOPE' is not a known system code." },
        ],
      },
      400,
    ),
  );
  renderAt("/knowledge/interfaces?tab=SPL");
  await waitFor(() => expect(screen.getByText("Zeta")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Upload SPL Excel"), { target: { files: [new File(["x"], "spl.xlsx")] } });
  await waitFor(() => expect(screen.getByText(/Nothing was imported/)).toBeTruthy());
  const list = screen.getByRole("list", { name: "Upload problems" });
  expect(within(list).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["Row 2, Country: 'JP' is not allowed.", "Row 5, Source: 'NOPE' is not a known system code."]);
  expect(screen.getByText("Zeta")).toBeTruthy();
});
