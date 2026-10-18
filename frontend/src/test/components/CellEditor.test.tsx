import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { CellEditor } from "../../components/CellEditor";

beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  const list = Object.assign([], { item: () => null });
  Range.prototype.getClientRects = () => list as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.getClientRects = () => list as unknown as DOMRectList;
});

afterEach(cleanup);

it("edits one cell with the short toolbar and reports Markdown", async () => {
  const onChange = vi.fn();
  const { container } = render(<CellEditor value="**x** y" label="Name row 1" onChange={onChange} />);
  await waitFor(() => expect(container.querySelector(".ProseMirror strong")?.textContent).toBe("x"));
  expect(screen.getByLabelText("Name row 1").getAttribute("role")).toBe("textbox");
  expect(screen.queryByLabelText("Heading 1")).toBeNull();
  fireEvent.click(screen.getByLabelText("Bullet list"));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/^[-*] /);
});
