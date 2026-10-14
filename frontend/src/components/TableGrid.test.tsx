import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      ["", ""],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Delete row 1" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("moves rows up and down", () => {
    const onChange = vi.fn();
    render(<TableGrid columns={["Step"]} rows={[["a"], ["b"], ["c"]]} onChange={onChange} readOnly={false} />);
    expect((screen.getByLabelText("Move row 1 up") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Move row 3 down") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Move row 2 up"));
    expect(onChange).toHaveBeenLastCalledWith([["b"], ["a"], ["c"]]);
    fireEvent.click(screen.getByLabelText("Move row 2 down"));
    expect(onChange).toHaveBeenLastCalledWith([["a"], ["c"], ["b"]]);
  });

  it("shows cell text with its formatting and pads short rows", () => {
    const { container } = render(<TableGrid columns={["A", "B"]} rows={[["**bold** and *soft*", ""]]} onChange={() => undefined} readOnly />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("soft");
    expect(container.querySelectorAll("td").length).toBe(2);
  });

  it("hides edits for a read-only grid", () => {
    render(<TableGrid columns={["SN"]} rows={[["1"]]} onChange={() => undefined} readOnly />);
    expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
    expect(screen.queryByLabelText("Move row 1 up")).toBeNull();
    expect(screen.getByLabelText("SN row 1").getAttribute("aria-readonly")).toBe("true");
  });

  it("fills a short row when one of its cells is edited", () => {
    const onChange = vi.fn();
    render(<TableGrid columns={["A", "B"]} rows={[["x"]]} onChange={onChange} readOnly={false} />);
    fireEvent.focus(screen.getByLabelText("B row 1"));
    fireEvent.change(screen.getByLabelText("B row 1"), { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledWith([["x", "y"]]);
  });
});
