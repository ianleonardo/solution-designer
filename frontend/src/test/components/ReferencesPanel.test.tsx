import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ReferencesPanel } from "../../components/ReferencesPanel";
import type { Reference } from "../../types";

const reference: Reference = {
  doc_id: "d1",
  file_name: "brd.md",
  file_type: "md",
  uploaded_by: "u",
  uploaded_at: "now",
  size_bytes: 2048,
  extracted_text: "",
  chunk_count: 3,
  indexed: false,
};

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null });
});
afterEach(cleanup);

test("lists references with their index state", () => {
  render(<ReferencesPanel projectId="p1" references={[reference]} canEdit onChange={() => undefined} onClose={() => undefined} />);
  expect(screen.getByText("brd.md")).toBeTruthy();
  expect(screen.getByText("Keyword only")).toBeTruthy();
  expect(screen.getByText(/3 chunks/)).toBeTruthy();
});

test("read-only roles cannot upload or remove but can preview and download", () => {
  render(<ReferencesPanel projectId="p1" references={[reference]} canEdit={false} onChange={() => undefined} onClose={() => undefined} />);
  expect(screen.queryByLabelText("Upload reference")).toBeNull();
  expect(screen.queryByLabelText("Remove brd.md")).toBeNull();
  expect(screen.getByLabelText("Preview brd.md")).toBeTruthy();
  expect(screen.getByLabelText("Download brd.md")).toBeTruthy();
  expect(screen.getByText(/Only Analyst users/)).toBeTruthy();
});

test("preview opens markdown content from the inline download URL", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "tok" });
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/download?inline=1")) {
      return new Response("# Hello reference", { status: 200, headers: { "Content-Type": "text/markdown" } });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ReferencesPanel projectId="p1" references={[reference]} canEdit onChange={() => undefined} onClose={() => undefined} />);
  fireEvent.click(screen.getByLabelText("Preview brd.md"));
  const dialog = await screen.findByRole("dialog", { name: "Preview brd.md" });
  await waitFor(() => expect(within(dialog).getByLabelText("Rendered markdown")).toBeTruthy());
  expect(within(dialog).getByRole("heading", { name: "Hello reference" })).toBeTruthy();
});

test("uploading posts to the references endpoint", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...reference, doc_id: "d2", file_name: "new.md" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onChange = vi.fn();
  render(<ReferencesPanel projectId="p1" references={[reference]} canEdit onChange={onChange} onClose={() => undefined} />);
  const input = screen.getByLabelText("Upload reference");
  fireEvent.change(input, { target: { files: [new File(["x"], "new.md", { type: "text/markdown" })] } });
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/projects/p1/references");
  expect((onChange.mock.calls[0][0] as Reference[]).map((item) => item.doc_id)).toEqual(["d1", "d2"]);
});

test("removing asks for confirmation then deletes", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onChange = vi.fn();
  render(<ReferencesPanel projectId="p1" references={[reference]} canEdit onChange={onChange} onClose={() => undefined} />);
  fireEvent.click(screen.getByLabelText("Remove brd.md"));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
  expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/projects/p1/references/d1");
});
