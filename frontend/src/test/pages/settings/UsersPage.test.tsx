import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../../types";
import { UsersPage } from "../../../pages/settings/UsersPage";

const base: User[] = [
  { user_id: "u1", username: "Admin", login_id: "admin", role_name: "Admin", created_at: "2026-10-13T12:00:00" },
  { user_id: "u2", username: "Maya", login_id: "maya", role_name: "Analyst", created_at: "2026-10-13T12:00:00" },
];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function setup(handler?: (url: string, init?: RequestInit) => Response | undefined) {
  vi.stubGlobal("localStorage", { getItem: () => null });
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => Promise.resolve(handler?.(url, init) ?? json(base)));
  vi.stubGlobal("fetch", fetchMock);
  render(<UsersPage />);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("UsersPage", () => {
  it("shows only an Add user button, with no inline form", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("maya")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Add user" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("opens a popup with Login ID, Name, Password and Role, then posts the new user", async () => {
    const fetchMock = setup((_url, init) => (init?.method === "POST" ? json({ user_id: "u3", username: "Lee", login_id: "lee", role_name: "Viewer", created_at: "2026-10-13T12:00:00" }) : undefined));
    await waitFor(() => expect(screen.getByText("maya")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    expect(screen.getByRole("dialog", { name: "Add user" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "lee" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Lee" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password123!" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Viewer" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add user" })[1]);
    await waitFor(() => expect(screen.getByText("Lee")).toBeTruthy());
    const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ login_id: "lee", username: "Lee", password: "Password123!", role_name: "Viewer" });
  });

  it.each(["ian chen", "ian.chen", "ian@bank.com", "ian_1", "ab"])("rejects the Login ID %j without calling the API", async (value) => {
    const fetchMock = setup();
    await waitFor(() => expect(screen.getByText("maya")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ian" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password123!" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add user" })[1]);
    expect(screen.getByText(/letters or numbers, with no spaces or special characters/)).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("shows the Created date as DD-MMM YYYY", async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText("13-Oct 2026").length).toBe(2));
  });

  it("edits only name and role; the Login ID is read-only", async () => {
    const fetchMock = setup((_url, init) => (init?.method === "PATCH" ? json({ ...base[1], username: "Maya K", role_name: "Analyst" }) : undefined));
    await waitFor(() => expect(screen.getByText("maya")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Edit maya" }));
    const loginId = screen.getByLabelText("Login ID") as HTMLInputElement;
    expect(loginId.readOnly).toBe(true);
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Maya K" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Analyst" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Maya K")).toBeTruthy());
    const patch = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patch?.[0]).toBe("/api/users/u2");
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ username: "Maya K", role_name: "Analyst" });
  });

  it("confirms before deleting a user", async () => {
    const fetchMock = setup((_url, init) => (init?.method === "DELETE" ? json({ ok: true }) : undefined));
    await waitFor(() => expect(screen.getByText("maya")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Delete maya" }));
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("maya")).toBeNull());
  });

  it("filters the list with search", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("maya")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "analyst" } });
    expect(screen.getByText("maya")).toBeTruthy();
    expect(screen.queryByText("admin@x.local")).toBeNull();
  });
});
