import { useState } from "react";
import { renderCell } from "../markdown";
import { CellEditor } from "./CellEditor";

/** A table cell that shows formatted text and turns into a small rich text editor when it is clicked or focused. */
export function RichCell({
  value,
  label,
  readOnly,
  onChange,
}: {
  value: string;
  label: string;
  readOnly: boolean;
  onChange: (markdown: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const html = renderCell(value);

  if (readOnly) {
    return <div className="rich-cell rich-md" role="textbox" aria-readonly="true" aria-label={label} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (editing) {
    return (
      <div
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false);
        }}
      >
        <CellEditor value={value} label={label} onChange={onChange} />
      </div>
    );
  }
  return (
    <div
      className="rich-cell rich-md cursor-text"
      role="textbox"
      tabIndex={0}
      aria-label={label}
      onClick={() => setEditing(true)}
      onFocus={() => setEditing(true)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
