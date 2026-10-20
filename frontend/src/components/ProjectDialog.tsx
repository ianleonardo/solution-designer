import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { Catalogs, SystemRecord } from "../types";

export type ProjectScope = { countries: string[]; systems: string[] };

/** Tick "All" or pick some codes. An empty pick is stored as "all". */
function ScopeField({
  legend,
  allLabel,
  itemLabel,
  options,
  value,
  onChange,
}: {
  legend: string;
  allLabel: string;
  itemLabel: (code: string) => string;
  options: { code: string; title?: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const all = value.length === 0;
  return (
    <fieldset className="mb-3 space-y-1.5">
      <legend className="font-label text-[10px] uppercase text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label={allLabel} checked={all} onChange={() => onChange([])} />
          {allLabel}
        </label>
        {options.map((option) => (
          <label key={option.code} className="inline-flex items-center gap-2 text-sm" title={option.title}>
            <input
              type="checkbox"
              aria-label={itemLabel(option.code)}
              checked={value.includes(option.code)}
              onChange={() => onChange(value.includes(option.code) ? value.filter((code) => code !== option.code) : [...value, option.code])}
            />
            {option.code}
          </label>
        ))}
        {options.length === 0 && <span className="text-xs text-muted">None defined yet.</span>}
      </div>
    </fieldset>
  );
}

export function ProjectDialog({
  title,
  submitLabel,
  initialName = "",
  initialDescription = "",
  initialScope = { countries: [], systems: [] },
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initialName?: string;
  initialDescription?: string;
  initialScope?: ProjectScope;
  onSubmit: (name: string, description: string, scope: ProjectScope) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [countries, setCountries] = useState<string[]>(initialScope.countries);
  const [systems, setSystems] = useState<string[]>(initialScope.systems);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [systemOptions, setSystemOptions] = useState<SystemRecord[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let current = true;
    void Promise.all([
      api<Catalogs>("/api/catalogs").catch(() => null),
      api<SystemRecord[]>("/api/systems").catch(() => [] as SystemRecord[]),
    ]).then(([catalogs, loaded]) => {
      if (!current) return;
      setCountryOptions(Array.isArray(catalogs?.countries) ? catalogs.countries : []);
      setSystemOptions(Array.isArray(loaded) ? loaded : []);
    });
    return () => {
      current = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(name.trim(), description.trim(), { countries, systems });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the project");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-xl font-semibold mb-4">{title}</h2>
        <label className="block mb-3">
          <span className="font-label text-[10px] uppercase text-muted">Project name</span>
          <input className="field mt-1" value={name} onChange={(event) => setName(event.target.value)} aria-label="Project name" required autoFocus />
        </label>
        <label className="block mb-4">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[96px]" value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Project description" maxLength={2000} />
        </label>
        <p className="mb-2 text-xs text-muted">Scope: the countries and systems this project covers. Knowledge Base pickers in its documents start filtered to them.</p>
        <ScopeField
          legend="Countries"
          allLabel="All countries"
          itemLabel={(code) => `Country ${code}`}
          options={countryOptions.map((code) => ({ code }))}
          value={countries}
          onChange={setCountries}
        />
        <ScopeField
          legend="Systems"
          allLabel="All systems"
          itemLabel={(code) => `System ${code}`}
          options={systemOptions.map((item) => ({ code: item.system_code, title: item.system_name }))}
          value={systems}
          onChange={setSystems}
        />
        {error && <p className="text-alert mb-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
