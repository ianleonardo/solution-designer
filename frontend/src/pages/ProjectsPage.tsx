import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { ProjectDialog, type ProjectScope } from "../components/ProjectDialog";
import { ProjectTable } from "../components/ProjectTable";
import type { Project } from "../types";
import { can } from "../permissions";

export function ProjectsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function load() {
    api<Project[]>("/api/projects").then(setProjects).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load projects"));
  }

  useEffect(() => {
    load();
  }, []);

  async function createProject(name: string, description: string, scope: ProjectScope) {
    const created = await api<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ project_name: name, description, countries: scope.countries, systems: scope.systems }),
    });
    navigate(`/projects/${created.project_id}`);
  }

  if (!user) return null;

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <h1 className="font-headline text-2xl font-semibold">Project Documents</h1>
      {error && <p className="text-alert">{error}</p>}
      <ProjectTable
        projects={projects}
        canManage={can(user, "projects", "write")}
        onChanged={load}
        emptyLabel="No projects found."
        toolbar={
          can(user, "projects", "write") ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Create project
            </button>
          ) : undefined
        }
      />
      {creating && <ProjectDialog title="Create project" submitLabel="Create" onSubmit={createProject} onClose={() => setCreating(false)} />}
    </div>
  );
}
