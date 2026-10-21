import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RolesPage } from "../../../pages/settings/RolesPage";
import type { RoleRecord } from "../../../types";

const role = (role_id: string, name: string, projects: RoleRecord["projects"], knowledge: RoleRecord["knowledge"], settings: RoleRecord["settings"], extra: Partial<RoleRecord> = {}): RoleRecord => ({
  role_id, name, description: "", projects, knowledge, settings, is_system: true, locked: false, user_count: 0, created_at: "", updated_at: "", ...extra,
});

const roles = [
  role("viewer", "Viewer", "read", "read", "none", { user_count: 3 }),
  role("analyst", "Analyst", "write", "read", "none"),
  role("super-analyst", "Super-analyst", "write", "write", "none"),
  role("administrator", "Administrator", "write", "write", "write", { locked: true, user_count: 1 }),
];

let calls: { url: string; method: string; body: string }[] = [];

function setup() {
  calls = [];
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: String(init?.body ?? "") });
      if (method === "POST") return new Response(JSON.stringify({ ...role("auditor", "Auditor", "none", "none", "read"), is_system: false }), { status: 200 });
      return new Response(JSON.stringify(roles), { status: 200 });
    }),
  );
  render(<RolesPage />);
}

afterEach(() => vi.unstubAllGlobals());

test("lists the predefined roles with their access to each menu", async () => {
  setup();
  const row = (await screen.findByText("Super-analyst")).closest("tr")!;
  expect(within(row).getAllByText("Write")).toHaveLength(2);
  expect(within(row).getByText("No access")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Edit Administrator" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Delete Viewer" }) as HTMLButtonElement).disabled).toBe(true);
});

test("write includes read, no read means no access, and the new role is saved", async () => {
  setup();
  await screen.findByText("Viewer");
  fireEvent.click(screen.getByRole("button", { name: "Add role" }));
  const dialog = screen.getByRole("dialog", { name: "Add role" });
  fireEvent.change(within(dialog).getByLabelText("Role name"), { target: { value: "Auditor" } });
  // projects: untick read -> no access
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Projects read" }));
  expect((within(dialog).getByRole("checkbox", { name: "Projects write" }) as HTMLInputElement).checked).toBe(false);
  // knowledge: untick read too
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Knowledge Base read" }));
  // settings: tick write -> read comes with it, then untick write -> read stays
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Settings write" }));
  expect((within(dialog).getByRole("checkbox", { name: "Settings read" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Settings write" }));
  expect((within(dialog).getByRole("checkbox", { name: "Settings read" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Add role" }));
  await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
  expect(JSON.parse(calls.find((call) => call.method === "POST")!.body)).toEqual({
    name: "Auditor",
    description: "",
    projects: "none",
    knowledge: "none",
    settings: "read",
  });
  expect(await screen.findByText("Auditor")).toBeTruthy();
});
