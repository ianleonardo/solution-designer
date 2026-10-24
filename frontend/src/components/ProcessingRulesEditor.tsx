import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { richTextExtensions } from "../richEditor";
import { EditorToolbar } from "./EditorToolbar";

type MarkdownStorage = { markdown: { getMarkdown: () => string } };

/** Rich text for knowledge-base fields. Same tools as the project-document editor. */
export function ProcessingRulesEditor({
  value,
  onChange,
  readOnly = false,
  label = "Processing rules",
  toolbarLabel = "Processing rules formatting",
}: {
  value: string;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
  label?: string;
  toolbarLabel?: string;
}) {
  const editor = useEditor({
    extensions: richTextExtensions,
    content: value || "",
    editable: !readOnly,
    editorProps: { attributes: { "aria-label": label, role: "textbox", class: "rules-editor-surface" } },
    onUpdate: ({ editor: current }) => {
      onChange((current.storage as unknown as MarkdownStorage).markdown.getMarkdown());
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) return null;

  return (
    <div className={`rules-editor rounded border border-hairline bg-panel ${readOnly ? "opacity-90" : ""}`}>
      {!readOnly && <EditorToolbar editor={editor} label={toolbarLabel} />}
      <EditorContent editor={editor} />
    </div>
  );
}
