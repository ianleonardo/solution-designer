import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GuidelinesPanel } from "../../components/GuidelinesPanel";
import type { Guideline } from "../../types";

function guideline(overrides: Partial<Guideline> = {}): Guideline {
  return {
    guideline_id: "GL-0001",
    title: "Secure coding",
    description: "Rules for code",
    file_name: "secure.md",
    file_type: "md",
    has_file: true,
    chunk_count: 4,
    embedded_count: 4,
    embedding_model: "spirare:embed-v1",
    status: "embedded",
    created_by: "u",
    created_at: "2026-10-05T10:30:00",
    indexed_at: "2026-10-13T00:00:00",
    ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(list: Guideline[], handler?: Handler) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (handler) {
      const custom = await handler(url, init);
      if (custom) return custom;
    }
    return json(list);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("lists guidelines without chunks or embedding columns", async () => {
  mockFetch([guideline(), guideline({ guideline_id: "GL-0002", title: "Logging", description: "What to log", status: "outdated", embedded_count: 2 })]);
  render(<GuidelinesPanel />);
  await waitFor(() => expect(screen.getByText("Secure coding")).toBeTruthy());
  expect(screen.getByText("Rules for code")).toBeTruthy();
  expect(screen.getAllByText("05-Oct 2026").length).toBe(2);
  expect(screen.queryByRole("columnheader", { name: /Chunks/ })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: /Embedding/ })).toBeNull();
  expect(screen.queryByText("4/4")).toBeNull();
  expect(screen.queryByText("Embedded")).toBeNull();
  expect(screen.getByRole("button", { name: /Add$/ })).toBeTruthy();
  expect(screen.queryByText("Upload")).toBeNull();
});

test("the Add dialog needs a title and a file, then posts them as form data", async () => {
  const created = guideline({ guideline_id: "GL-0002", title: "Logging rules", description: "What to log", file_name: "log.txt", file_type: "txt" });
  const fetchMock = mockFetch([guideline()], (_url, init) => (init?.method === "POST" ? json(created) : (undefined as unknown as Response)));
  render(<GuidelinesPanel />);
  await waitFor(() => expect(screen.getByText("Secure coding")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: /Add$/ }));
  const dialog = screen.getByRole("dialog", { name: "Add guideline" });
  const submit = within(dialog).getByRole("button", { name: "Add" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  expect(within(dialog).getByRole("button", { name: /Upload$/ })).toBeTruthy();

  fireEvent.change(within(dialog).getByLabelText("Guideline title"), { target: { value: "Logging rules" } });
  expect(submit.disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText("Guideline description"), { target: { value: "What to log" } });
  const file = new File(["log carefully"], "log.txt", { type: "text/plain" });
  const input = within(dialog).getByLabelText("Guideline file") as HTMLInputElement;
  expect(input.accept).toBe(".md,.markdown,.pdf,.txt");
  fireEvent.change(input, { target: { files: [file] } });
  expect(within(dialog).getByText("log.txt")).toBeTruthy();
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add guideline" })).toBeNull());
  expect(screen.getByText("Logging rules")).toBeTruthy();
  const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST");
  expect(post?.[0]).toBe("/api/guidelines");
  const body = (post?.[1] as RequestInit).body as FormData;
  expect(body.get("title")).toBe("Logging rules");
  expect(body.get("description")).toBe("What to log");
  expect((body.get("file") as File).name).toBe("log.txt");
});

test("a save error is shown in the dialog and the dialog stays open", async () => {
  mockFetch([], (_url, init) => (init?.method === "POST" ? json({ detail: "Unsupported file type." }, 400) : (undefined as unknown as Response)));
  render(<GuidelinesPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /Add$/ }));
  const dialog = screen.getByRole("dialog", { name: "Add guideline" });
  fireEvent.change(within(dialog).getByLabelText("Guideline title"), { target: { value: "X" } });
  fireEvent.change(within(dialog).getByLabelText("Guideline file"), { target: { files: [new File(["a"], "a.md")] } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(within(dialog).getByText("Unsupported file type.")).toBeTruthy());
});

test("has no per-guideline re-embed or re-tokenize actions", async () => {
  mockFetch([guideline({ status: "outdated", embedded_count: 0 })]);
  render(<GuidelinesPanel />);
  await waitFor(() => expect(screen.getByText("Secure coding")).toBeTruthy());
  expect(screen.queryByLabelText(/Re-embed/)).toBeNull();
  expect(screen.queryByLabelText(/Re-tokenize/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Re-embed all/ })).toBeNull();
  expect(screen.getByLabelText("Delete Secure coding")).toBeTruthy();
});

test("deleting asks for confirmation then removes the row", async () => {
  const fetchMock = mockFetch([guideline()], (_url, init) => (init?.method === "DELETE" ? json({ ok: true }) : (undefined as unknown as Response)));
  render(<GuidelinesPanel />);
  await waitFor(() => expect(screen.getByText("Secure coding")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Delete Secure coding"));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByText("Secure coding")).toBeNull());
  expect(fetchMock.mock.calls.some((call) => call[0] === "/api/guidelines/GL-0001" && (call[1] as RequestInit).method === "DELETE")).toBe(true);
});

test("download fetches the original file with the token and saves it under its own name", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "tok" });
  URL.createObjectURL = vi.fn(() => "blob:orig");
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const fetchMock = mockFetch([guideline(), guideline({ guideline_id: "GL-0002", title: "Old entry", has_file: false })], (url) =>
    url.endsWith("/download") ? new Response("# original", { status: 200 }) : (undefined as unknown as Response),
  );
  render(<GuidelinesPanel />);
  await waitFor(() => expect(screen.getByText("Secure coding")).toBeTruthy());
  expect(screen.queryByLabelText("Download Old entry")).toBeNull();
  fireEvent.click(screen.getByLabelText("Download Secure coding"));
  await waitFor(() => expect(click).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find((c) => c[0] === "/api/guidelines/GL-0001/download");
  expect(new Headers((call?.[1] as RequestInit).headers).get("Authorization")).toBe("Bearer tok");
  click.mockRestore();
});

test("a download error is shown", async () => {
  mockFetch([guideline()], (url) => (url.endsWith("/download") ? json({ detail: "The original file could not be found in storage." }, 404) : (undefined as unknown as Response)));
  render(<GuidelinesPanel />);
  fireEvent.click(await screen.findByLabelText("Download Secure coding"));
  await waitFor(() => expect(screen.getByText("The original file could not be found in storage.")).toBeTruthy());
});

test("preview opens markdown content from the inline download URL", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "tok" });
  const fetchMock = mockFetch([guideline()], (url) =>
    String(url).includes("/download?inline=1")
      ? new Response("# Hello guideline", { status: 200, headers: { "Content-Type": "text/markdown" } })
      : (undefined as unknown as Response),
  );
  render(<GuidelinesPanel />);
  await waitFor(() => expect(screen.getByText("Secure coding")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Preview Secure coding"));
  const dialog = await screen.findByRole("dialog", { name: "Preview Secure coding" });
  await waitFor(() => expect(within(dialog).getByLabelText("Rendered markdown")).toBeTruthy());
  expect(within(dialog).getByRole("heading", { name: "Hello guideline" })).toBeTruthy();
  expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/download?inline=1"))).toBe(true);
});
