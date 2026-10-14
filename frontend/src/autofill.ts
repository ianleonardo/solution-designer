import { DEFAULT_FLOWCHART, defaultFlow, defaultFlowchart, flowToMermaid, flowchartToMermaid } from "./flow";
import type { Section, Template } from "./types";

const STARTER_DIAGRAMS = new Set([DEFAULT_FLOWCHART.trim(), flowchartToMermaid(defaultFlowchart()).trim(), flowToMermaid(defaultFlow()).trim()]);

/**
 * True when nobody has written anything in the section yet: only blanks, the layout's starter table rows or the
 * starter diagram. Mirrors `section_is_empty` in backend/app/content.py.
 */
export function sectionIsEmpty(section: Section | undefined, template?: Template): boolean {
  const starters = (template?.blocks ?? []).filter((block) => block.type === "table");
  let tableIndex = 0;
  for (const block of section?.blocks ?? []) {
    if (block.type === "prose" && block.markdown.trim()) return false;
    if (block.type === "table") {
      const starter = starters[tableIndex];
      tableIndex += 1;
      const starterRows = (starter && starter.type === "table" ? starter.rows ?? [] : []).map((row) => row.map(String));
      const same = JSON.stringify(block.rows.map((row) => row.map(String))) === JSON.stringify(starterRows);
      if (!same && block.rows.some((row) => row.some((cell) => String(cell).trim()))) return false;
    }
    if (block.type === "diagram") {
      const text = block.mermaid.trim();
      if (text && !STARTER_DIAGRAMS.has(text)) return false;
    }
    if (block.type === "image" && block.url.trim()) return false;
  }
  return true;
}
