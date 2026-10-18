import { expect, test } from "vitest";
import { applyMove, applyReparent, applyShift, type SectionNode } from "../../../pages/settings/layoutStructure";

const node = (template_id: string, children: SectionNode[] = []): SectionNode => ({ template_id, children });

const base: SectionNode[] = [
  node("a", [node("a1"), node("a2")]),
  node("b", [node("b1")]),
  node("c"),
];

const ids = (nodes: SectionNode[]) => nodes.map((item) => item.template_id);

test("moves top-level sections before or after the target and nests onto a sub-section", () => {
  expect(ids(applyMove(base, "c", "a")!)).toEqual(["c", "a", "b"]);
  expect(ids(applyMove(base, "a", "c")!)).toEqual(["b", "c", "a"]);
  expect(applyMove(base, "a", "a")).toBeNull();
  const nested = applyMove(base, "a", "b1")!;
  expect(ids(nested)).toEqual(["b", "c"]);
  expect(nested[0].children[0].children[0].template_id).toBe("a");
  expect(ids(nested[0].children[0].children[0].children)).toEqual(["a1", "a2"]);
});

test("reorders siblings and nests a sub-section under another section", () => {
  expect(ids(applyMove(base, "a2", "a1")![0].children)).toEqual(["a2", "a1"]);
  expect(ids(applyMove(base, "a1", "a2")![0].children)).toEqual(["a2", "a1"]);
  const moved = applyMove(base, "a1", "b1")!;
  expect(ids(moved[0].children)).toEqual(["a2"]);
  expect(ids(moved[1].children[0].children)).toEqual(["a1"]);
  const onParent = applyMove(base, "a1", "c")!;
  expect(ids(onParent[2].children)).toEqual(["a1"]);
});

test("shifts among siblings and stops at the edges", () => {
  expect(ids(applyShift(base, "b", -1)!)).toEqual(["b", "a", "c"]);
  expect(applyShift(base, "a", -1)).toBeNull();
  expect(ids(applyShift(base, "a1", 1)![0].children)).toEqual(["a2", "a1"]);
  expect(applyShift(base, "a2", 1)).toBeNull();
});

test("an inside drop nests a sibling under the target", () => {
  const nested = applyMove(base, "c", "a", "inside")!;
  expect(ids(nested)).toEqual(["a", "b"]);
  expect(ids(nested[0].children)).toEqual(["a1", "a2", "c"]);
});

test("reparents a section with its children, promotes it, and rejects a cycle", () => {
  const next = applyReparent(base, "a1", "c")!;
  expect(ids(next[0].children)).toEqual(["a2"]);
  expect(ids(next[2].children)).toEqual(["a1"]);
  expect(applyReparent(base, "a1", "a")).toBeNull();
  const under = applyReparent(base, "a", "b")!;
  expect(ids(under)).toEqual(["b", "c"]);
  expect(ids(under[0].children)).toEqual(["b1", "a"]);
  expect(ids(under[0].children[1].children)).toEqual(["a1", "a2"]);
  expect(applyReparent(base, "a", "a1")).toBeNull();
  const promoted = applyReparent(base, "a1", "")!;
  expect(ids(promoted)).toEqual(["a", "a1", "b", "c"]);
  expect(ids(promoted[0].children)).toEqual(["a2"]);
});
