import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ProseEditor } from "../../components/ProseEditor";

// jsdom has no layout engine; ProseMirror asks for rectangles when it scrolls the cursor into view.
beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  const list = Object.assign([], { item: () => null });
  Range.prototype.getClientRects = () => list as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.getClientRects = () => list as unknown as DOMRectList;
});

afterEach(cleanup);

it("shows existing Markdown as formatted text and offers the toolbar to editors only", async () => {
  const { container, rerender } = render(<ProseEditor value={"## Title\n\nSome **bold** text"} readOnly={false} onChange={() => undefined} />);
  await waitFor(() => expect(container.querySelector(".ProseMirror h2")?.textContent).toBe("Title"));
  expect(container.querySelector(".ProseMirror strong")?.textContent).toBe("bold");
  expect(screen.getByLabelText("Bold")).toBeTruthy();
  rerender(<ProseEditor value="x" readOnly onChange={() => undefined} />);
  expect(screen.queryByLabelText("Bold")).toBeNull();
});

it("toolbar buttons change the text and report Markdown", async () => {
  const onChange = vi.fn();
  const { container } = render(<ProseEditor value="plain" readOnly={false} onChange={onChange} />);
  await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());
  const prose = container.querySelector(".ProseMirror") as HTMLElement;
  prose.focus();
  fireEvent.click(screen.getByLabelText("Heading 1"));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.calls.at(-1)?.[0]).toContain("# plain");
});
