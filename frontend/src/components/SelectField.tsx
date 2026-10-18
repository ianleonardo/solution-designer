import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type SelectOption = { value: string; label: string; hint?: string };

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
  id?: string;
};

/** Themed listbox select — native &lt;option&gt; popups ignore CSS on macOS. */
export function SelectField({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  disabled = false,
  className = "",
  id,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selected = options.find((item) => item.value === value) ?? options[0];
  const display = selected?.label ?? value;

  function positionMenu() {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const hasHints = options.some((item) => item.hint);
    const longest = options.reduce((max, item) => Math.max(max, item.label.length + (item.hint?.length ?? 0) / 2), 0);
    const minRem = hasHints ? Math.max(24, Math.min(36, longest * 0.55)) : Math.max(10, Math.min(22, longest * 0.7));
    const width = Math.min(Math.max(rect.width, minRem * 16), window.innerWidth - 16);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const preferUp = spaceBelow < 160 && rect.top > spaceBelow;
    setMenuStyle({
      position: "fixed",
      left: Math.max(8, left),
      width,
      top: preferUp ? undefined : rect.bottom + 4,
      bottom: preferUp ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: Math.min(320, preferUp ? rect.top - 8 : spaceBelow),
      zIndex: 80,
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
  }, [open, options]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onReposition() {
      positionMenu();
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        id={id}
        className="field field-inline select-field text-left"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="block truncate pr-1">{display || "—"}</span>
      </button>
      {open &&
        !disabled &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            className="overflow-auto rounded-lg border border-hairline bg-panel py-1 shadow-glaze"
          >
            {options.map((item) => {
              const active = item.value === value;
              return (
                <li key={item.value || "__empty"} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      active ? "bg-inset text-accent font-medium" : "text-ink hover:bg-inset"
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <span className="material-symbols-outlined text-base w-5 shrink-0">{active ? "check" : ""}</span>
                    <span className="min-w-0 flex-1 overflow-visible">
                      <span className="block whitespace-normal break-words">{item.label}</span>
                      {item.hint && (
                        <span className="mt-0.5 block whitespace-normal break-words text-[11px] text-muted font-normal leading-snug">
                          {item.hint}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
