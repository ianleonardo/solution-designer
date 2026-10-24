import { useEditor, EditorContent } from "@tiptap/react";
import { richTextExtensions } from "../richEditor";
import { EditorToolbar } from "./EditorToolbar";

type MarkdownStorage = { markdown: { getMarkdown: () => string } };

/** Compact rich text editor for one table cell. The value is Markdown. */
export function CellEditor({ value, label, onChange }: { value: string; label: string; onChange: (markdown: string) => void }) {
  const editor = useEditor({
    extensions: richTextExtensions,
    content: value || "",
    autofocus: "end",
    editorProps: { attributes: { "aria-label": label, role: "textbox" } },
    onUpdate: ({ editor: current }) => {
      onChange((current.storage as unknown as MarkdownStorage).markdown.getMarkdown());
    },
  });

  return (
    <div className="cell-editor">
      <EditorToolbar editor={editor} variant="cell" />
      <EditorContent editor={editor} />
    </div>
  );
}
