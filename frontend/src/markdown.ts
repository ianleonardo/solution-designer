import MarkdownIt from "markdown-it";

// Raw HTML is switched off, so text written in a document can only produce Markdown formatting.
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true }).enable("table");

/** TipTap stores underline as `<u>…</u>`; restore those tags after Markdown escapes everything else. */
export function restoreUnderline(html: string): string {
  return html.replace(/&lt;u&gt;/gi, "<u>").replace(/&lt;\/u&gt;/gi, "</u>");
}

/** A markdown field as HTML, including headings and tables. */
export function renderMarkdown(source: string): string {
  return restoreUnderline(markdown.render(source ?? ""));
}

/** Markdown of a table cell as HTML: inline formatting for one line, blocks (lists, paragraphs) for several. */
export function renderCell(source: string): string {
  const text = (source ?? "").trim();
  if (!text) return "";
  const html = text.includes("\n") ? markdown.render(text) : markdown.renderInline(text);
  return restoreUnderline(html);
}

/** Only these link targets are accepted from the link box. A bare address gets https://. Null means refuse. */
export function safeLink(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (/^(https?:|mailto:)/i.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
  return `https://${text}`;
}
