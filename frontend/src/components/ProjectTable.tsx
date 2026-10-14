import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate } from "../api";
import type { Project, Role } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { type Column, DataTable } from "./DataTable";
import { ProjectDialog } from "./ProjectDialog";

function badgeClass(role: string) {
  if (role === "Admin") return "text-gold border-gold";
  if (role === "Checker") return "text-accent";
  if (role === "Maker") return "text-celadon";
  return "text-muted";
}

export const PROJECT_PAGE_SIZE = 30;

export function ProjectTable({
  projects,
  role,
  onChanged,
  emptyLabel = "No projects yet.",
  toolbar,
}: {
  projects: Project[];
  role: Role;
  onChanged: () => void;
  emptyLabel?: string;
  toolbar?: ReactNode;
}) {
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const canManageProjects = role === "Maker" || role === "Checker";

  async function saveEdit(name: string, description: string) {
    if (!editing) return;
    await api(`/api/projects/${editing.project_id}`, {
      method: "PATCH",
      body: JSON.stringify({ project_name: name, description }),
    });
    setEditing(null);
    onChanged();
  }

  async function remove() {
    if (!deleting) return;
    await api(`/api/projects/${deleting.project_id}`, { method: "DELETE" });
    setDeleting(null);
    onChanged();
  }

  const columns: Column<Project>[] = [
    { key: "name", header: "Project Name", sortValue: (row) => row.project_name, render: (row) => <span className="font-medium">{row.project_name}</span> },
    {
      key: "description",
      header: "Description",
      sortValue: (row) => row.description,
      className: "max-w-xs truncate text-muted",
      render: (row) => row.description,
    },
    { key: "status", header: "Status", sortValue: (row) => row.status, className: "capitalize", render: (row) => row.status.replaceAll("_", " ") },
    {
      key: "owner",
      header: "Owner",
      sortValue: (row) => row.owner_name,
      render: (row) => (
        <div>
          <div>{row.owner_name}</div>
          <span className={`text-[10px] uppercase ${badgeClass(row.owner_role)}`}>{row.owner_role}</span>
        </div>
      ),
    },
    {
      key: "modified",
      header: "Last Modified",
      sortValue: (row) => row.last_modified,
      className: "text-muted whitespace-nowrap",
      render: (row) => formatDate(row.last_modified),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Link className="icon-btn" to={`/projects/${row.project_id}`} aria-label={`Open document ${row.project_name}`} title="Open document">
            <span className="material-symbols-outlined text-base">description</span>
          </Link>
          {canManageProjects && (
            <button type="button" className="icon-btn" aria-label={`Edit ${row.project_name}`} title="Edit name and description" onClick={() => setEditing(row)}>
              <span className="material-symbols-outlined text-base">edit</span>
            </button>
          )}
          {canManageProjects && (
            <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${row.project_name}`} title="Delete project" onClick={() => setDeleting(row)}>
              <span className="material-symbols-outlined text-base">delete</span>
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable
        rows={projects}
        columns={columns}
        rowKey={(row) => row.project_id}
        pageSize={PROJECT_PAGE_SIZE}
        emptyLabel={emptyLabel}
        searchText={(row) => `${row.project_name} ${row.description || ""}`}
        searchLabel="Search projects"
        searchPlaceholder="Search by title or description"
        toolbar={toolbar}
      />
      {editing && (
        <ProjectDialog
          title="Edit project"
          submitLabel="Save"
          initialName={editing.project_name}
          initialDescription={editing.description}
          onSubmit={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete project"
          message={`Delete "${deleting.project_name}" and its documents? This cannot be undone.`}
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
