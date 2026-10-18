import { MAX_SECTION_DEPTH, treeFrom, type SectionNode } from "../../structure";
import type { LayoutTemplate } from "../../types";

export type { SectionNode };
export { MAX_SECTION_DEPTH };

export function byOrder(templates: LayoutTemplate[]): LayoutTemplate[] {
  return [...templates].sort((a, b) => a.sequence_order - b.sequence_order);
}

export function toStructure(templates: LayoutTemplate[]): SectionNode[] {
  return treeFrom(templates);
}

type Placed = { list: SectionNode[]; index: number };

function clone(tree: SectionNode[]): SectionNode[] {
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

function contains(node: SectionNode, id: string): boolean {
  return node.children.some((child) => child.template_id === id || contains(child, id));
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

function fitsUnder(tree: SectionNode[], parentId: string | null, node: SectionNode) {
  const parentDepth = parentId ? depthIn(tree, parentId) : -1;
  if (parentDepth === null) return false;
  return parentDepth + 1 + subtreeHeight(node) <= MAX_SECTION_DEPTH;
}

export type DropSpot = "before" | "after" | "inside";

function parentOf(nodes: SectionNode[], id: string, parent: string | null = null): string | null | undefined {
  for (const node of nodes) {
    if (node.template_id === id) return parent;
    const nested = parentOf(node.children, id, node.template_id);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** Place a section before, after, or inside the target. An omitted spot reorders siblings and nests anywhere else. */
export function applyMove(structure: SectionNode[], dragId: string, targetId: string, spot?: DropSpot): SectionNode[] | null {
  if (dragId === targetId) return null;
  const next = clone(structure);
  const drag = findNode(next, dragId);
  const target = findNode(next, targetId);
  if (!drag || !target) return null;
  const place: DropSpot = spot ?? (drag.list === target.list ? (drag.index < target.index ? "after" : "before") : "inside");
  const dragged = drag.list[drag.index];
  if (contains(dragged, targetId)) return null;

  if (place === "inside") {
    if (target.list[target.index].children.some((child) => child.template_id === dragId)) return null;
    if (!fitsUnder(next, targetId, dragged)) return null;
    const [node] = drag.list.splice(drag.index, 1);
    const landing = findNode(next, targetId);
    if (!landing) return null;
    landing.list[landing.index].children.push(node);
    return next;
  }

  const parentId = parentOf(next, targetId);
  if (parentId === undefined || !fitsUnder(next, parentId, dragged)) return null;
  const [node] = drag.list.splice(drag.index, 1);
  const landing = findNode(next, targetId);
  if (!landing) return null;
  landing.list.splice(place === "before" ? landing.index : landing.index + 1, 0, node);
  return next;
}

/** Shift a section up (-1) or down (+1) among its siblings. */
export function applyShift(structure: SectionNode[], id: string, delta: -1 | 1): SectionNode[] | null {
  const next = clone(structure);
  const placed = findNode(next, id);
  if (!placed) return null;
  const target = placed.index + delta;
  if (target < 0 || target >= placed.list.length) return null;
  const [node] = placed.list.splice(placed.index, 1);
  placed.list.splice(target, 0, node);
  return next;
}

/** Move a section under `parentId`, or to the top level when `parentId` is empty. The subtree moves with it. */
export function applyReparent(structure: SectionNode[], id: string, parentId: string): SectionNode[] | null {
  const next = clone(structure);
  const placed = findNode(next, id);
  if (!placed) return null;
  const node = placed.list[placed.index];
  if (!parentId) {
    if (placed.list === next) return null;
    const anchor = next.findIndex((item) => item.template_id === id || contains(item, id));
    placed.list.splice(placed.index, 1);
    next.splice(Math.max(anchor, 0) + 1, 0, node);
    return next;
  }
  if (parentId === id || contains(node, parentId) || !fitsUnder(next, parentId, node)) return null;
  const parent = findNode(next, parentId);
  if (!parent) return null;
  if (parent.list[parent.index].children.some((child) => child.template_id === id)) return null;
  placed.list.splice(placed.index, 1);
  const landing = findNode(next, parentId);
  if (!landing) return null;
  landing.list[landing.index].children.push(node);
  return next;
}

export function descendantIds(structure: SectionNode[], id: string): string[] {
  const placed = findNode(structure, id);
  if (!placed) return [];
  const ids: string[] = [];
  function walk(node: SectionNode) {
    ids.push(node.template_id);
    node.children.forEach(walk);
  }
  walk(placed.list[placed.index]);
  return ids;
}
