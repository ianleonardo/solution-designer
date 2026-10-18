import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { safeLink } from "../markdown";

type Item = { label: string; icon?: string; text?: string; run: () => void; active?: boolean; disabled?: boolean };

/** Formatting buttons for a rich text editor. The `cell` variant is the short set used inside table cells. */
export function EditorToolbar({ editor, variant = "full" }: { editor: Editor | null; variant?: "full" | "cell" }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  if (!editor) return null;

  const chain = () => editor.chain().focus();
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
          { label: "Undo", icon: "undo", run: () => chain().undo().run(), disabled: !editor.can().undo() },
          { label: "Redo", icon: "redo", run: () => chain().redo().run(), disabled: !editor.can().redo() },
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
    <div className="border-b border-hairline p-1 space-y-1" role="toolbar" aria-label="Formatting">
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
            {item.icon ? <span className="material-symbols-outlined text-base">{item.icon}</span> : <span className="text-[11px] font-semibold">{item.text}</span>}
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
