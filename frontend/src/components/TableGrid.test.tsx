import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableGrid } from "./TableGrid";

// The real editor needs a browser layout engine; a plain field stands in for it here.
vi.mock("./CellEditor", () => ({
  CellEditor: ({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) => (
    <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

afterEach(cleanup);

describe("TableGrid", () => {
  it("adds, updates, and deletes rows", () => {
    const onChange = vi.fn();
    render(<TableGrid columns={["SN", "Name"]} rows={[["1", "A"]]} onChange={onChange} readOnly={false} />);
    fireEvent.focus(screen.getByLabelText("Name row 1"));
    fireEvent.change(screen.getByLabelText("Name row 1"), { target: { value: "B" } });
    expect(onChange).toHaveBeenCalledWith([["1", "B"]]);
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(onChange).toHaveBeenCalledWith([
      ["1", "A"],
      ["2", ""],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Delete row 1" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("has no arrow buttons: rows move by drag or with the keyboard", () => {
    render(<TableGrid columns={["Step"]} rows={[["a"], ["b"]]} onChange={vi.fn()} readOnly={false} />);
    expect(screen.queryByLabelText(/up$/)).toBeNull();
    expect(screen.queryByLabelText(/down$/)).toBeNull();
    expect(screen.getByLabelText("Move row 1").getAttribute("draggable")).toBe("true");
  });

  it("numbers the SN column itself and shows it read-only", () => {
    const { container } = render(<TableGrid columns={["SN", "Name"]} rows={[["9", "A"], ["", "B"], ["x", "C"]]} onChange={vi.fn()} readOnly={false} />);
    expect([...container.querySelectorAll('td[data-serial="true"]')].map((cell) => cell.textContent)).toEqual(["1", "2", "3"]);
    expect(screen.queryByLabelText("SN row 1")).toBeNull();
    expect(screen.getByLabelText("Name row 3")).toBeTruthy();
  });

  it("recognises other serial headers and leaves other tables alone", () => {
    const { container, rerender } = render(<TableGrid columns={["Serial No.", "Name"]} rows={[["", "A"], ["", "B"]]} onChange={vi.fn()} readOnly />);
    expect(container.querySelectorAll('td[data-serial="true"]').length).toBe(2);
    rerender(<TableGrid columns={["Step", "Name"]} rows={[["one", "A"], ["two", "B"]]} onChange={vi.fn()} readOnly />);
    expect(container.querySelectorAll('td[data-serial="true"]').length).toBe(0);
    expect(screen.getByLabelText("Step row 1")).toBeTruthy();
  });

  it("renumbers after adding, deleting and editing", () => {
    const onChange = vi.fn();
    render(<TableGrid columns={["SN", "Name"]} rows={[["1", "A"], ["2", "B"], ["3", "C"]]} onChange={onChange} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete row 2" }));
    expect(onChange).toHaveBeenLastCalledWith([["1", "A"], ["2", "C"]]);
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(onChange).toHaveBeenLastCalledWith([["1", "A"], ["2", "B"], ["3", "C"], ["4", ""]]);
    fireEvent.focus(screen.getByLabelText("Name row 3"));
    fireEvent.change(screen.getByLabelText("Name row 3"), { target: { value: "Z" } });
    expect(onChange).toHaveBeenLastCalledWith([["1", "A"], ["2", "B"], ["3", "Z"]]);
  });

  describe("dragging a row", () => {
    function setup(columns = ["SN", "Name"], rows = [["1", "a"], ["2", "b"], ["3", "c"]]) {
      const onChange = vi.fn();
      render(<TableGrid columns={columns} rows={rows} onChange={onChange} readOnly={false} />);
      const handle = (row: number) => screen.getByLabelText(`Move row ${row}`);
      const rowOf = (row: number) => handle(row).closest("tr") as HTMLTableRowElement;
      // jsdom has no layout: every row is 20px tall and row n starts at 20 * (n - 1).
      screen.getAllByRole("row").slice(1).forEach((tr, index) => {
        tr.getBoundingClientRect = () => ({ top: index * 20, height: 20, bottom: index * 20 + 20, left: 0, right: 100, width: 100, x: 0, y: index * 20, toJSON: () => ({}) });
      });
      const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
      // jsdom has no DragEvent, so the pointer position is added to the event by hand.
      function over(element: Element, clientY: number, type: "dragOver" | "drop" = "dragOver") {
        const event = createEvent[type](element, { dataTransfer });
        Object.defineProperty(event, "clientY", { value: clientY });
        fireEvent(element, event);
      }
      function drag(from: number, target: number, clientY: number) {
        fireEvent.dragStart(handle(from), { dataTransfer });
        over(rowOf(target), clientY);
        over(rowOf(target), clientY, "drop");
        fireEvent.dragEnd(handle(from), { dataTransfer });
      }
      return { onChange, drag, over, handle, rowOf, dataTransfer };
    }

    it("moves a row up and renumbers the SN column", () => {
      const { onChange, drag } = setup();
      drag(3, 1, 2); // the top half of row 1: in front of it
      expect(onChange).toHaveBeenCalledWith([["1", "c"], ["2", "a"], ["3", "b"]]);
    });

    it("moves a row down", () => {
      const { onChange, drag } = setup();
      drag(1, 3, 59); // the bottom half of row 3: after it
      expect(onChange).toHaveBeenCalledWith([["1", "b"], ["2", "c"], ["3", "a"]]);
    });

    it("drops between rows", () => {
      const { onChange, drag } = setup(["SN", "Name"], [["1", "a"], ["2", "b"], ["3", "c"], ["4", "d"]]);
      drag(1, 3, 41); // the bottom half of row 2 is before row 3
      expect(onChange).toHaveBeenCalledWith([["1", "b"], ["2", "a"], ["3", "c"], ["4", "d"]]);
    });

    it("does nothing when a row is dropped where it already is", () => {
      const { onChange, drag } = setup();
      drag(2, 2, 25);
      drag(2, 3, 41);
      drag(2, 1, 19);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("shows where the row will land and who is moving", () => {
      const { handle, rowOf, over, dataTransfer } = setup();
      fireEvent.dragStart(handle(1), { dataTransfer });
      expect(rowOf(1).className).toContain("opacity-40");
      over(rowOf(3), 41);
      expect(rowOf(3).className).toContain("inset_0_2px");
      over(rowOf(3), 59);
      expect(rowOf(3).className).toContain("inset_0_-2px");
      fireEvent.dragEnd(handle(1), { dataTransfer });
      expect(rowOf(1).className).not.toContain("opacity-40");
      expect(rowOf(3).className).not.toContain("inset_0");
    });

    it("moves rows in tables without an SN column too", () => {
      const { onChange, drag } = setup(["Step"], [["a"], ["b"], ["c"]]);
      drag(3, 1, 2);
      expect(onChange).toHaveBeenCalledWith([["c"], ["a"], ["b"]]);
    });

    it("ignores things dragged in from elsewhere", () => {
      const { onChange, rowOf, over } = setup();
      over(rowOf(2), 25);
      over(rowOf(2), 25, "drop");
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("moving a row with the keyboard", () => {
    it("moves with the arrow keys and keeps the handle focused", async () => {
      const onChange = vi.fn();
      const { rerender } = render(<TableGrid columns={["SN", "Name"]} rows={[["1", "a"], ["2", "b"], ["3", "c"]]} onChange={onChange} readOnly={false} />);
      fireEvent.keyDown(screen.getByLabelText("Move row 2"), { key: "ArrowUp" });
      expect(onChange).toHaveBeenLastCalledWith([["1", "b"], ["2", "a"], ["3", "c"]]);
      rerender(<TableGrid columns={["SN", "Name"]} rows={[["1", "b"], ["2", "a"], ["3", "c"]]} onChange={onChange} readOnly={false} />);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Move row 1")));
      fireEvent.keyDown(screen.getByLabelText("Move row 1"), { key: "ArrowDown" });
      expect(onChange).toHaveBeenLastCalledWith([["1", "a"], ["2", "b"], ["3", "c"]]);
    });

    it("stops at the ends and ignores other keys", () => {
      const onChange = vi.fn();
      render(<TableGrid columns={["Step"]} rows={[["a"], ["b"]]} onChange={onChange} readOnly={false} />);
      fireEvent.keyDown(screen.getByLabelText("Move row 1"), { key: "ArrowUp" });
      fireEvent.keyDown(screen.getByLabelText("Move row 2"), { key: "ArrowDown" });
      fireEvent.keyDown(screen.getByLabelText("Move row 1"), { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it("shows cell text with its formatting and pads short rows", () => {
    const { container } = render(<TableGrid columns={["A", "B"]} rows={[["**bold** and *soft*", ""]]} onChange={() => undefined} readOnly />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("soft");
    expect(container.querySelectorAll("td").length).toBe(2);
  });

  it("hides edits for a read-only grid", () => {
    const { container } = render(<TableGrid columns={["SN"]} rows={[["1"]]} onChange={() => undefined} readOnly />);
    expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
    expect(screen.queryByLabelText("Move row 1")).toBeNull();
    expect(container.querySelector('td[data-serial="true"]')?.textContent).toBe("1");
  });

  it("fills a short row when one of its cells is edited", () => {
    const onChange = vi.fn();
    render(<TableGrid columns={["A", "B"]} rows={[["x"]]} onChange={onChange} readOnly={false} />);
    fireEvent.focus(screen.getByLabelText("B row 1"));
    fireEvent.change(screen.getByLabelText("B row 1"), { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledWith([["x", "y"]]);
  });
});
