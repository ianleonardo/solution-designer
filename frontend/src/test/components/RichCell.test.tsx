import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RichCell } from "../../components/RichCell";

vi.mock("../../components/CellEditor", () => ({
  CellEditor: ({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) => (
    <div>
      <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button">inside</button>
    </div>
  ),
}));

afterEach(cleanup);

it("renders Markdown as formatted text and never raw HTML", () => {
  const { container } = render(<RichCell label="Cell" value={'**bold** [site](https://example.com) <script>alert(1)</script>'} readOnly={false} onChange={() => undefined} />);
  expect(container.querySelector("strong")?.textContent).toBe("bold");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
  expect(container.querySelector("script")).toBeNull();
});

it("renders underline tags from the rich text editor", () => {
  const { container } = render(<RichCell label="Cell" value="say <u>hello</u>" readOnly onChange={() => undefined} />);
  expect(container.querySelector("u")?.textContent).toBe("hello");
});

it("renders several lines as blocks such as lists", () => {
  const { container } = render(<RichCell label="Cell" value={"- one\n- two"} readOnly onChange={() => undefined} />);
  expect(container.querySelectorAll("li").length).toBe(2);
});

it("does not render a script link", () => {
  const { container } = render(<RichCell label="Cell" value="[x](javascript:alert(1))" readOnly onChange={() => undefined} />);
  expect(container.querySelector("a")).toBeNull();
});

it("opens the editor on click and keeps it open while focus stays inside the cell", () => {
  const onChange = vi.fn();
  render(<RichCell label="Cell" value="text" readOnly={false} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText("Cell"));
  const editor = screen.getByLabelText("Cell") as HTMLTextAreaElement;
  expect(editor.tagName).toBe("TEXTAREA");
  fireEvent.change(editor, { target: { value: "new" } });
  expect(onChange).toHaveBeenCalledWith("new");
  fireEvent.blur(editor, { relatedTarget: screen.getByText("inside") });
  expect(screen.getByLabelText("Cell").tagName).toBe("TEXTAREA");
  fireEvent.blur(editor, { relatedTarget: document.body });
  expect(screen.getByLabelText("Cell").tagName).toBe("DIV");
});

it("opens the editor when the cell receives focus from the keyboard", () => {
  render(<RichCell label="Cell" value="" readOnly={false} onChange={() => undefined} />);
  fireEvent.focus(screen.getByLabelText("Cell"));
  expect(screen.getByLabelText("Cell").tagName).toBe("TEXTAREA");
});

it("a read-only cell cannot be edited", () => {
  render(<RichCell label="Cell" value="text" readOnly onChange={() => undefined} />);
  fireEvent.click(screen.getByLabelText("Cell"));
  expect(screen.getByLabelText("Cell").tagName).toBe("DIV");
});
