import { useEffect, useState } from "react";
import { api, ApiError, authHeaders } from "../api";
import { FileDrop } from "./FileDrop";

/** Loads a protected image with the session token and shows it through an object URL. */
export function AuthImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setSrc("");
    setFailed(false);
    fetch(url, { headers: authHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error("Image unavailable");
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  if (failed) return <p className="text-alert text-sm">The image could not be loaded.</p>;
  if (!src) return <p className="text-muted text-sm">Loading image…</p>;
  return <img src={src} alt={alt} className="max-w-full rounded border border-hairline" />;
}

export function ImageBlock({
  projectId,
  block,
  readOnly,
  onChange,
  onError,
}: {
  projectId: string;
  block: { url: string; caption: string; alt: string };
  readOnly: boolean;
  onChange: (next: { url: string; caption: string; alt: string }) => void;
  onError: (message: string) => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const saved = await api<{ url: string }>(`/api/projects/${projectId}/images`, { method: "POST", body });
      onChange({ ...block, url: saved.url });
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Image upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <figure className="space-y-2 rounded-lg border border-hairline bg-panel p-3" aria-label="Image block">
      {block.url ? <AuthImage url={block.url} alt={block.alt || block.caption} /> : <p className="text-muted text-sm">No image uploaded.</p>}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <FileDrop
            accept="image/png,image/jpeg,image/gif,image/webp"
            ariaLabel="Upload image"
            disabled={uploading}
            idleLabel="Drop image"
            buttonLabel={uploading ? "Uploading…" : block.url ? "Replace image" : "Upload image"}
            onFile={(file) => void upload(file)}
          />
          {block.url && (
            <button type="button" className="btn" onClick={() => onChange({ ...block, url: "" })}>
              Remove image
            </button>
          )}
        </div>
      )}
      <label className="block text-sm">
        Caption
        <input
          className="field mt-1"
          aria-label="Image caption"
          value={block.caption}
          readOnly={readOnly}
          onChange={(event) => onChange({ ...block, caption: event.target.value })}
        />
      </label>
    </figure>
  );
}
