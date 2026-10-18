import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AuthProvider } from "../../auth";
import { DashboardPage } from "../../pages/DashboardPage";

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

test("total projects links to projects and kb cells link with country filter", async () => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "token" ? "t" : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/me") return Promise.resolve(json({ username: "a", role_name: "Analyst", login_id: "a" }));
      return Promise.resolve(
        json({
          total_projects: 3,
          total_documents: 7,
          kb_by_country: [{ country: "SG", capabilities: 1, interfaces: 2, tables: 3, batches: 4, reports: 5 }],
        }),
      );
    }),
  );
  render(
    <MemoryRouter>
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByRole("link", { name: "Open projects" })).toBeTruthy());
  expect(screen.getByRole("link", { name: "Open projects" }).getAttribute("href")).toBe("/projects");
  expect(screen.getByRole("link", { name: "Tables for SG: 3" }).getAttribute("href")).toBe("/knowledge/tables?country=SG");
  expect(screen.getByRole("link", { name: "Batches for SG: 4" }).getAttribute("href")).toBe("/knowledge/batches?country=SG");
  expect(screen.getByRole("link", { name: "Capabilities for SG: 1" }).getAttribute("href")).toBe("/knowledge/capabilities?country=SG");
});
