export type KnowledgeKind = { slug: string; label: string; inventoryType: string };

export const KNOWLEDGE_KINDS: KnowledgeKind[] = [
  { slug: "systems", label: "Systems", inventoryType: "Systems" },
  { slug: "capabilities", label: "Capabilities", inventoryType: "Capabilities" },
  { slug: "interfaces", label: "Interfaces", inventoryType: "Interfaces" },
  { slug: "table-definitions", label: "Table Definitions", inventoryType: "Table Definitions" },
  { slug: "screens", label: "Screens", inventoryType: "Screens" },
  { slug: "batches", label: "Batches", inventoryType: "Batches" },
  { slug: "reports", label: "Reports", inventoryType: "Reports" },
  { slug: "guidelines", label: "Guidelines", inventoryType: "Guidelines" },
];
