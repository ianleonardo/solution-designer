import { useEditor, EditorContent } from "@tiptap/react";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
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
    extensions: [StarterKit, Link.configure({ openOnClick: false, autolink: false }), Markdown],
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
