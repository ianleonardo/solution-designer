import { describe, expect, it } from "vitest";
import { indentSection, moveSection, outdentSection, toTree, type OutlineTree } from "../structure";
import type { Template } from "../types";

const node = (template_id: string, children: OutlineTree = []): OutlineTree[number] => ({ template_id, children });

const tree: OutlineTree = [
  node("a", [node("a1"), node("a2")]),
  node("b"),
  node("c", [node("c1")]),
];

describe("structure helpers", () => {
  it("builds the tree from templates in document order", () => {
    const make = (id: string, parent: string | null, order: number) => ({ template_id: id, parent_id: parent, sequence_order: order }) as Template;
    expect(toTree([make("b", null, 200), make("a1", "a", 101), make("a", null, 100)])).toEqual([
      { template_id: "a", children: [{ template_id: "a1", children: [] }] },
      { template_id: "b", children: [] },
    ]);
  });

  it("moves sections among their siblings and keeps children with them", () => {
    expect(moveSection(tree, "a", 1)?.map((entry) => entry.template_id)).toEqual(["b", "a", "c"]);
    expect(moveSection(tree, "a", -1)).toBeNull();
    expect(moveSection(tree, "c", 1)).toBeNull();
    expect(moveSection(tree, "a2", -1)?.[0].children.map((entry) => entry.template_id)).toEqual(["a2", "a1"]);
    expect(moveSection(tree, "a1", -1)).toBeNull();
    expect(moveSection(tree, "missing", 1)).toBeNull();
    expect(tree[0].children.map((entry) => entry.template_id)).toEqual(["a1", "a2"]);
  });

  it("indents under the section above and keeps that section's children", () => {
    const result = indentSection(tree, "b")!;
    expect(result.map((entry) => entry.template_id)).toEqual(["a", "c"]);
    expect(result[0].children.map((entry) => entry.template_id)).toEqual(["a1", "a2", "b"]);
    expect(indentSection(tree, "a")).toBeNull();
    const nested = indentSection(tree, "c")!;
    expect(nested.map((entry) => entry.template_id)).toEqual(["a", "b"]);
    expect(nested[1].children[0].template_id).toBe("c");
    expect(nested[1].children[0].children.map((entry) => entry.template_id)).toEqual(["c1"]);
  });

  it("outdents one level so a sub-section follows its parent", () => {
    const result = outdentSection(tree, "a1")!;
    expect(result.map((entry) => entry.template_id)).toEqual(["a", "a1", "b", "c"]);
    expect(result[0].children.map((entry) => entry.template_id)).toEqual(["a2"]);
    expect(outdentSection(tree, "b")).toBeNull();
    const deep = outdentSection([node("a", [node("a1", [node("a1x")])])], "a1x")!;
    expect(deep[0].children.map((entry) => entry.template_id)).toEqual(["a1", "a1x"]);
  });
});
