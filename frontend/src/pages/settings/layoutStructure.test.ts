import { expect, test } from "vitest";
import { applyMove, applyReparent, applyShift, type SectionNode } from "./layoutStructure";

const base: SectionNode[] = [
  { template_id: "a", children: ["a1", "a2"] },
  { template_id: "b", children: ["b1"] },
  { template_id: "c", children: [] },
];

test("moves top-level sections before or after the target", () => {
  expect(applyMove(base, "c", "a")?.map((node) => node.template_id)).toEqual(["c", "a", "b"]);
  expect(applyMove(base, "a", "c")?.map((node) => node.template_id)).toEqual(["b", "c", "a"]);
  expect(applyMove(base, "a", "a")).toBeNull();
  expect(applyMove(base, "a", "b1")).toBeNull();
});

test("moves sub-sections within and across parents", () => {
  expect(applyMove(base, "a2", "a1")?.[0].children).toEqual(["a2", "a1"]);
  expect(applyMove(base, "a1", "a2")?.[0].children).toEqual(["a2", "a1"]);
  const moved = applyMove(base, "a1", "b1")!;
  expect(moved[0].children).toEqual(["a2"]);
  expect(moved[1].children).toEqual(["a1", "b1"]);
  const onParent = applyMove(base, "a1", "c")!;
  expect(onParent[2].children).toEqual(["a1"]);
});

test("shifts among siblings and stops at the edges", () => {
  expect(applyShift(base, "b", -1)?.map((node) => node.template_id)).toEqual(["b", "a", "c"]);
  expect(applyShift(base, "a", -1)).toBeNull();
  expect(applyShift(base, "a1", 1)?.[0].children).toEqual(["a2", "a1"]);
  expect(applyShift(base, "a2", 1)?.[0].children).toEqual(["a1", "a2"]);
});

test("reparents a sub-section", () => {
  const next = applyReparent(base, "a1", "c")!;
  expect(next[0].children).toEqual(["a2"]);
  expect(next[2].children).toEqual(["a1"]);
  expect(applyReparent(base, "a1", "a")).toBeNull();
  expect(applyReparent(base, "a", "b")).toBeNull();
});
