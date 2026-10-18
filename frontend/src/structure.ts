import type { Template } from "./types";

/** A main section is depth 0. Four further levels are allowed, matching headings h2–h6. */
export const MAX_SECTION_DEPTH = 4;

export type SectionNode = { template_id: string; children: SectionNode[] };

/** Sections with their nested sub-sections, in document order. */
export type OutlineTree = SectionNode[];

type Placed = { list: SectionNode[]; index: number };

export function toTree(templates: Template[]): OutlineTree {
  return treeFrom(templates);
}

export function treeFrom(items: { template_id: string; parent_id: string | null; sequence_order: number }[]): OutlineTree {
  const ordered = [...items].sort((a, b) => a.sequence_order - b.sequence_order);
  const byParent = new Map<string | null, typeof ordered>();
  for (const item of ordered) {
    const key = item.parent_id ?? null;
    const list = byParent.get(key) ?? [];
    list.push(item);
    byParent.set(key, list);
  }
  function build(parentId: string | null): SectionNode[] {
    return (byParent.get(parentId) ?? []).map((item) => ({
      template_id: item.template_id,
      children: build(item.template_id),
    }));
  }
  return build(null);
}

export function sectionDepth(templates: { template_id: string; parent_id: string | null }[], id: string) {
  const byId = new Map(templates.map((item) => [item.template_id, item]));
  let depth = 0;
  let current = byId.get(id)?.parent_id ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = byId.get(current)?.parent_id ?? null;
  }
  return depth;
}

function clone(tree: OutlineTree): OutlineTree {
  return tree.map((entry) => ({ template_id: entry.template_id, children: clone(entry.children) }));
}

function findNode(nodes: SectionNode[], id: string): Placed | null {
  const index = nodes.findIndex((node) => node.template_id === id);
  if (index >= 0) return { list: nodes, index };
  for (const node of nodes) {
    const nested = findNode(node.children, id);
    if (nested) return nested;
  }
  return null;
}

function subtreeHeight(node: SectionNode): number {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(subtreeHeight));
}

function depthIn(nodes: SectionNode[], id: string, depth = 0): number | null {
  for (const node of nodes) {
    if (node.template_id === id) return depth;
    const nested = depthIn(node.children, id, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

function fits(tree: OutlineTree, parentId: string | null, node: SectionNode) {
  const parentDepth = parentId ? depthIn(tree, parentId) : -1;
  if (parentDepth === null) return false;
  return parentDepth + 1 + subtreeHeight(node) <= MAX_SECTION_DEPTH;
}

/** Move a section one place up (-1) or down (1) among its siblings. Null when it cannot move. */
export function moveSection(tree: OutlineTree, id: string, delta: -1 | 1): OutlineTree | null {
  const next = clone(tree);
  const placed = findNode(next, id);
  if (!placed) return null;
  const target = placed.index + delta;
  if (target < 0 || target >= placed.list.length) return null;
  const [node] = placed.list.splice(placed.index, 1);
  placed.list.splice(target, 0, node);
  return next;
}

/** Make a section the last child of the sibling above it. Its own children stay underneath. */
export function indentSection(tree: OutlineTree, id: string): OutlineTree | null {
  const next = clone(tree);
  const placed = findNode(next, id);
  if (!placed || placed.index <= 0) return null;
  const node = placed.list[placed.index];
  const parent = placed.list[placed.index - 1];
  if (!fits(next, parent.template_id, node)) return null;
  placed.list.splice(placed.index, 1);
  parent.children.push(node);
  return next;
}

/** Turn a sub-section into the next sibling of its parent. Its own children stay underneath. */
export function outdentSection(tree: OutlineTree, id: string): OutlineTree | null {
  const next = clone(tree);
  const placed = findNode(next, id);
  if (!placed || placed.list === next) return null;
  const parent = findParent(next, id);
  if (!parent) return null;
  const [node] = placed.list.splice(placed.index, 1);
  parent.list.splice(parent.index + 1, 0, node);
  return next;
}

function findParent(nodes: SectionNode[], id: string): Placed | null {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].children.some((child) => child.template_id === id)) return { list: nodes, index };
    const nested = findParent(nodes[index].children, id);
    if (nested) return nested;
  }
  return null;
}

export function sectionPlacement(tree: OutlineTree, id: string) {
  const placed = findNode(tree, id);
  if (!placed) return { canIndent: false, canOutdent: false, canMoveUp: false, canMoveDown: false };
  const node = placed.list[placed.index];
  const previous = placed.index > 0 ? placed.list[placed.index - 1].template_id : null;
  return {
    canIndent: previous !== null && fits(tree, previous, node),
    canOutdent: placed.list !== tree,
    canMoveUp: placed.index > 0,
    canMoveDown: placed.index < placed.list.length - 1,
  };
}

export function descendantIds(tree: OutlineTree, id: string): string[] {
  const placed = findNode(tree, id);
  if (!placed) return [];
  const ids: string[] = [];
  function walk(node: SectionNode) {
    ids.push(node.template_id);
    node.children.forEach(walk);
  }
  walk(placed.list[placed.index]);
  return ids;
}
