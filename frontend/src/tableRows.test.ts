import { describe, expect, it } from "vitest";
import { movedTo, moveItem, numberRows, serialColumn } from "./tableRows";

describe("serialColumn", () => {
  it.each(["SN", "sn", "S/N", "s.n.", "No", "No.", "#", "Serial No", "Serial No.", "serial number", " SN "])("finds %s", (header) => {
    expect(serialColumn([header, "Other"])).toBe(0);
  });

  it.each([[[]], [["Item", "SN"]], [["Name"]], [["Snack"]], [["Number of users"]], [["Notes"]]])("does not find one in %j", (columns) => {
    expect(serialColumn(columns as string[])).toBe(-1);
  });
});

describe("numberRows", () => {
  it("numbers the first column in row order and pads short rows", () => {
    expect(numberRows(["SN", "A", "B"], [["9", "x", "y"], ["", "z"]])).toEqual([["1", "x", "y"], ["2", "z", ""]]);
    expect(numberRows(["SN", "A"], [])).toEqual([]);
  });

  it("hands tables without a serial column back unchanged", () => {
    const rows = [["7", "x"]];
    expect(numberRows(["Item", "A"], rows)).toBe(rows);
  });
});

describe("moving", () => {
  it("works out where a dropped row ends up", () => {
    expect(movedTo(0, 3)).toBe(2);
    expect(movedTo(2, 0)).toBe(0);
    expect(movedTo(1, 1)).toBe(1);
    expect(movedTo(1, 2)).toBe(1);
  });

  it("moves one item and leaves the original alone", () => {
    const items = ["a", "b", "c", "d"];
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(items, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(items).toEqual(["a", "b", "c", "d"]);
    expect(moveItem(items, 1, 1)).toBe(items);
    expect(moveItem(items, 1, 9)).toBe(items);
  });
});
