import { useRef, useState, type ReactNode } from "react";

const MIME_EXTENSIONS: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "text/plain": [".txt"],
  "text/markdown": [".md", ".markdown"],
  "text/html": [".html", ".htm"],
  "application/pdf": [".pdf"],
};

function accepted(file: File, accept: string): boolean {
  const rules = accept
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    if (type === rule) return true;
    return (MIME_EXTENSIONS[rule] ?? []).some((extension) => name.endsWith(extension));
  });
}

export function FileDrop({
  accept,
  disabled,
  ariaLabel,
  file,
  onFile,
  buttonLabel = "Choose file",
  idleLabel = "Drop a file here",
  primary,
  grow,
}: {
  accept: string;
  disabled?: boolean;
  ariaLabel: string;
  file?: File | null;
  onFile: (file: File) => void;
  buttonLabel?: ReactNode;
  idleLabel?: string;
  primary?: boolean;
  grow?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState(false);

  function take(list: FileList | null) {
    const next = list?.[0];
    if (!next || disabled) return;
    if (!accepted(next, accept)) {
      setRejected(true);
      return;
    }
    setRejected(false);
    onFile(next);
  }

  return (
    <div className={`flex min-w-0 items-stretch gap-2 ${grow ? "w-full" : ""}`}>
      <button type="button" className={`btn shrink-0 ${primary ? "btn-primary" : ""}`} disabled={disabled} onClick={() => input.current?.click()}>
        {buttonLabel}
      </button>
      <div
        className={`flex min-w-0 items-center rounded-lg border border-dashed px-3 text-sm ${grow ? "min-h-10 flex-1" : "w-44"} ${
          over ? "border-accent bg-accent/10 text-ink" : "border-hairline text-muted"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files);
        }}
      >
        <span className="truncate">{rejected ? "That file type is not accepted." : file?.name || idleLabel}</span>
      </div>
      <input
        ref={input}
        className="hidden"
        type="file"
        aria-label={ariaLabel}
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
