import { useEffect, type ReactNode } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { Markdown } from "tiptap-markdown";
import { UnderlineMarkdown } from "../underline";

type MarkdownStorage = { markdown: { getMarkdown: () => string } };

type Item = {
  label: string;
  glyph: ReactNode;
  run: () => void;
  active?: boolean;
  disabled?: boolean;
};

function ToolbarIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function MaterialIcon({ name }: { name: string }) {
  return <span className="material-symbols-outlined text-base leading-none">{name}</span>;
}

function InsertTableIcon() {
  return (
    <ToolbarIcon>
      <rect x="3" y="3.5" width="18" height="17" rx="1.5" />
      <path d="M3 9h18M3 14.5h18M9 3.5v17M15 3.5v17" />
    </ToolbarIcon>
  );
}

function AddColumnIcon() {
  return (
    <ToolbarIcon>
      <rect x="2" y="4" width="13" height="16" rx="1.5" />
      <path d="M2 9.5h13M2 15h13M7.5 4v16" />
      <path d="M19 10v6M16 13h6" />
    </ToolbarIcon>
  );
}

function DeleteColumnIcon() {
  return (
    <ToolbarIcon>
      <rect x="2" y="4" width="13" height="16" rx="1.5" />
      <path d="M2 9.5h13M2 15h13M7.5 4v16" />
      <path d="M16 13h6" />
    </ToolbarIcon>
  );
}

function AddRowIcon() {
  return (
    <ToolbarIcon>
      <rect x="4" y="2" width="16" height="13" rx="1.5" />
      <path d="M4 7.5h16M9.5 2v13M14.5 2v13" />
      <path d="M12 17.5v4.5M9.75 19.75h4.5" />
    </ToolbarIcon>
  );
}

function DeleteRowIcon() {
  return (
    <ToolbarIcon>
      <rect x="4" y="2" width="16" height="13" rx="1.5" />
      <path d="M4 7.5h16M9.5 2v13M14.5 2v13" />
      <path d="M9.75 19.75h4.5" />
    </ToolbarIcon>
  );
}

const EXTENSIONS = [
  StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
  UnderlineMarkdown,
  Link.configure({ openOnClick: false, autolink: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Markdown.configure({ html: true }),
];

/** Rich text editor for Capability processing rules: styles, lists and tables. */
export function ProcessingRulesEditor({
  value,
  onChange,
  readOnly = false,
  label = "Processing rules",
}: {
  value: string;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
  label?: string;
}) {
  const editor = useEditor({
    extensions: EXTENSIONS,
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

  const chain = () => editor.chain().focus();
  const inTable = editor.isActive("table");
  const items: Item[] = [
    { label: "Bold", glyph: <MaterialIcon name="format_bold" />, run: () => chain().toggleBold().run(), active: editor.isActive("bold") },
    { label: "Italic", glyph: <MaterialIcon name="format_italic" />, run: () => chain().toggleItalic().run(), active: editor.isActive("italic") },
    {
      label: "Underline",
      glyph: <MaterialIcon name="format_underlined" />,
      run: () => chain().toggleUnderline().run(),
      active: editor.isActive("underline"),
    },
    {
      label: "Bullet list",
      glyph: <MaterialIcon name="format_list_bulleted" />,
      run: () => chain().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
    },
    {
      label: "Numbered list",
      glyph: <MaterialIcon name="format_list_numbered" />,
      run: () => chain().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
    },
    {
      label: "Insert table",
      glyph: <InsertTableIcon />,
      run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      label: "Add column",
      glyph: <AddColumnIcon />,
      run: () => chain().addColumnAfter().run(),
      disabled: !inTable || !editor.can().addColumnAfter(),
    },
    {
      label: "Delete column",
      glyph: <DeleteColumnIcon />,
      run: () => chain().deleteColumn().run(),
      disabled: !inTable || !editor.can().deleteColumn(),
    },
    {
      label: "Add row",
      glyph: <AddRowIcon />,
      run: () => chain().addRowAfter().run(),
      disabled: !inTable || !editor.can().addRowAfter(),
    },
    {
      label: "Delete row",
      glyph: <DeleteRowIcon />,
      run: () => chain().deleteRow().run(),
      disabled: !inTable || !editor.can().deleteRow(),
    },
    {
      label: "Delete table",
      glyph: <MaterialIcon name="delete" />,
      run: () => chain().deleteTable().run(),
      disabled: !inTable || !editor.can().deleteTable(),
    },
  ];

  return (
    <div className={`rules-editor rounded border border-hairline bg-panel ${readOnly ? "opacity-90" : ""}`}>
      {!readOnly && (
        <div className="border-b border-hairline p-1 flex flex-wrap gap-1" role="toolbar" aria-label="Processing rules formatting">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`icon-btn shrink-0 overflow-hidden ${item.active ? "icon-btn-active" : ""}`}
              aria-label={item.label}
              aria-pressed={item.active ?? false}
              title={item.label}
              disabled={item.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={item.run}
            >
              {item.glyph}
            </button>
          ))}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
