import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ImageBlock } from "./ImageBlock";

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => "tok" });
  URL.createObjectURL = vi.fn(() => "blob:image");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const empty = { url: "", caption: "Context", alt: "" };

test("uploads an image and reports the stored url", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: "/api/projects/p1/images/a.png" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onChange = vi.fn();
  render(<ImageBlock projectId="p1" block={empty} readOnly={false} onChange={onChange} onError={() => undefined} />);
  expect(screen.getByText("No image uploaded.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Upload image"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...empty, url: "/api/projects/p1/images/a.png" }));
  expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/projects/p1/images");
});

test("reports upload errors", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Images must be 5 MB or smaller" }), { status: 400 })));
  const onError = vi.fn();
  render(<ImageBlock projectId="p1" block={empty} readOnly={false} onChange={() => undefined} onError={onError} />);
  fireEvent.change(screen.getByLabelText("Upload image"), { target: { files: [new File(["x"], "a.png")] } });
  await waitFor(() => expect(onError).toHaveBeenCalledWith("Images must be 5 MB or smaller"));
});

test("loads existing images with the session token and can remove them", async () => {
  const fetchMock = vi.fn(async () => new Response(new Blob(["png"]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onChange = vi.fn();
  render(<ImageBlock projectId="p1" block={{ ...empty, url: "/api/projects/p1/images/a.png" }} readOnly={false} onChange={onChange} onError={() => undefined} />);
  const image = await screen.findByRole("img");
  expect(image.getAttribute("src")).toBe("blob:image");
  const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
  expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok");
  fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
  expect(onChange).toHaveBeenCalledWith({ ...empty, url: "" });
});

test("read-only blocks hide the upload controls", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<ImageBlock projectId="p1" block={empty} readOnly onChange={() => undefined} onError={() => undefined} />);
  expect(screen.queryByLabelText("Upload image")).toBeNull();
  expect((screen.getByLabelText("Image caption") as HTMLInputElement).readOnly).toBe(true);
});
