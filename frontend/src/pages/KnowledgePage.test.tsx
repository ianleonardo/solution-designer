import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgePage } from "./KnowledgePage";

const item = (id: string, type: string, system: string) => ({
  rag_id: id,
  inventory_type: type,
  system_name: system,
  source_name: "file.md",
  raw_content: "",
  parsed: { purpose: `${system} purpose` },
  created_at: "2026-10-13T00:00:00",
});

const data = [item("SC-0001", "Screens", "Login screen"), item("BA-0001", "Batches", "Nightly job"), item("SC-0002", "Screens", "Home screen")];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/knowledge/:kind" element={<KnowledgePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("KnowledgePage", () => {
  it("lists only entries of the selected type and supports search", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(data)));
    renderAt("/knowledge/screens");
    await waitFor(() => expect(screen.getByText("Login screen")).toBeTruthy());
    expect(screen.getByText("Home screen")).toBeTruthy();
    expect(screen.queryByText("Nightly job")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search Screens"), { target: { value: "login" } });
    expect(screen.queryByText("Home screen")).toBeNull();
    expect(screen.getByText("Login screen")).toBeTruthy();
  });

  it("uploads with the type of the current screen", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(json([item("BA-0002", "Batches", "Created job")]));
      return Promise.resolve(json(data));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/knowledge/batches");
    await waitFor(() => expect(screen.getByText("Nightly job")).toBeTruthy());
    const input = screen.getByLabelText("Upload Batches");
    fireEvent.change(input, { target: { files: [new File(["| a |"], "jobs.md", { type: "text/markdown" })] } });
    await waitFor(() => expect(screen.getByText("Created job")).toBeTruthy());
    const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST");
    expect(post?.[0]).toBe("/api/rag?inventory_type=Batches");
  });

  it("shows the guideline documents screen, not the generic upload, on the Guidelines page", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const fetchMock = vi.fn().mockResolvedValue(json([]));
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/knowledge/guidelines");
    await waitFor(() => expect(screen.getByRole("button", { name: /Add$/ })).toBeTruthy());
    expect(screen.queryByLabelText("Upload Guidelines")).toBeNull();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/guidelines"]);
  });
  it("shows the systems screen, tabbed interfaces screen, and tables screen, not the generic upload", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json([])));
    vi.stubGlobal("fetch", fetchMock);
    const systems = renderAt("/knowledge/systems");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Systems" })).toBeTruthy());
    expect(screen.queryByLabelText("Upload Systems")).toBeNull();
    systems.unmount();
    const interfaces = renderAt("/knowledge/interfaces");
    await waitFor(() => expect(screen.getByRole("tab", { name: "SPL" })).toBeTruthy());
    expect(screen.queryByLabelText("Upload Interfaces")).toBeNull();
    interfaces.unmount();
    renderAt("/knowledge/tables");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Tables" })).toBeTruthy());
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/systems", "/api/interfaces/SPL", "/api/tables"]);
  });
});
