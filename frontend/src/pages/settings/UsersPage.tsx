import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, formatDate } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { type Column, DataTable } from "../../components/DataTable";
import type { Role, User } from "../../types";

export const USER_PAGE_SIZE = 20;
export const LOGIN_ID_PATTERN = /^[A-Za-z0-9]{3,64}$/;
const LOGIN_ID_HELP = "Login ID must be 3-64 letters or numbers, with no spaces or special characters";
const ROLES: Role[] = ["Admin", "Analyst", "Viewer"];

function UserDialog({ user, onSaved, onClose }: { user: User | null; onSaved: (user: User) => void; onClose: () => void }) {
  const editing = user !== null;
  const [loginId, setLoginId] = useState(user?.login_id ?? "");
  const [name, setName] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role_name ?? "Analyst");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      const saved = editing
        ? await api<User>(`/api/users/${user.user_id}`, { method: "PATCH", body: JSON.stringify({ username: name.trim(), role_name: role }) })
        : await api<User>("/api/users", {
            method: "POST",
            body: JSON.stringify({ login_id: loginId.trim(), username: name.trim(), password, role_name: role }),
          });
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
        {!editing && (
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-muted">Password</span>
            <input className="field mt-1" type="password" aria-label="Password" value={password} required minLength={8} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
          </label>
        )}
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Role</span>
          <select className="field mt-1" aria-label="Role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {ROLES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
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
    { key: "created", header: "Created", sortValue: (row) => row.created_at, className: "text-muted whitespace-nowrap", render: (row) => formatDate(row.created_at) },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <button type="button" className="icon-btn" aria-label={`Edit ${row.login_id}`} title="Edit name and role" onClick={() => setDialog(row)}>
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
        searchText={(row) => `${row.login_id} ${row.username} ${row.role_name}`}
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
