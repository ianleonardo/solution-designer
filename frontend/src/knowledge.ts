export type KnowledgeKind = { slug: string; label: string; inventoryType: string };

export const KNOWLEDGE_KINDS: KnowledgeKind[] = [
  { slug: "systems", label: "Systems", inventoryType: "Systems" },
  { slug: "capabilities", label: "Capabilities", inventoryType: "Capabilities" },
  { slug: "interfaces", label: "Interfaces", inventoryType: "Interfaces" },
  { slug: "tables", label: "Tables", inventoryType: "Tables" },
  { slug: "screens", label: "Screens", inventoryType: "Screens" },
  { slug: "batches", label: "Batches", inventoryType: "Batches" },
  { slug: "reports", label: "Reports", inventoryType: "Reports" },
  { slug: "bitbucket", label: "Bitbucket Repository", inventoryType: "Bitbucket Repos" },
  { slug: "guidelines", label: "Guidelines", inventoryType: "Guidelines" },
];
