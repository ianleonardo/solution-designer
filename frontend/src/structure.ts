import type { Template } from "./types";

/** Sections with their sub-sections, in document order. Two levels at most. */
export type OutlineTree = { template_id: string; children: string[] }[];

export function toTree(templates: Template[]): OutlineTree {
  const ordered = [...templates].sort((a, b) => a.sequence_order - b.sequence_order);
  return ordered
    .filter((item) => !item.parent_id)
    .map((parent) => ({
      template_id: parent.template_id,
      children: ordered.filter((item) => item.parent_id === parent.template_id).map((item) => item.template_id),
    }));
}

function clone(tree: OutlineTree): OutlineTree {
  return tree.map((entry) => ({ ...entry, children: [...entry.children] }));
}

function swap<T>(list: T[], from: number, to: number) {
  [list[from], list[to]] = [list[to], list[from]];
}

/** Move a section (or sub-section) one place up (-1) or down (1) among its siblings. Null when it cannot move. */
export function moveSection(tree: OutlineTree, id: string, delta: -1 | 1): OutlineTree | null {
  const next = clone(tree);
  const top = next.findIndex((entry) => entry.template_id === id);
  if (top >= 0) {
    const target = top + delta;
    if (target < 0 || target >= next.length) return null;
    swap(next, top, target);
    return next;
  }
  const parent = next.find((entry) => entry.children.includes(id));
  if (!parent) return null;
  const index = parent.children.indexOf(id);
  const target = index + delta;
  if (target < 0 || target >= parent.children.length) return null;
  swap(parent.children, index, target);
  return next;
}

/** Make a top-level section without sub-sections the last sub-section of the section above it. */
export function indentSection(tree: OutlineTree, id: string): OutlineTree | null {
  const next = clone(tree);
  const index = next.findIndex((entry) => entry.template_id === id);
  if (index <= 0 || next[index].children.length > 0) return null;
  next[index - 1].children.push(id);
  next.splice(index, 1);
  return next;
}

/** Turn a sub-section into a top-level section placed right after its parent. */
export function outdentSection(tree: OutlineTree, id: string): OutlineTree | null {
  const next = clone(tree);
  const index = next.findIndex((entry) => entry.children.includes(id));
  if (index < 0) return null;
  next[index].children = next[index].children.filter((child) => child !== id);
  next.splice(index + 1, 0, { template_id: id, children: [] });
  return next;
}
