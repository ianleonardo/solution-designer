/** One problem found in an uploaded file: the spreadsheet row, the column and what is wrong. */
export type RowError = { row: number; field: string; message: string };

export class ApiError extends Error {
  status: number;
  errors: RowError[];

  constructor(status: number, message: string, errors: RowError[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export function authHeaders(): Headers {
  const headers = new Headers();
  const token = localStorage.getItem("token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = authHeaders();
  const extra = new Headers(options.headers);
  extra.forEach((value, key) => headers.set(key, value));
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let detail = response.statusText;
    let errors: RowError[] = [];
    try {
      const body = (await response.json()) as { detail?: unknown; errors?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
      if (Array.isArray(body.errors)) errors = body.errors as RowError[];
    } catch {
      detail = response.statusText;
    }
    throw new ApiError(response.status, detail, errors);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Fetches a protected file with the login token and saves it in the browser under `filename`. */
export async function downloadFile(path: string, filename: string) {
  const response = await fetch(path, { headers: authHeaders() });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      detail = response.statusText;
    }
    throw new ApiError(response.status, detail);
  }
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

export async function readSse(response: Response, onEvent: (event: Record<string, unknown>) => void) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((item) => item.startsWith("data:"));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
    }
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Formats a timestamp for tables as DD-MMM YYYY, e.g. 13-Oct 2026. The API sends UTC; values without a zone are treated as UTC. */
export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}T/.test(value) && !hasZone ? `${value}Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getDate()).padStart(2, "0")}-${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
