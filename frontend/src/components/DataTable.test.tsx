import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable, type Column } from "./DataTable";

type Row = { id: string; name: string; size: number };

const columns: Column<Row>[] = [
  { key: "name", header: "Name", render: (row) => row.name, sortValue: (row) => row.name },
  { key: "size", header: "Size", render: (row) => String(row.size), sortValue: (row) => row.size },
  { key: "actions", header: "Actions", render: () => "x" },
];

function names() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);
}

const rows: Row[] = [
  { id: "1", name: "banana", size: 10 },
  { id: "2", name: "Apple", size: 2 },
  { id: "3", name: "cherry", size: 30 },
];

describe("DataTable", () => {
  it("sorts ascending, descending and back to original order when a header is clicked", () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} pageSize={10} />);
    expect(names()).toEqual(["banana", "Apple", "cherry"]);
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(names()).toEqual(["Apple", "banana", "cherry"]);
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(names()).toEqual(["cherry", "banana", "Apple"]);
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(names()).toEqual(["banana", "Apple", "cherry"]);
  });

  it("sorts numbers numerically", () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} pageSize={10} />);
    fireEvent.click(screen.getByRole("button", { name: /Size/ }));
    expect(names()).toEqual(["Apple", "banana", "cherry"]);
    expect(screen.getByRole("columnheader", { name: /Size/ }).getAttribute("aria-sort")).toBe("ascending");
  });

  it("does not make action columns sortable", () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} pageSize={10} />);
    expect(screen.queryByRole("button", { name: /Actions/ })).toBeNull();
  });

  it("paginates and filters with search", () => {
    const many = Array.from({ length: 25 }, (_, index) => ({ id: String(index), name: `item ${index}`, size: index }));
    render(<DataTable rows={many} columns={columns} rowKey={(row) => row.id} pageSize={10} searchText={(row) => row.name} searchLabel="Find" />);
    expect(names()).toHaveLength(10);
    expect(screen.getByText("1-10 of 25")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("11-20 of 25")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find"), { target: { value: "item 2" } });
    expect(names()).toEqual(["item 2", "item 20", "item 21", "item 22", "item 23", "item 24"]);
    expect(screen.queryByLabelText("Pagination")).toBeNull();
  });

  it("shows the empty label", () => {
    render(<DataTable rows={[]} columns={columns} rowKey={(row) => row.id} pageSize={10} emptyLabel="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});
