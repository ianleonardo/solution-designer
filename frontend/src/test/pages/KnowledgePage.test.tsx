import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgePage } from "../../pages/KnowledgePage";

const item = (id: string, type: string, system: string) => ({
  rag_id: id,
  inventory_type: type,
  system_name: system,
  source_name: "file.md",
  raw_content: "",
  parsed: { purpose: `${system} purpose` },
  created_at: "2026-10-13T00:00:00",
});

const data = [item("SC-0001", "Screens", "Login screen"), item("BA-0001", "Batches", "Nightly job")];

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
  it("does not offer a Screens inventory", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG"], databases: [], interface_channels: [] }));
        if (url === "/api/systems") return Promise.resolve(json([]));
        return Promise.resolve(json(data));
      }),
    );
    renderAt("/knowledge/screens");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Systems" })).toBeTruthy());
    expect(screen.queryByLabelText("Upload Screens")).toBeNull();
    expect(screen.queryByLabelText("Search Screens")).toBeNull();
  });

  it("shows the structured batches screen, not the generic upload", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG"], databases: [], interface_channels: [] }));
      if (url === "/api/systems") return Promise.resolve(json([]));
      if (url === "/api/batches") return Promise.resolve(json([]));
      return Promise.resolve(json([]));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/knowledge/batches");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Batches" })).toBeTruthy());
    expect(screen.queryByLabelText("Upload Batches")).toBeNull();
    expect(screen.getByRole("button", { name: /Upload$/ })).toBeTruthy();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["/api/catalogs", "/api/systems", "/api/batches"]));
  });

  it("shows the Bitbucket Repositories screen, not the generic upload", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG"], databases: [], interface_channels: [], bitbucket_projects: ["CORE"] }));
      if (url === "/api/systems") return Promise.resolve(json([]));
      if (url === "/api/bitbucket-repos") return Promise.resolve(json([]));
      return Promise.resolve(json([]));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/knowledge/bitbucket");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Bitbucket Repositories" })).toBeTruthy());
    expect(screen.queryByLabelText("Upload Bitbucket Repos")).toBeNull();
    expect(screen.getByRole("tab", { name: "CORE" })).toBeTruthy();
    expect(screen.getByLabelText("Upload CORE Excel")).toBeTruthy();
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
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/systems",
      "/api/catalogs",
      "/api/systems",
      "/api/interfaces/SPL",
      "/api/catalogs",
      "/api/tables",
    ]);
  });
});
