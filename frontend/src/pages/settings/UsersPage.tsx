import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, formatDate } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { type Column, DataTable } from "../../components/DataTable";
import { SelectField } from "../../components/SelectField";
import type { Role, User } from "../../types";

export const USER_PAGE_SIZE = 20;
export const LOGIN_ID_PATTERN = /^[A-Za-z0-9]{3,64}$/;
const LOGIN_ID_HELP = "Login ID must be 3-64 letters or numbers, with no spaces or special characters";
const ROLES: Role[] = ["Admin", "Analyst", "Viewer"];

type SignIn = "local" | "ldap";

function signInLabel(provider: string | undefined) {
  return provider === "ldap" ? "Active Directory" : "Local database";
}

function UserDialog({ user, onSaved, onClose }: { user: User | null; onSaved: (user: User) => void; onClose: () => void }) {
  const editing = user !== null;
  const [loginId, setLoginId] = useState(user?.login_id ?? "");
  const [name, setName] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role_name ?? "Analyst");
  const [signIn, setSignIn] = useState<SignIn>(user?.auth_provider === "ldap" ? "ldap" : "local");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const directory = signIn === "ldap";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!editing && !LOGIN_ID_PATTERN.test(loginId.trim())) {
      setError(LOGIN_ID_HELP);
      return;
    }
    if (!directory && (password || !editing || user?.auth_provider === "ldap") && password.length < 8) {
      setError(editing && user?.auth_provider === "ldap" ? "Set a password when changing this user to a local sign-in." : "Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      const payload: { username: string; role_name: Role; login_id?: string; password?: string; auth_provider?: SignIn } = {
        username: name.trim(),
        role_name: role,
      };
      if (!editing) payload.login_id = loginId.trim();
      if (directory) payload.auth_provider = "ldap";
      else if (editing && user?.auth_provider === "ldap") payload.auth_provider = "local";
      if (!directory && (!editing || password)) payload.password = password;
      const saved = editing
        ? await api<User>(`/api/users/${user.user_id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api<User>("/api/users", { method: "POST", body: JSON.stringify(payload) });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the user");
      setBusy(false);
    }
  }

  const title = editing ? "Edit user" : "Add user";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-xl border border-hairline bg-panel p-5 shadow-xl space-y-3" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-lg font-semibold">{title}</h2>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Login ID</span>
          <input className="field mt-1" aria-label="Login ID" value={loginId} readOnly={editing} required autoFocus={!editing} autoComplete="off" onChange={(event) => setLoginId(event.target.value)} />
          {!editing && <span className="mt-1 block text-[11px] text-muted">Letters and numbers only, no spaces. Not case-sensitive.</span>}
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Name</span>
          <input className="field mt-1" aria-label="Name" value={name} required autoFocus={editing} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Sign-in</span>
          <div className="mt-1">
            <SelectField
              aria-label="Sign-in"
              value={signIn}
              disabled={busy}
              className="w-full [&_button]:w-full [&_button]:max-w-none"
              options={[
                { value: "local", label: "Local database" },
                { value: "ldap", label: "Active Directory (LDAP)" },
              ]}
              onChange={(value) => {
                const next = value as SignIn;
                setSignIn(next);
                if (next === "ldap") setPassword("");
              }}
            />
          </div>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Password</span>
          <input
            className="field mt-1"
            type="password"
            aria-label="Password"
            value={directory ? "" : password}
            required={!directory && !editing}
            minLength={directory ? undefined : 8}
            disabled={directory || busy}
            autoComplete="new-password"
            placeholder={directory ? "Not used for Active Directory" : editing ? "Leave blank to keep the current password" : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="mt-1 block text-[11px] text-muted">
            {directory
              ? "This user signs in with their Active Directory password. No password is stored here."
              : editing
                ? "Leave blank to keep the current password."
                : "Stored in this application."}
          </span>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Role</span>
          <div className="mt-1">
            <SelectField
              aria-label="Role"
              value={role}
              disabled={busy}
              className="w-full [&_button]:w-full [&_button]:max-w-none"
              options={ROLES.map((item) => ({ value: item, label: item }))}
              onChange={(value) => setRole(value as Role)}
            />
          </div>
        </label>
        {error && <p className="text-alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {editing ? "Save" : "Add user"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<null | "add" | User>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  useEffect(() => {
    api<User[]>("/api/users")
      .then(setUsers)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load users"));
  }, []);

  async function remove() {
    if (!deleting) return;
    await api(`/api/users/${deleting.user_id}`, { method: "DELETE" });
    const id = deleting.user_id;
    setUsers((current) => current.filter((item) => item.user_id !== id));
    setDeleting(null);
  }

  const columns: Column<User>[] = [
    { key: "login", header: "Login ID", sortValue: (row) => row.login_id, className: "font-medium", render: (row) => row.login_id },
    { key: "name", header: "Name", sortValue: (row) => row.username, render: (row) => row.username },
    { key: "role", header: "Role", sortValue: (row) => row.role_name, render: (row) => <span className="text-[11px] uppercase tracking-wide">{row.role_name}</span> },
    { key: "signin", header: "Sign-in", sortValue: (row) => signInLabel(row.auth_provider), render: (row) => signInLabel(row.auth_provider) },
    { key: "created", header: "Created", sortValue: (row) => row.created_at, className: "text-muted whitespace-nowrap", render: (row) => formatDate(row.created_at) },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <button type="button" className="icon-btn" aria-label={`Edit ${row.login_id}`} title="Edit name, role, sign-in, and password" onClick={() => setDialog(row)}>
            <span className="material-symbols-outlined text-base">edit</span>
          </button>
          <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.login_id}`} title="Delete user" onClick={() => setDeleting(row)}>
            <span className="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1100px] space-y-4">
      <h1 className="font-headline text-2xl font-semibold">Users</h1>
      {error && <p className="text-alert">{error}</p>}
      <DataTable
        rows={users}
        columns={columns}
        rowKey={(row) => row.user_id}
        pageSize={USER_PAGE_SIZE}
        emptyLabel="No users found."
        searchText={(row) => `${row.login_id} ${row.username} ${row.role_name} ${signInLabel(row.auth_provider)}`}
        searchLabel="Search users"
        searchPlaceholder="Search users"
        toolbar={
          <button type="button" className="btn btn-primary" onClick={() => setDialog("add")}>
            Add user
          </button>
        }
      />
      {dialog && (
        <UserDialog
          user={dialog === "add" ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setUsers((current) => (current.some((item) => item.user_id === saved.user_id) ? current.map((item) => (item.user_id === saved.user_id ? saved : item)) : [...current, saved]));
            setDialog(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog title="Delete user" message={`Delete ${deleting.username} (${deleting.login_id})? They will no longer be able to sign in.`} onConfirm={remove} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
