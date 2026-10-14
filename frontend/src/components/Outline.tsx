import { useState } from "react";

export type OutlineItem = {
  id: string;
  name: string;
  depth: number;
  missing: number;
};

/** Structure actions of the outline. Passing them turns on the "Edit structure" switch. */
export type OutlineEditor = {
  onRename: (id: string, name: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onDelete: (id: string) => void;
  onSettings: (id: string) => void;
  onAdd: (parentId: string | null) => void;
  busy?: boolean;
};

export function Outline({
  items,
  active,
  onSelect,
  onFill,
  fillingId,
  editor,
}: {
  items: OutlineItem[];
  active: string;
  onSelect: (id: string) => void;
  onFill?: (id: string) => void;
  fillingId?: string;
  editor?: OutlineEditor;
}) {
  const [editing, setEditing] = useState(false);
  const editMode = editing && editor !== undefined;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-hairline flex items-center gap-2">
        <span className="material-symbols-outlined text-accent text-sm">format_list_numbered</span>
        <span className="font-label text-xs uppercase tracking-wide flex-1">Document Outline</span>
        {editor && (
          <button type="button" className={`btn ${editMode ? "btn-primary" : ""}`} aria-pressed={editMode} onClick={() => setEditing((value) => !value)}>
            <span className="material-symbols-outlined text-sm">{editMode ? "check" : "edit"}</span>
            {editMode ? "Done" : "Edit structure"}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {items.map((item, index) =>
          editMode && editor ? (
            <EditRow
              key={item.id}
              item={item}
              active={active === item.id}
              first={index === 0}
              last={index === items.length - 1}
              editor={editor}
              onSelect={onSelect}
            />
          ) : (
            <div key={item.id} className="flex items-stretch gap-1" style={{ paddingLeft: `${item.depth * 12}px` }}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className={`min-w-0 flex-1 text-left rounded px-2 py-2 border ${active === item.id ? "border-hairline bg-inset" : "border-transparent hover:bg-inset"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{item.name}</span>
                  {item.missing > 0 && (
                    <span className="shrink-0 rounded-full border border-alert px-1.5 text-[10px] text-alert" style={{ borderColor: "var(--cinnabar)" }}>
                      Missing information
                    </span>
                  )}
                </span>
              </button>
              {onFill && (
                <button
                  type="button"
                  className="btn shrink-0 px-2"
                  aria-label={`Auto fill ${item.name}`}
                  disabled={fillingId === item.id}
                  onClick={() => onFill(item.id)}
                >
                  <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                </button>
              )}
            </div>
          ),
        )}
        {editMode && editor && (
          <button type="button" className="btn w-full justify-center" disabled={editor.busy} onClick={() => editor.onAdd(null)}>
            <span className="material-symbols-outlined text-sm">add</span>
            Add section
          </button>
        )}
      </div>
    </div>
  );
}

function EditRow({
  item,
  active,
  first,
  last,
  editor,
  onSelect,
}: {
  item: OutlineItem;
  active: boolean;
  first: boolean;
  last: boolean;
  editor: OutlineEditor;
  onSelect: (id: string) => void;
}) {
  const busy = editor.busy ?? false;
  const topLevel = item.depth === 0;
  return (
    <div className={`rounded border p-1 space-y-1 ${active ? "border-hairline bg-inset" : "border-transparent"}`} style={{ marginLeft: `${item.depth * 12}px` }}>
      <input
        key={`${item.id}-${item.name}`}
        className="field"
        aria-label={`Section name ${item.name}`}
        defaultValue={item.name}
        disabled={busy}
        onFocus={() => onSelect(item.id)}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (!next) {
            event.currentTarget.value = item.name;
            return;
          }
          if (next !== item.name) editor.onRename(item.id, next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <div className="flex flex-wrap gap-0.5">
        <button type="button" className="icon-btn" aria-label={`Move up ${item.name}`} title="Move up" disabled={busy || first} onClick={() => editor.onMove(item.id, -1)}>
          <span className="material-symbols-outlined text-base">arrow_upward</span>
        </button>
        <button type="button" className="icon-btn" aria-label={`Move down ${item.name}`} title="Move down" disabled={busy || last} onClick={() => editor.onMove(item.id, 1)}>
          <span className="material-symbols-outlined text-base">arrow_downward</span>
        </button>
        {topLevel ? (
          <button type="button" className="icon-btn" aria-label={`Indent ${item.name}`} title="Make it a sub-section of the section above" disabled={busy || first} onClick={() => editor.onIndent(item.id)}>
            <span className="material-symbols-outlined text-base">format_indent_increase</span>
          </button>
        ) : (
          <button type="button" className="icon-btn" aria-label={`Outdent ${item.name}`} title="Make it a top-level section" disabled={busy} onClick={() => editor.onOutdent(item.id)}>
            <span className="material-symbols-outlined text-base">format_indent_decrease</span>
          </button>
        )}
        {topLevel && (
          <button type="button" className="icon-btn" aria-label={`Add sub-section to ${item.name}`} title="Add sub-section" disabled={busy} onClick={() => editor.onAdd(item.id)}>
            <span className="material-symbols-outlined text-base">add</span>
          </button>
        )}
        <button type="button" className="icon-btn" aria-label={`Settings ${item.name}`} title="Section settings" disabled={busy} onClick={() => editor.onSettings(item.id)}>
          <span className="material-symbols-outlined text-base">tune</span>
        </button>
        <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${item.name}`} title="Delete" disabled={busy} onClick={() => editor.onDelete(item.id)}>
          <span className="material-symbols-outlined text-base">delete</span>
        </button>
      </div>
    </div>
  );
}
