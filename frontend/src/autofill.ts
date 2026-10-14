import { STARTER_DIAGRAMS } from "./mermaidTemplates";
import { serialColumn } from "./tableRows";
import type { Section, Template } from "./types";

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
      // The Serial No column is numbered by the app, so it says nothing about whether anyone wrote in the table.
      const skip = serialColumn(block.columns);
      const plain = (row: string[]) => row.filter((_, index) => index !== skip).map(String);
      const starterRows = (starter && starter.type === "table" ? starter.rows ?? [] : []).map(plain);
      const same = JSON.stringify(block.rows.map(plain)) === JSON.stringify(starterRows);
      if (!same && block.rows.some((row) => plain(row).some((cell) => cell.trim()))) return false;
    }
    if (block.type === "diagram") {
      const text = block.mermaid.trim();
      if (text && !STARTER_DIAGRAMS.has(text)) return false;
    }
    if (block.type === "image" && block.url.trim()) return false;
  }
  return true;
}
