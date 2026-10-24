import { useEditor, EditorContent } from "@tiptap/react";
import { richTextExtensions } from "../richEditor";
import { EditorToolbar } from "./EditorToolbar";

type MarkdownStorage = { markdown: { getMarkdown: () => string } };

export function ProseEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (markdown: string) => void;
  readOnly: boolean;
}) {
  const editor = useEditor({
    extensions: richTextExtensions,
    content: value || "",
    editable: !readOnly,
    onUpdate: ({ editor: current }) => {
      const markdown = (current.storage as unknown as MarkdownStorage).markdown.getMarkdown();
      onChange(markdown);
    },
  });

  return (
    <div className="prose-editor rounded border border-hairline bg-panel">
      {!readOnly && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
