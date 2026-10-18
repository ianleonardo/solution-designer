import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../../../types";
import { AUDIT_PAGE_SIZE, AuditLogPage } from "../../../pages/settings/AuditLogPage";

function entry(index: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    audit_id: `a${index}`,
    occurred_at: `2026-10-14T10:${String(index % 60).padStart(2, "0")}:00`,
    user_id: "u1",
    username: "Writer",
    login_id: "writer",
    role_name: "Write",
    action: "create_project",
    method: "POST",
    path: "/api/projects",
    entity_type: "project",
    entity_id: `p${index}`,
    summary: `Create project: Project ${index}`,
    detail: { request: { project_name: `Project ${index}` } },
    ip_address: "127.0.0.1",
    ...overrides,
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function setup(rows: AuditEntry[]) {
  vi.stubGlobal("localStorage", { getItem: () => "token" });
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.startsWith("/api/audit/actions")) return Promise.resolve(json(["create_project", "delete_user"]));
    return Promise.resolve(json(rows));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuditLogPage />);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuditLogPage", () => {
  it("lists who did what and when", async () => {
    setup([
      entry(1),
      entry(2, { login_id: "admin", role_name: "Admin", action: "delete_user", entity_type: "user", entity_id: "u9", summary: "Delete user: ian" }),
    ]);
    expect(await screen.findByText("Delete user: ian")).toBeTruthy();
    const rows = screen.getAllByRole("row");
    const adminRow = rows.find((row) => within(row).queryByText("Delete user: ian"));
    expect(adminRow).toBeTruthy();
    expect(within(adminRow as HTMLElement).getByText("admin")).toBeTruthy();
    expect(within(adminRow as HTMLElement).getByText("Admin")).toBeTruthy();
    expect(within(adminRow as HTMLElement).getByText("Delete user")).toBeTruthy();
    expect(within(adminRow as HTMLElement).getByText(/14-Oct 2026/)).toBeTruthy();
  });

  it("shows the request details of an entry", async () => {
    setup([entry(1)]);
    await screen.findByText("Create project: Project 1");
    expect(screen.getByText(/"project_name": "Project 1"/)).toBeTruthy();
    expect(screen.getByText(/POST \/api\/projects/)).toBeTruthy();
  });

  it("is searchable and sortable", async () => {
    setup([entry(1), entry(2, { login_id: "admin", summary: "Delete user: ian", action: "delete_user" })]);
    await screen.findByText("Delete user: ian");
    fireEvent.change(screen.getByLabelText("Search audit log"), { target: { value: "admin" } });
    expect(screen.queryByText("Create project: Project 1")).toBeNull();
    expect(screen.getByText("Delete user: ian")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search audit log"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^User/ }));
    const logins = screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[1].textContent);
    expect(logins[0]).toContain("admin");
  });

  it("paginates", async () => {
    setup(Array.from({ length: AUDIT_PAGE_SIZE + 5 }, (_, index) => entry(index + 1)));
    await screen.findByText("Create project: Project 1");
    expect(screen.getByLabelText("Pagination")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(`${AUDIT_PAGE_SIZE + 1}-${AUDIT_PAGE_SIZE + 5} of ${AUDIT_PAGE_SIZE + 5}`)).toBeTruthy();
  });

  it("asks the API again when a filter changes", async () => {
    const fetchMock = setup([entry(1)]);
    await screen.findByText("Create project: Project 1");
    await waitFor(() => expect(screen.getByRole("option", { name: "Delete user" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "delete_user" } });
    expect((screen.getByLabelText("From") as HTMLInputElement).placeholder).toBe("DD/MM/YYYY");
    expect((screen.getByLabelText("To") as HTMLInputElement).placeholder).toBe("DD/MM/YYYY");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "01/10/2026" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "14/10/2026" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("action=delete_user") && String(call[0]).includes("since=2026-10-01") && String(call[0]).includes("until=2026-10-14"))).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect((screen.getByLabelText("Action") as HTMLSelectElement).value).toBe(""));
  });

  it("says so when there is nothing to show", async () => {
    setup([]);
    expect(await screen.findByText("No audit entries.")).toBeTruthy();
  });
});
