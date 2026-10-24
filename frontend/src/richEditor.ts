import { Extension } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { Markdown } from "tiptap-markdown";
import { UnderlineMarkdown } from "./underline";

/** markdown-it leaves GFM tables off unless this is enabled, so a pasted table would stay as text. */
const MarkdownTables = Extension.create({
  name: "markdownTables",
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdown: { enable: (rule: string) => void }) {
            markdown.enable("table");
          },
        },
      },
    };
  },
});

/** Headings, marks, lists, quotes, rules and tables. Shared by every rich text box. */
export const richTextExtensions = [
  StarterKit,
  UnderlineMarkdown,
  Link.configure({ openOnClick: false, autolink: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  MarkdownTables,
  Markdown.configure({ html: true }),
];
