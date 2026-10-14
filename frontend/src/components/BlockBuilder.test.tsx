import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { BlockBuilder } from "./BlockBuilder";
import type { BlockSpec } from "../types";

afterEach(cleanup);

let latest: BlockSpec[] = [];

function Harness({ initial }: { initial: BlockSpec[] }) {
  const [blocks, setBlocks] = useState(initial);
  latest = blocks;
  return <BlockBuilder blocks={blocks} onChange={setBlocks} />;
}

test("adds each kind of block with sensible defaults", () => {
  render(<Harness initial={[]} />);
  for (const label of ["Header", "Text", "Table", "Image", "Diagram"]) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`${label}$`) }));
  }
  expect(latest.map((block) => block.type)).toEqual(["header", "prose", "table", "image", "diagram"]);
  expect((latest[2] as { columns: string[] }).columns).toEqual(["Column 1", "Column 2"]);
});

test("edits table columns and header settings", () => {
  render(<Harness initial={[{ type: "header", text: "", level: 1 }, { type: "table", columns: ["A"] }]} />);
  fireEvent.change(screen.getByLabelText("Block 1 header text"), { target: { value: "Overview" } });
  fireEvent.change(screen.getByLabelText("Block 1 header size"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Add column" }));
  fireEvent.change(screen.getByLabelText("Block 2 column 2"), { target: { value: "B" } });
  expect(latest[0]).toEqual({ type: "header", text: "Overview", level: 3 });
  expect((latest[1] as { columns: string[] }).columns).toEqual(["A", "B"]);
  expect((screen.getByLabelText("Remove column 1 of block 2") as HTMLButtonElement).disabled).toBe(false);
});

test("the last column cannot be removed; blocks can be reordered and removed", () => {
  render(<Harness initial={[{ type: "table", columns: ["A"] }, { type: "prose" }, { type: "diagram", sequence: false }]} />);
  expect((screen.getByLabelText("Remove column 1 of block 1") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Move block 3 up"));
  expect(latest.map((block) => block.type)).toEqual(["table", "diagram", "prose"]);
  fireEvent.click(screen.getByLabelText("Block 2 sequence diagram"));
  expect(latest[1]).toEqual({ type: "diagram", sequence: true });
  fireEvent.click(screen.getByLabelText("Remove block 1"));
  expect(latest.map((block) => block.type)).toEqual(["diagram", "prose"]);
  expect((screen.getByLabelText("Move block 1 up") as HTMLButtonElement).disabled).toBe(true);
});
