import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import type { LlmProvider, ReindexStatus, Settings } from "../../types";
import { useOptionalAuth } from "../../auth";
import { can } from "../../permissions";

type ProviderForm = {
  chat_model: string;
  chat_base_url: string;
  embedding_model: string;
  embedding_base_url: string;
  api_key: string;
  embedding_api_key: string;
  verify_ssl: boolean;
  max_model_length: string;
};

function formFor(provider: LlmProvider): ProviderForm {
  return {
    chat_model: provider.chat_model,
    chat_base_url: provider.chat_base_url,
    embedding_model: provider.embedding_model,
    embedding_base_url: provider.embedding_base_url,
    api_key: "",
    embedding_api_key: "",
    verify_ssl: provider.verify_ssl !== false,
    max_model_length: String(provider.max_model_length ?? 128000),
  };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

type CardProps = {
  provider: LlmProvider;
  active: boolean;
  onActivate: () => void;
  onSaved: (provider: LlmProvider) => void;
};

export function ProviderCard({ provider, active, onActivate, onSaved }: CardProps) {
  const [form, setForm] = useState<ProviderForm>(formFor(provider));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const name = provider.label;

  function set(field: keyof ProviderForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const payload = provider.provider === "spirare" ? form : { ...form, max_model_length: undefined };
      const saved = await api<LlmProvider>(`/api/settings/providers/${provider.provider}`, { method: "PUT", body: JSON.stringify(payload) });
      setForm(formFor(saved));
      setMessage("Saved");
      onSaved(saved);
    } catch (err) {
      setError(errorText(err, "Could not save provider"));
    }
  }

  async function clearKey(field: "api_key" | "embedding_api_key") {
    setError("");
    try {
      const saved = await api<LlmProvider>(`/api/settings/providers/${provider.provider}`, { method: "PUT", body: JSON.stringify({ [`clear_${field}`]: true }) });
      onSaved(saved);
      setMessage("Key removed");
    } catch (err) {
      setError(errorText(err, "Could not remove key"));
    }
  }

  return (
    <form aria-label={`${name} settings`} className="bg-panel border border-hairline rounded-lg p-4 space-y-3" onSubmit={(event) => void save(event)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-headline text-lg font-semibold">{name}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="active-provider" aria-label={`Use ${name} as active provider`} checked={active} onChange={onActivate} />
          {active ? "Active provider" : "Use as active"}
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wide text-muted">Inference / chat</legend>
        <label className="block text-sm">
          Chat model
          <input className="field mt-1" value={form.chat_model} onChange={(event) => set("chat_model", event.target.value)} />
        </label>
        {provider.provider === "spirare" && (
          <label className="block text-sm">
            Max model length
            <input
              className="field mt-1"
              inputMode="numeric"
              aria-label="Max model length"
              value={form.max_model_length}
              onChange={(event) => set("max_model_length", event.target.value)}
            />
          </label>
        )}
        <label className="block text-sm">
          Chat URL
          <input className="field mt-1" value={form.chat_base_url} placeholder="Provider default" onChange={(event) => set("chat_base_url", event.target.value)} />
        </label>
        <label className="block text-sm">
          API key {provider.api_key_configured && <span className="text-muted">(configured)</span>}
          <input
            className="field mt-1"
            type="password"
            autoComplete="new-password"
            value={form.api_key}
            placeholder={provider.api_key_configured ? "Leave blank to keep the saved key" : "Enter API key"}
            onChange={(event) => set("api_key", event.target.value)}
          />
        </label>
        {provider.api_key_configured && (
          <button type="button" className="btn" onClick={() => void clearKey("api_key")}>Remove key</button>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wide text-muted">Embeddings / retrieval</legend>
        <label className="block text-sm">
          Embedding model
          <input className="field mt-1" value={form.embedding_model} onChange={(event) => set("embedding_model", event.target.value)} />
        </label>
        <label className="block text-sm">
          Embedding URL
          <input className="field mt-1" value={form.embedding_base_url} placeholder="Provider default" onChange={(event) => set("embedding_base_url", event.target.value)} />
        </label>
        <label className="block text-sm">
          Embedding API key {provider.embedding_api_key_configured && <span className="text-muted">(configured)</span>}
          <input
            className="field mt-1"
            type="password"
            autoComplete="new-password"
            value={form.embedding_api_key}
            placeholder="Optional. Blank uses the chat key"
            onChange={(event) => set("embedding_api_key", event.target.value)}
          />
        </label>
        {provider.embedding_api_key_configured && (
          <button type="button" className="btn" onClick={() => void clearKey("embedding_api_key")}>Remove embedding key</button>
        )}
      </fieldset>

      {provider.provider === "spirare" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Bypass SSL certificate check"
            checked={!form.verify_ssl}
            onChange={(event) => setForm((current) => ({ ...current, verify_ssl: !event.target.checked }))}
          />
          Bypass SSL certificate check
        </label>
      )}

      {error && <p className="text-alert">{error}</p>}
      {message && <p className="text-muted" role="status">{message}</p>}
      <button className="btn btn-primary" type="submit">Save {name}</button>
    </form>
  );
}

export const REINDEX_POLL_MS = 2000;

/** Saving a different embedding setup re-makes every stored vector in the background; this shows how far it is. */
function ReindexBanner({ status }: { status: ReindexStatus | null }) {
  if (!status) return null;
  if (status.running) {
    return (
      <p className="rounded-lg border border-hairline bg-panel p-3 text-accent" role="status">
        Re-indexing the knowledge base… {status.done} of {status.total}
      </p>
    );
  }
  if (!status.message) return null;
  return (
    <p className={`rounded-lg border border-hairline bg-panel p-3 ${status.failed ? "text-gold" : "text-accent"}`} role="status">
      {status.message}
    </p>
  );
}

export function LlmPage() {
  const auth = useOptionalAuth();
  // Settings read: the page is shown but cannot be changed.
  const canWrite = !auth?.user || can(auth.user, "settings", "write");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reindex, setReindex] = useState<ReindexStatus | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<Settings>("/api/settings")
      .then((loaded) => {
        setSettings(loaded);
        setPrompt(loaded.global_system_prompt);
      })
      .catch((err: unknown) => setError(errorText(err, "Could not load settings")));
  }, []);

  const refreshReindex = useCallback(async () => {
    try {
      const status = await api<ReindexStatus>("/api/reindex/status");
      setReindex(status && typeof status.running === "boolean" ? status : null);
    } catch {
      setReindex(null);
    }
  }, []);

  useEffect(() => {
    void refreshReindex();
  }, [refreshReindex]);

  useEffect(() => {
    if (!reindex?.running) return;
    const timer = window.setTimeout(() => void refreshReindex(), REINDEX_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [reindex, refreshReindex]);

  async function saveGeneral(active: Settings["active_provider"], nextPrompt: string) {
    setError("");
    setMessage("");
    try {
      const saved = await api<Settings>("/api/settings", { method: "PUT", body: JSON.stringify({ active_provider: active, global_system_prompt: nextPrompt }) });
      setSettings(saved);
      setPrompt(saved.global_system_prompt);
      setMessage("Saved");
      void refreshReindex();
    } catch (err) {
      setError(errorText(err, "Could not save settings"));
    }
  }

  function replaceProvider(saved: LlmProvider) {
    void refreshReindex();
    setSettings((current) => (current ? { ...current, providers: current.providers.map((item) => (item.provider === saved.provider ? saved : item)) } : current));
  }

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">LLM</h1>
        <p className="text-muted text-sm">API keys are encrypted and write-only. They are never shown again after saving.</p>
      </div>
      {error && <p className="text-alert">{error}</p>}
      <ReindexBanner status={reindex} />
      {!canWrite && <p className="text-sm text-muted">View only. Your role can see these settings but not change them.</p>}
      {settings && (
        <fieldset disabled={!canWrite} className="space-y-4 min-w-0">
          <div className="grid gap-4 lg:grid-cols-3">
            {settings.providers.map((provider) => (
              <ProviderCard
                key={provider.provider}
                provider={provider}
                active={settings.active_provider === provider.provider}
                onActivate={() => void saveGeneral(provider.provider, settings.global_system_prompt)}
                onSaved={replaceProvider}
              />
            ))}
          </div>
          <form
            aria-label="Global prompt"
            className="bg-panel border border-hairline rounded-lg p-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveGeneral(settings.active_provider, prompt);
            }}
          >
            <label className="block text-sm">
              Global system prompt
              <textarea className="field mt-1 min-h-32" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </label>
            {message && <p className="text-muted" role="status">{message}</p>}
            {canWrite && <button className="btn btn-primary" type="submit">Save prompt</button>}
          </form>
        </fieldset>
      )}
    </div>
  );
}
