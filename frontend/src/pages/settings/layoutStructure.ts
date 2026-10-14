import type { LayoutTemplate } from "../../types";

export type SectionNode = { template_id: string; children: string[] };

export function byOrder(templates: LayoutTemplate[]): LayoutTemplate[] {
  return [...templates].sort((a, b) => a.sequence_order - b.sequence_order);
}

export function toStructure(templates: LayoutTemplate[]): SectionNode[] {
  const ordered = byOrder(templates);
  return ordered
    .filter((item) => !item.parent_id)
    .map((parent) => ({
      template_id: parent.template_id,
      children: ordered.filter((item) => item.parent_id === parent.template_id).map((item) => item.template_id),
    }));
}

/** Move `dragId` onto `targetId`. Returns null when the move is not allowed. */
export function applyMove(structure: SectionNode[], dragId: string, targetId: string): SectionNode[] | null {
  if (dragId === targetId) return null;
  const dragIsTop = structure.some((node) => node.template_id === dragId);
  const targetIsTop = structure.some((node) => node.template_id === targetId);
  if (dragIsTop) {
    // A section with children can only be reordered among top-level sections.
    if (!targetIsTop) return null;
    const without = structure.filter((node) => node.template_id !== dragId);
    const dragged = structure.find((node) => node.template_id === dragId)!;
    const index = without.findIndex((node) => node.template_id === targetId);
    // Dropping downwards lands after the target, upwards before it.
    const from = structure.findIndex((node) => node.template_id === dragId);
    const to = structure.findIndex((node) => node.template_id === targetId);
    without.splice(from < to ? index + 1 : index, 0, dragged);
    return without;
  }
  const stripped = structure.map((node) => ({ ...node, children: node.children.filter((id) => id !== dragId) }));
  if (targetIsTop) {
    return stripped.map((node) => (node.template_id === targetId ? { ...node, children: [...node.children, dragId] } : node));
  }
  return stripped.map((node) => {
    const original = structure.find((item) => item.template_id === node.template_id)!;
    const targetIndex = original.children.indexOf(targetId);
    if (targetIndex === -1) return node;
    const dragIndex = original.children.indexOf(dragId);
    const children = [...node.children];
    const index = children.indexOf(targetId);
    children.splice(dragIndex !== -1 && dragIndex < targetIndex ? index + 1 : index, 0, dragId);
    return { ...node, children };
  });
}

/** Shift a section up (-1) or down (+1) among its siblings. */
export function applyShift(structure: SectionNode[], id: string, delta: -1 | 1): SectionNode[] | null {
  const topIndex = structure.findIndex((node) => node.template_id === id);
  if (topIndex !== -1) {
    const target = topIndex + delta;
    if (target < 0 || target >= structure.length) return null;
    const next = [...structure];
    [next[topIndex], next[target]] = [next[target], next[topIndex]];
    return next;
  }
  return structure.some((node) => node.children.includes(id))
    ? structure.map((node) => {
        const index = node.children.indexOf(id);
        const target = index + delta;
        if (index === -1 || target < 0 || target >= node.children.length) return node;
        const children = [...node.children];
        [children[index], children[target]] = [children[target], children[index]];
        return { ...node, children };
      })
    : null;
}

export function applyReparent(structure: SectionNode[], id: string, parentId: string): SectionNode[] | null {
  const current = structure.find((node) => node.children.includes(id));
  if (!current || current.template_id === parentId) return null;
  return structure.map((node) => {
    if (node.template_id === current.template_id) return { ...node, children: node.children.filter((child) => child !== id) };
    if (node.template_id === parentId) return { ...node, children: [...node.children, id] };
    return node;
  });
}
