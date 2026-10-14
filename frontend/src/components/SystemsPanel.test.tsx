import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SystemRecord } from "../types";
import { SystemsPanel } from "./SystemsPanel";

function system(code: string, overrides: Partial<SystemRecord> = {}): SystemRecord {
  return { system_code: code, system_name: `${code} name`, description: "", upstreams: "", downstreams: "", created_at: "2026-10-14T00:00:00", last_modified: "2026-10-14T00:00:00", ...overrides };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function mockFetch(list: SystemRecord[], handler?: Handler) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler?.(url, init) ?? json(list));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("lists systems with their upstreams and downstreams, sortable by code", async () => {
  mockFetch([system("SPL", { downstreams: "DGE" }), system("DGE", { upstreams: "SPL", description: "Gateway" })]);
  render(<SystemsPanel />);
  await waitFor(() => expect(screen.getByText("DGE name")).toBeTruthy());
  for (const header of ["System Code", "System Name", "Description", "Upstreams", "Downstreams"]) expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toBeTruthy();
  expect(screen.getByText("Gateway")).toBeTruthy();
  const codes = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
  fireEvent.click(screen.getByRole("button", { name: /System Code/ }));
  expect(codes()).toEqual(["DGE", "SPL"]);
});

test("adds a system and shows it in the table", async () => {
  const fetchMock = mockFetch([], (_url, init) => (init?.method === "POST" ? json(system("SPL", { upstreams: "" })) : undefined));
  render(<SystemsPanel />);
  await waitFor(() => expect(screen.getByText("No systems found.")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Add$/ }));
  fireEvent.change(screen.getByLabelText("System code"), { target: { value: "SPL" } });
  fireEvent.change(screen.getByLabelText("System name"), { target: { value: "SPL name" } });
  fireEvent.change(screen.getByLabelText("Upstreams"), { target: { value: " A, B " } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(screen.getByText("SPL name")).toBeTruthy());
  const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST")!;
  expect(post[0]).toBe("/api/systems");
  expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({ system_code: "SPL", system_name: "SPL name", upstreams: "A, B", downstreams: "" });
});

test("shows the server's message when an upstream code is unknown", async () => {
  mockFetch([], (_url, init) => (init?.method === "POST" ? json({ detail: "Upstreams has unknown system code(s): NOPE." }, 400) : undefined));
  render(<SystemsPanel />);
  await waitFor(() => expect(screen.getByText("No systems found.")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Add$/ }));
  fireEvent.change(screen.getByLabelText("System code"), { target: { value: "SPL" } });
  fireEvent.change(screen.getByLabelText("System name"), { target: { value: "x" } });
  fireEvent.change(screen.getByLabelText("Upstreams"), { target: { value: "NOPE" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(screen.getByText(/unknown system code\(s\): NOPE/)).toBeTruthy());
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("edits a system without letting the code change", async () => {
  const fetchMock = mockFetch([system("SPL")], (_url, init) => (init?.method === "PATCH" ? json(system("SPL", { system_name: "Renamed", downstreams: "DGE" })) : undefined));
  render(<SystemsPanel />);
  await waitFor(() => expect(screen.getByText("SPL name")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Edit SPL" }));
  expect((screen.getByLabelText("System code") as HTMLInputElement).readOnly).toBe(true);
  fireEvent.change(screen.getByLabelText("System name"), { target: { value: "Renamed" } });
  fireEvent.change(screen.getByLabelText("Downstreams"), { target: { value: "DGE" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByText("Renamed")).toBeTruthy());
  const patch = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PATCH")!;
  expect(patch[0]).toBe("/api/systems/SPL");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("deletes after confirmation and shows why a delete is refused", async () => {
  let refuse = true;
  mockFetch([system("SPL"), system("DGE")], (_url, init) => {
    if (init?.method !== "DELETE") return undefined;
    if (refuse) return json({ detail: "SPL is still listed as upstream or downstream of: DGE." }, 409);
    return json({ ok: true });
  });
  render(<SystemsPanel />);
  await waitFor(() => expect(screen.getByText("SPL name")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Delete SPL" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.getByText(/still listed as upstream or downstream of: DGE/)).toBeTruthy());
  expect(screen.getByText("SPL name")).toBeTruthy();
  refuse = false;
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByText("SPL name")).toBeNull());
});
