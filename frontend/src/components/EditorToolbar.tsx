import { useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { safeLink } from "../markdown";

type Item = { label: string; icon?: string; text?: string; glyph?: ReactNode; run: () => void; active?: boolean; disabled?: boolean };

function ToolbarIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
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

/** Formatting buttons for a rich text editor. The `cell` variant is the short set used inside table cells. */
export function EditorToolbar({ editor, variant = "full", label = "Formatting" }: { editor: Editor | null; variant?: "full" | "cell"; label?: string }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  if (!editor) return null;

  const chain = () => editor.chain().focus();
  const commands = editor.can() as unknown as Record<string, (() => boolean) | undefined>;
  const allowed = (command: string) => typeof commands[command] === "function" && commands[command]();
  const inTable = editor.isActive("table");
  const bold: Item = { label: "Bold", icon: "format_bold", run: () => chain().toggleBold().run(), active: editor.isActive("bold") };
  const italic: Item = { label: "Italic", icon: "format_italic", run: () => chain().toggleItalic().run(), active: editor.isActive("italic") };
  const underline: Item = {
    label: "Underline",
    icon: "format_underlined",
    run: () => chain().toggleUnderline().run(),
    active: editor.isActive("underline"),
  };
  const linkItem: Item = {
    label: "Link",
    icon: "link",
    active: editor.isActive("link") || linkOpen,
    run: () => {
      setLink((editor.getAttributes("link").href as string | undefined) ?? "");
      setLinkError("");
      setLinkOpen((value) => !value);
    },
  };
  const bullet: Item = { label: "Bullet list", icon: "format_list_bulleted", run: () => chain().toggleBulletList().run(), active: editor.isActive("bulletList") };
  const numbered: Item = { label: "Numbered list", icon: "format_list_numbered", run: () => chain().toggleOrderedList().run(), active: editor.isActive("orderedList") };

  const items: Item[] =
    variant === "cell"
      ? [bold, italic, underline, linkItem, bullet, numbered]
      : [
          ...([1, 2, 3] as const).map((level) => ({
            label: `Heading ${level}`,
            text: `H${level}`,
            run: () => chain().toggleHeading({ level }).run(),
            active: editor.isActive("heading", { level }),
          })),
          bold,
          italic,
          underline,
          { label: "Strikethrough", icon: "strikethrough_s", run: () => chain().toggleStrike().run(), active: editor.isActive("strike") },
          { label: "Code", icon: "code", run: () => chain().toggleCode().run(), active: editor.isActive("code") },
          linkItem,
          { label: "Quote", icon: "format_quote", run: () => chain().toggleBlockquote().run(), active: editor.isActive("blockquote") },
          bullet,
          numbered,
          { label: "Horizontal rule", icon: "horizontal_rule", run: () => chain().setHorizontalRule().run() },
          { label: "Insert table", glyph: <InsertTableIcon />, run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
          { label: "Add column", glyph: <AddColumnIcon />, run: () => chain().addColumnAfter().run(), disabled: !inTable || !allowed("addColumnAfter") },
          { label: "Delete column", glyph: <DeleteColumnIcon />, run: () => chain().deleteColumn().run(), disabled: !inTable || !allowed("deleteColumn") },
          { label: "Add row", glyph: <AddRowIcon />, run: () => chain().addRowAfter().run(), disabled: !inTable || !allowed("addRowAfter") },
          { label: "Delete row", glyph: <DeleteRowIcon />, run: () => chain().deleteRow().run(), disabled: !inTable || !allowed("deleteRow") },
          { label: "Delete table", icon: "delete", run: () => chain().deleteTable().run(), disabled: !inTable || !allowed("deleteTable") },
          { label: "Undo", icon: "undo", run: () => chain().undo().run(), disabled: !allowed("undo") },
          { label: "Redo", icon: "redo", run: () => chain().redo().run(), disabled: !allowed("redo") },
        ];

  function applyLink() {
    if (!link.trim()) {
      chain().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const href = safeLink(link);
    if (!href) {
      setLinkError("Use an http, https or mailto address.");
      return;
    }
    chain().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  }

  return (
    <div className="border-b border-hairline p-1 space-y-1" role="toolbar" aria-label={label}>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`icon-btn ${item.active ? "icon-btn-active" : ""}`}
            aria-label={item.label}
            aria-pressed={item.active ?? false}
            title={item.label}
            disabled={item.disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={item.run}
          >
            {item.glyph ?? (item.icon ? <span className="material-symbols-outlined text-base">{item.icon}</span> : <span className="text-[11px] font-semibold">{item.text}</span>)}
          </button>
        ))}
      </div>
      {linkOpen && (
        <div className="flex flex-wrap items-center gap-1">
          <input
            className="field flex-1 min-w-40"
            aria-label="Link address"
            placeholder="https://example.com"
            value={link}
            autoFocus
            onChange={(event) => {
              setLink(event.target.value);
              setLinkError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") setLinkOpen(false);
            }}
          />
          <button type="button" className="btn" onMouseDown={(event) => event.preventDefault()} onClick={applyLink}>
            {link.trim() ? "Apply link" : "Remove link"}
          </button>
          {linkError && <span className="text-alert text-xs">{linkError}</span>}
        </div>
      )}
    </div>
  );
}
