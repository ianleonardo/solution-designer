import { describe, expect, it } from "vitest";
import { indentSection, moveSection, outdentSection, toTree, type OutlineTree } from "./structure";
import type { Template } from "./types";

const tree: OutlineTree = [
  { template_id: "a", children: ["a1", "a2"] },
  { template_id: "b", children: [] },
  { template_id: "c", children: ["c1"] },
];

describe("structure helpers", () => {
  it("builds the tree from templates in document order", () => {
    const make = (id: string, parent: string | null, order: number) => ({ template_id: id, parent_id: parent, sequence_order: order }) as Template;
    expect(toTree([make("b", null, 200), make("a1", "a", 101), make("a", null, 100)])).toEqual([
      { template_id: "a", children: ["a1"] },
      { template_id: "b", children: [] },
    ]);
  });

  it("moves top-level sections with their children and sub-sections within their parent", () => {
    expect(moveSection(tree, "a", 1)?.map((entry) => entry.template_id)).toEqual(["b", "a", "c"]);
    expect(moveSection(tree, "a", -1)).toBeNull();
    expect(moveSection(tree, "c", 1)).toBeNull();
    expect(moveSection(tree, "a2", -1)?.[0].children).toEqual(["a2", "a1"]);
    expect(moveSection(tree, "a1", -1)).toBeNull();
    expect(moveSection(tree, "missing", 1)).toBeNull();
    expect(tree[0].children).toEqual(["a1", "a2"]);
  });

  it("indents a childless section under the one above and refuses otherwise", () => {
    const result = indentSection(tree, "b")!;
    expect(result.map((entry) => entry.template_id)).toEqual(["a", "c"]);
    expect(result[0].children).toEqual(["a1", "a2", "b"]);
    expect(indentSection(tree, "a")).toBeNull();
    expect(indentSection(tree, "c")).toBeNull();
  });

  it("outdents a sub-section to follow its parent", () => {
    const result = outdentSection(tree, "a1")!;
    expect(result.map((entry) => entry.template_id)).toEqual(["a", "a1", "b", "c"]);
    expect(result[0].children).toEqual(["a2"]);
    expect(outdentSection(tree, "b")).toBeNull();
  });
});
