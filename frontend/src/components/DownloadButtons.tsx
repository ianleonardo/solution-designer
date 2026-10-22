import { useState } from "react";
import { ApiError, downloadFile } from "../api";

/** Markdown and PDF downloads for one catalogue record. */
export function DownloadButtons({ path, filename }: { path: string; filename: string }) {
  const [busy, setBusy] = useState<"md" | "pdf" | "">("");
  const [error, setError] = useState("");

  async function download(format: "md" | "pdf") {
    setBusy(format);
    setError("");
    try {
      const safe = filename.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "download";
      await downloadFile(`${path}?format=${format}`, `${safe}.${format}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void download("md")}>
        {busy === "md" ? "Downloading…" : "Markdown"}
      </button>
      <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void download("pdf")}>
        {busy === "pdf" ? "Downloading…" : "PDF"}
      </button>
      {error && <p className="text-alert text-sm">{error}</p>}
    </div>
  );
}
