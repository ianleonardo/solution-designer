import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type RowError } from "../api";
import { useOptionalAuth } from "../auth";
import type { Catalogs, KbBitbucketRepoRecord } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileDrop } from "./FileDrop";
import { type Column, DataTable } from "./DataTable";
import { KB_PAGE_SIZES } from "./TablePager";
import { ProcessingRulesEditor } from "./ProcessingRulesEditor";
import { can } from "../permissions";

const PAGE_SIZE = 25;
const DEFAULT_PROJECTS = ["CORE", "SPL", "DBE", "PIB", "PIBVN2", "PIBID", "SOF", "WSM", "NTN"];

function RepoFormDialog({
  project,
  repo,
  onSaved,
  onClose,
}: {
  project: string;
  repo?: KbBitbucketRepoRecord;
  onSaved: (saved: KbBitbucketRepoRecord) => void;
  onClose: () => void;
}) {
  const editing = Boolean(repo);
  const [name, setName] = useState(repo?.repo_name ?? "");
  const [description, setDescription] = useState(repo?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Repository name is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        repo_name: name.trim(),
        description: description.trim(),
      };
      const saved = repo
        ? await api<KbBitbucketRepoRecord>(`/api/bitbucket-repos/${encodeURIComponent(project)}/${encodeURIComponent(repo.repo_id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<KbBitbucketRepoRecord>(`/api/bitbucket-repos/${encodeURIComponent(project)}`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save repository");
      setBusy(false);
    }
  }

  const title = editing ? "Edit repository" : "Add repository";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3" onSubmit={(e) => void submit(e)}>
        <div>
          <h2 className="font-headline text-xl font-semibold">{title}</h2>
          <p className="text-xs text-muted mt-1">Project: {project}</p>
        </div>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Repository name</span>
          <input className="field mt-1" aria-label="Repository name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-20" aria-label="Description" value={description} disabled={busy} placeholder="Leave empty to infer a description" onChange={(e) => setDescription(e.target.value)} />
        </label>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}

function RepoDetailDialog({
  project,
  repo,
  canEdit,
  onClose,
  onSaved,
}: {
  project: string;
  repo: KbBitbucketRepoRecord;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (saved: KbBitbucketRepoRecord) => void;
}) {
  const [components, setComponents] = useState(repo.main_components);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await api<KbBitbucketRepoRecord>(`/api/bitbucket-repos/${encodeURIComponent(project)}/${encodeURIComponent(repo.repo_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ main_components: components }),
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save main components");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Repository detail" className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-label text-[10px] uppercase text-muted">{project}</p>
            <h2 className="font-headline text-xl font-semibold mt-0.5">{repo.repo_name}</h2>
            {repo.description && <p className="text-sm text-muted mt-1">{repo.description}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-label text-[10px] uppercase text-muted">Main components</span>
            {canEdit && (
              <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save components"}
              </button>
            )}
          </div>
          <ProcessingRulesEditor value={components} onChange={setComponents} readOnly={!canEdit || busy} label="Main components" toolbarLabel="Main components formatting" />
        </div>
      </div>
    </div>
  );
}

export function BitbucketReposPanel() {
  const auth = useOptionalAuth();
  // Without a signed-in user (component previews) editing stays on, as before.
  const canEdit = !auth?.user || can(auth.user, "knowledge", "write");
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<string[]>(DEFAULT_PROJECTS);
  const requested = (params.get("tab") ?? "").toUpperCase();
  const project = projects.includes(requested) ? requested : projects[0];
  const [repos, setRepos] = useState<KbBitbucketRepoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<RowError[]>([]);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<{ repo?: KbBitbucketRepoRecord } | null>(null);
  const [detail, setDetail] = useState<KbBitbucketRepoRecord | null>(null);
  const [deleting, setDeleting] = useState<KbBitbucketRepoRecord | null>(null);

  useEffect(() => {
    api<Catalogs>("/api/catalogs")
      .then((data) => {
        if (data.bitbucket_projects?.length) setProjects(data.bitbucket_projects);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setRepos([]);
    setError("");
    setProblems([]);
    setNotice("");
    api<KbBitbucketRepoRecord[]>(`/api/bitbucket-repos/${encodeURIComponent(project)}`)
      .then((data) => current && setRepos(data))
      .catch((err: unknown) => current && setError(err instanceof ApiError ? err.message : "Could not load repositories"))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [project]);

  async function upload(file: File) {
    setUploading(true);
    setError("");
    setProblems([]);
    setNotice("");
    try {
      const body = new FormData();
      body.append("file", file);
      const saved = await api<KbBitbucketRepoRecord[]>(`/api/bitbucket-repos/${encodeURIComponent(project)}/upload`, { method: "POST", body });
      setRepos(saved);
      setNotice(`${project} now has ${saved.length} repositor${saved.length === 1 ? "y" : "ies"}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      if (err instanceof ApiError) setProblems(err.errors);
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    await api(`/api/bitbucket-repos/${encodeURIComponent(project)}/${encodeURIComponent(deleting.repo_id)}`, { method: "DELETE" });
    const id = deleting.repo_id;
    setRepos((current) => current.filter((row) => row.repo_id !== id));
    setDeleting(null);
  }

  const columns: Column<KbBitbucketRepoRecord>[] = useMemo(
    () => [
      { key: "repo", header: "Repository", sortValue: (row) => row.repo_name, render: (row) => row.repo_name },
      {
        key: "description",
        header: "Description",
        className: "max-w-md",
        render: (row) => <span className="line-clamp-2">{row.description}</span>,
      },
      ...(canEdit
        ? [
            {
              key: "actions",
              header: "",
              className: "w-24 text-right",
              render: (row: KbBitbucketRepoRecord) => (
                <span className="inline-flex gap-1 justify-end">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Edit ${row.repo_name}`}
                    title="Edit"
                    onClick={(event) => {
                      event.stopPropagation();
                      setForm({ repo: row });
                    }}
                  >
                    <span className="material-symbols-outlined text-base">edit</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label={`Delete ${row.repo_name}`}
                    title="Delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleting(row);
                    }}
                  >
                    <span className="material-symbols-outlined text-base">delete</span>
                  </button>
                </span>
              ),
            },
          ]
        : []),
    ],
    [canEdit],
  );

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div>
        <h1 className="font-headline text-2xl font-semibold">Bitbucket Repositories</h1>
        <p className="text-muted mt-0.5">
          Repositories for each Bitbucket project. Add them manually or upload an Excel (.xlsx) with columns BITBUCKET_PROJECT, BITBUCKET_REPO_NAME, DESCRIPTION, MAIN_COMPONENTS. An empty description is filled in from the project and repository.
        </p>
      </div>
      <div role="tablist" aria-label="Bitbucket projects" className="flex gap-1 border-b border-hairline flex-wrap">
        {projects.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === project}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${item === project ? "border-[var(--accent,currentColor)] font-semibold" : "border-transparent text-muted hover:text-inherit"}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("tab", item);
              setParams(next);
            }}
          >
            {item}
          </button>
        ))}
      </div>
      {error && <p className="text-alert">{error}</p>}
      {problems.length > 0 && (
        <ul className="max-h-56 overflow-auto rounded-lg border border-hairline p-3 text-alert space-y-1" aria-label="Upload problems">
          {problems.map((problem, index) => (
            <li key={index}>
              Row {problem.row}, {problem.field}: {problem.message}
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="text-accent" role="status">
          {notice}
        </p>
      )}
      <DataTable
        key={project}
        rows={repos}
        columns={columns}
        rowKey={(row) => row.repo_id}
        pageSize={PAGE_SIZE}
        pageSizes={KB_PAGE_SIZES}
        emptyLabel={loading ? "Loading…" : `No ${project} repositories found.`}
        searchLabel={`Search ${project} repositories`}
        searchPlaceholder={`Search ${project} repositories`}
        searchText={(row) => [row.repo_name, row.description, row.main_components].join(" ")}
        onRowClick={setDetail}
        toolbar={
          canEdit ? (
            <div className="flex items-center gap-2">
              <button type="button" className="btn" onClick={() => setForm({})}>
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  add
                </span>
                Add
              </button>
              <FileDrop
                primary
                accept=".xlsx"
                ariaLabel={`Upload ${project} Excel`}
                disabled={uploading}
                idleLabel="Drop file"
                buttonLabel={
                  <>
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      upload
                    </span>
                    {uploading ? "Uploading…" : "Upload Excel"}
                  </>
                }
                onFile={(file) => void upload(file)}
              />
            </div>
          ) : undefined
        }
      />
      {form && (
        <RepoFormDialog
          project={project}
          repo={form.repo}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            setRepos((current) => {
              const index = current.findIndex((row) => row.repo_id === saved.repo_id);
              if (index === -1) return [...current, saved];
              const next = [...current];
              next[index] = saved;
              return next;
            });
            setForm(null);
          }}
        />
      )}
      {detail && (
        <RepoDetailDialog
          project={project}
          repo={detail}
          canEdit={canEdit}
          onClose={() => setDetail(null)}
          onSaved={(saved) => {
            setRepos((current) => current.map((row) => (row.repo_id === saved.repo_id ? saved : row)));
            setDetail(saved);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete repository"
          message={`Delete repository ${deleting.repo_name}? This cannot be undone.`}
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
