import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { useOptionalAuth } from "../../auth";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { type Column, DataTable } from "../../components/DataTable";
import { AREAS, can, type Area, type Level } from "../../permissions";
import type { RoleRecord } from "../../types";

const LEVEL_LABEL: Record<Level, string> = { write: "Write", read: "Read only", none: "No access" };
const LEVEL_TONE: Record<Level, string> = {
  write: "bg-cobalt text-on-cobalt",
  read: "bg-inset text-ink",
  none: "text-muted",
};

export function LevelBadge({ level }: { level: Level }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${LEVEL_TONE[level]}`}>{LEVEL_LABEL[level]}</span>;
}

type Draft = { name: string; description: string } & Record<Area, Level>;

function RoleDialog({ role, onSaved, onClose }: { role: RoleRecord | null; onSaved: (role: RoleRecord) => void; onClose: () => void }) {
  const editing = role !== null;
  const [draft, setDraft] = useState<Draft>({
    name: role?.name ?? "",
    description: role?.description ?? "",
    projects: role?.projects ?? "read",
    knowledge: role?.knowledge ?? "read",
    settings: role?.settings ?? "none",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setRead(area: Area, checked: boolean) {
    // without read there is nothing to write either
    setDraft((current) => ({ ...current, [area]: checked ? (current[area] === "write" ? "write" : "read") : "none" }));
  }

  function setWrite(area: Area, checked: boolean) {
    // writing includes viewing
    setDraft((current) => ({ ...current, [area]: checked ? "write" : current[area] === "none" ? "none" : "read" }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
      const saved = editing
        ? await api<RoleRecord>(`/api/roles/${encodeURIComponent(role.role_id)}`, { method: "PATCH", body })
        : await api<RoleRecord>("/api/roles", { method: "POST", body });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the role");
      setBusy(false);
    }
  }

  const title = editing ? "Edit role" : "Add role";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-xl border border-hairline bg-panel p-5 shadow-xl space-y-4" onSubmit={(event) => void submit(event)}>
        <h2 className="font-headline text-lg font-semibold">{title}</h2>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Role name</span>
          <input className="field mt-1" aria-label="Role name" value={draft.name} required maxLength={50} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted">Description</span>
          <input className="field mt-1" aria-label="Role description" value={draft.description} maxLength={200} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <fieldset>
          <legend className="text-[11px] uppercase tracking-wide text-muted">Access</legend>
          <table className="mt-1 w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-hairline font-label text-[10px] uppercase text-muted">
                <th className="py-2 text-left">Menu</th>
                <th className="py-2 w-20 text-center">Read</th>
                <th className="py-2 w-20 text-center">Write</th>
                <th className="py-2 text-left">Result</th>
              </tr>
            </thead>
            <tbody>
              {AREAS.map((area) => (
                <tr key={area.key} className="border-b border-hairline last:border-b-0">
                  <td className="py-2">{area.label}</td>
                  <td className="py-2 text-center">
                    <input type="checkbox" aria-label={`${area.label} read`} checked={draft[area.key] !== "none"} onChange={(event) => setRead(area.key, event.target.checked)} />
                  </td>
                  <td className="py-2 text-center">
                    <input type="checkbox" aria-label={`${area.label} write`} checked={draft[area.key] === "write"} onChange={(event) => setWrite(area.key, event.target.checked)} />
                  </td>
                  <td className="py-2">
                    <LevelBadge level={draft[area.key]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            Read shows the menu and its items without changes. Write also allows add, edit and delete, and includes Read. With neither, the menu is hidden.
          </p>
        </fieldset>
        {error && <p className="text-alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.name.trim()}>
            {editing ? "Save" : "Add role"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function RolesPage() {
  const auth = useOptionalAuth();
  const canWrite = !auth?.user || can(auth.user, "settings", "write");
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<null | "add" | RoleRecord>(null);
  const [deleting, setDeleting] = useState<RoleRecord | null>(null);

  useEffect(() => {
    api<RoleRecord[]>("/api/roles")
      .then(setRoles)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load roles"));
  }, []);

  async function remove() {
    if (!deleting) return;
    await api(`/api/roles/${encodeURIComponent(deleting.role_id)}`, { method: "DELETE" });
    const id = deleting.role_id;
    setRoles((current) => current.filter((item) => item.role_id !== id));
    setDeleting(null);
  }

  const columns: Column<RoleRecord>[] = [
    {
      key: "name",
      header: "Role",
      sortValue: (row) => row.name,
      render: (row) => (
        <div>
          <div className="font-medium">
            {row.name}
            {row.is_system && <span className="ml-2 font-label text-[10px] uppercase text-muted">Predefined</span>}
          </div>
          {row.description && <div className="text-xs text-muted">{row.description}</div>}
        </div>
      ),
    },
    ...AREAS.map((area) => ({
      key: area.key,
      header: area.label,
      sortValue: (row: RoleRecord) => ({ none: 0, read: 1, write: 2 })[row[area.key]],
      render: (row: RoleRecord) => <LevelBadge level={row[area.key]} />,
    })),
    { key: "users", header: "Users", sortValue: (row) => row.user_count, className: "tabular-nums", render: (row) => row.user_count },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "Actions",
            render: (row: RoleRecord) => (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Edit ${row.name}`}
                  title={row.locked ? "The Administrator role cannot be changed" : "Edit role"}
                  disabled={row.locked}
                  onClick={() => setDialog(row)}
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label={`Delete ${row.name}`}
                  title={row.is_system ? "Predefined roles cannot be deleted" : row.user_count ? "Give its users another role first" : "Delete role"}
                  disabled={row.is_system || row.user_count > 0}
                  onClick={() => setDeleting(row)}
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            ),
          } satisfies Column<RoleRecord>,
        ]
      : []),
  ];

  return (
    <div className="p-6 max-w-[1100px] space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">User Roles</h1>
        <p className="text-sm text-muted">What each role can do in Projects, the Knowledge Base and Settings. Assign roles to people on the Users page.</p>
      </div>
      {error && <p className="text-alert">{error}</p>}
      <DataTable
        rows={roles}
        columns={columns}
        rowKey={(row) => row.role_id}
        pageSize={20}
        emptyLabel="No roles found."
        searchText={(row) => `${row.name} ${row.description}`}
        searchLabel="Search roles"
        searchPlaceholder="Search roles"
        toolbar={
          canWrite ? (
            <button type="button" className="btn btn-primary" onClick={() => setDialog("add")}>
              Add role
            </button>
          ) : undefined
        }
      />
      {dialog && (
        <RoleDialog
          role={dialog === "add" ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setRoles((current) => (current.some((item) => item.role_id === saved.role_id) ? current.map((item) => (item.role_id === saved.role_id ? saved : item)) : [...current, saved]));
            setDialog(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog title="Delete role" message={`Delete the ${deleting.name} role?`} onConfirm={remove} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
