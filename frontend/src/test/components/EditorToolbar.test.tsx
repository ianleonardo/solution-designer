import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, expect, it } from "vitest";
import { EditorToolbar } from "../../components/EditorToolbar";

afterEach(cleanup);

function fakeEditor(active: string[] = []) {
  const calls: [string, unknown[]][] = [];
  const chain: unknown = new Proxy(
    {},
    {
      get: (_target, key: string) => (key === "run" ? () => true : (...args: unknown[]) => { calls.push([key, args]); return chain; }),
    },
  );
  const editor = {
    chain: () => chain,
    isActive: (name: string) => active.includes(name),
    can: () => ({ undo: () => true, redo: () => false }),
    getAttributes: () => ({ href: "https://old.example" }),
  } as unknown as Editor;
  return { editor, calls };
}

it("the full toolbar offers headings, text styles, lists, quote, rule, link and history", () => {
  const { editor, calls } = fakeEditor(["bold"]);
  render(<EditorToolbar editor={editor} />);
  for (const label of ["Heading 1", "Heading 2", "Heading 3", "Bold", "Italic", "Underline", "Strikethrough", "Code", "Link", "Quote", "Bullet list", "Numbered list", "Horizontal rule", "Undo", "Redo"]) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
  expect(screen.getByLabelText("Bold").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByLabelText("Italic").getAttribute("aria-pressed")).toBe("false");
  expect((screen.getByLabelText("Redo") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Heading 3"));
  fireEvent.click(screen.getByLabelText("Underline"));
  fireEvent.click(screen.getByLabelText("Strikethrough"));
  fireEvent.click(screen.getByLabelText("Quote"));
  fireEvent.click(screen.getByLabelText("Horizontal rule"));
  const names = calls.map(([name]) => name);
  expect(names).toEqual(expect.arrayContaining(["toggleHeading", "toggleUnderline", "toggleStrike", "toggleBlockquote", "setHorizontalRule"]));
  expect(calls.find(([name]) => name === "toggleHeading")?.[1]).toEqual([{ level: 3 }]);
});

it("the cell toolbar is the short set", () => {
  const { editor } = fakeEditor();
  render(<EditorToolbar editor={editor} variant="cell" />);
  expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Bold", "Italic", "Underline", "Link", "Bullet list", "Numbered list"]);
});

it("applies a link from the link box and refuses unsafe addresses", () => {
  const { editor, calls } = fakeEditor();
  render(<EditorToolbar editor={editor} variant="cell" />);
  fireEvent.click(screen.getByLabelText("Link"));
  const input = screen.getByLabelText("Link address") as HTMLInputElement;
  expect(input.value).toBe("https://old.example");
  fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply link" }));
  expect(screen.getByText("Use an http, https or mailto address.")).toBeTruthy();
  expect(calls.some(([name]) => name === "setLink")).toBe(false);
  fireEvent.change(input, { target: { value: "example.com/page" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply link" }));
  expect(calls.find(([name]) => name === "setLink")?.[1]).toEqual([{ href: "https://example.com/page" }]);
  expect(screen.queryByLabelText("Link address")).toBeNull();
});

it("an empty link address removes the link", () => {
  const { editor, calls } = fakeEditor();
  render(<EditorToolbar editor={editor} variant="cell" />);
  fireEvent.click(screen.getByLabelText("Link"));
  fireEvent.change(screen.getByLabelText("Link address"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
  expect(calls.some(([name]) => name === "unsetLink")).toBe(true);
});

it("renders nothing without an editor", () => {
  const { container } = render(<EditorToolbar editor={null} />);
  expect(container.firstChild).toBeNull();
});
