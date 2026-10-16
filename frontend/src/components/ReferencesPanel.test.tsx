import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ReferencesPanel } from "./ReferencesPanel";
import type { Reference } from "../types";

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

test("read-only roles cannot upload or remove", () => {
  render(<ReferencesPanel projectId="p1" references={[reference]} canEdit={false} onChange={() => undefined} onClose={() => undefined} />);
  expect(screen.queryByLabelText("Upload reference")).toBeNull();
  expect(screen.queryByLabelText("Remove brd.md")).toBeNull();
  expect(screen.getByText(/Only Analyst users/)).toBeTruthy();
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
