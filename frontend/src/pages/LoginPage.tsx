import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { THEME_LABELS, themeIcon, useTheme } from "../theme";

export function LoginPage() {
  const { user, login } = useAuth();
  const { next, toggle } = useTheme();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(loginId, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink flex items-center justify-center px-4">
      <button type="button" className="btn absolute top-4 right-4" aria-label="Toggle theme" title={`Switch to ${THEME_LABELS[next]}`} onClick={toggle}>
        <span className="material-symbols-outlined">{themeIcon(next)}</span>
      </button>
      <form onSubmit={(event) => void onSubmit(event)} className="w-full max-w-md bg-panel border border-hairline rounded-lg shadow-glaze p-8">
        <div className="flex items-center gap-3 mb-6">
          <span className="h-10 w-10 rounded bg-cobalt text-on-cobalt flex items-center justify-center">
            <span className="material-symbols-outlined">hub</span>
          </span>
          <h1 className="font-headline text-2xl font-semibold leading-none">SolutionCrafter</h1>
        </div>
        <label className="block mb-3">
          <span className="font-label text-[10px] uppercase text-muted">Login ID</span>
          <input className="field mt-1" type="text" autoComplete="username" required value={loginId} onChange={(event) => setLoginId(event.target.value)} placeholder="Login ID" aria-label="Login ID" />
        </label>
        <label className="block mb-4">
          <span className="font-label text-[10px] uppercase text-muted">Password</span>
          <input className="field mt-1" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="text-alert text-sm mb-3">{error}</p>}
        <button className="btn btn-primary w-full justify-center" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
