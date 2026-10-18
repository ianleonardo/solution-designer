import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, authHeaders, readSse } from "../api";
import { useAuth } from "../auth";
import { DiagramBlock } from "../components/DiagramBlock";
import { DocumentTabs } from "../components/DocumentTabs";
import { ExportPreview, type ExportFormat } from "../components/ExportPreview";
import { AutoFillDialog, type AutoFillRequest } from "../components/AutoFillDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ImageBlock } from "../components/ImageBlock";
import { Outline, type OutlineEditor, type OutlineItem } from "../components/Outline";
import { ProseEditor } from "../components/ProseEditor";
import { ReferencesPanel } from "../components/ReferencesPanel";
import { SectionDialog, type SectionDialogMode, type SectionValues } from "../components/SectionDialog";
import { TableGrid } from "../components/TableGrid";
import { sectionIsEmpty } from "../autofill";
import { STARTER_FLOWCHART } from "../mermaidTemplates";
import { indentSection, MAX_SECTION_DEPTH, moveSection, outdentSection, sectionDepth, sectionPlacement, toTree, type OutlineTree } from "../structure";
import type { Block, Project, ProjectDocument, Sdd, Section, Template, WorkspaceData } from "../types";

const HIDDEN_ALERTS = new Set([
  "Missing NFR volumetric projections",
  "Missing maximum load",
  "Missing peak load",
  "Missing concurrent user load",
  "Missing response time",
  "Missing database growth estimates",
]);

function outlineItems(templates: Template[], missingCount: (id: string) => number): OutlineItem[] {
  const tree = toTree(templates);
  return templates.map((template) => {
    const place = sectionPlacement(tree, template.template_id);
    const depth = sectionDepth(templates, template.template_id);
    return {
      id: template.template_id,
      name: template.section_name,
      depth,
      missing: missingCount(template.template_id),
      canIndent: place.canIndent,
      canOutdent: place.canOutdent,
      canAddChild: depth < MAX_SECTION_DEPTH,
      canMoveUp: place.canMoveUp,
      canMoveDown: place.canMoveDown,
    };
  });
}

export function WorkspacePage() {
  const { projectId = "", documentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [activeId, setActiveId] = useState("");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [revision, setRevision] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [preview, setPreview] = useState<ExportFormat | null>(null);
  const [fillingId, setFillingId] = useState("");
  const [fillDialog, setFillDialog] = useState<{ scope: "section"; id: string } | { scope: "document" } | null>(null);
  const [sectionDialog, setSectionDialog] = useState<(SectionDialogMode & { parentId?: string | null }) | null>(null);
  const [deletingSection, setDeletingSection] = useState<Template | null>(null);
  const [structureBusy, setStructureBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const documentLocked = user?.role_name !== "Analyst";
  const canEditStructure = user?.role_name === "Analyst";
  const canFill = canEditStructure;

  useEffect(() => {
    api<WorkspaceData>(`/api/projects/${projectId}/workspace`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not open the project"));
  }, [projectId]);

  useEffect(() => {
    if (!data) return;
    setTitle(data.project.project_name);
  }, [data?.project.project_name]);

  const doc = data?.documents.find((item) => item.document_id === documentId) ?? data?.documents[0];
  const docId = doc?.document_id ?? "";
  const templates = [...(doc?.templates ?? [])].sort((a, b) => a.sequence_order - b.sequence_order);
  const activeTemplate = templates.find((item) => item.template_id === activeId);
  const section = doc?.content_json.sections[activeId];

  useEffect(() => {
    const first = [...(doc?.templates ?? [])].sort((a, b) => a.sequence_order - b.sequence_order)[0];
    setActiveId(first?.template_id ?? "");
    setProgress({});
    setError("");
    // Pick the first section again only when another document is opened.
  }, [docId]);

  const base = `/api/projects/${projectId}/documents/${docId}`;

  function updateDoc(id: string, change: (current: ProjectDocument) => ProjectDocument) {
    setData((current) =>
      current ? { ...current, documents: current.documents.map((item) => (item.document_id === id ? change(item) : item)) } : current,
    );
  }

  /** Apply a document payload from the API (which carries no templates) to the loaded document. */
  function mergeDoc(fresh: Sdd & { templates?: Template[] }) {
    updateDoc(fresh.document_id, (current) => ({ ...current, ...fresh, templates: fresh.templates ?? current.templates }));
  }

  function insertDiagram(afterIndex: number) {
    if (!section) return;
    const blocks = [...section.blocks];
    blocks.splice(afterIndex + 1, 0, { type: "diagram", sequence: false, mermaid: STARTER_FLOWCHART });
    replaceSection(activeId, { ...section, blocks });
  }

  function removeBlock(index: number) {
    if (!section) return;
    replaceSection(activeId, { ...section, blocks: section.blocks.filter((_, blockIndex) => blockIndex !== index) });
  }

  function replaceSection(sectionId: string, next: Section) {
    if (!doc) return;
    const content = { sections: { ...doc.content_json.sections, [sectionId]: next } };
    updateDoc(doc.document_id, (current) => ({ ...current, content_json: content }));
    queueSave(doc.document_id, content);
  }

  function queueSave(targetId: string, content: Sdd["content_json"]) {
    if (documentLocked) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void persist(targetId, content);
    }, 700);
  }

  /** Save an edit that is still waiting for its timer, so a structure change starts from the latest content. */
  async function flushSave() {
    if (!timer.current || !doc) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    await persist(doc.document_id, doc.content_json);
  }

  async function changeStructure(request: () => Promise<ProjectDocument>): Promise<ProjectDocument | null> {
    setStructureBusy(true);
    setError("");
    try {
      await flushSave();
      const fresh = await request();
      mergeDoc(fresh);
      setRevision((value) => value + 1);
      const ids = new Set(fresh.templates.map((item) => item.template_id));
      if (!ids.has(activeId)) {
        const first = [...fresh.templates].sort((a, b) => a.sequence_order - b.sequence_order)[0];
        setActiveId(first?.template_id ?? "");
      }
      return fresh;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The change could not be saved");
      return null;
    } finally {
      setStructureBusy(false);
    }
  }

  function applyOrder(next: OutlineTree | null, blocked?: string) {
    if (!next) {
      if (blocked) setError(blocked);
      return;
    }
    void changeStructure(() => api<ProjectDocument>(`${base}/sections-order`, { method: "PUT", body: JSON.stringify({ sections: next }) }));
  }

  async function saveSection(values: SectionValues) {
    const mode = sectionDialog;
    if (!mode) return;
    if (mode.kind === "edit") {
      const fresh = await changeStructureOrThrow(() =>
        api<ProjectDocument>(`${base}/sections/${mode.template.template_id}`, { method: "PATCH", body: JSON.stringify(values) }),
      );
      if (fresh) setSectionDialog(null);
      return;
    }
    const before = new Set(templates.map((item) => item.template_id));
    const fresh = await changeStructureOrThrow(() =>
      api<ProjectDocument>(`${base}/sections`, { method: "POST", body: JSON.stringify({ ...values, parent_id: mode.parentId ?? null }) }),
    );
    if (fresh) {
      const created = fresh.templates.find((item) => !before.has(item.template_id));
      if (created) setActiveId(created.template_id);
      setSectionDialog(null);
    }
  }

  /** Like changeStructure, but errors go to the dialog that asked for the change. */
  async function changeStructureOrThrow(request: () => Promise<ProjectDocument>): Promise<ProjectDocument> {
    setStructureBusy(true);
    try {
      await flushSave();
      const fresh = await request();
      mergeDoc(fresh);
      setRevision((value) => value + 1);
      return fresh;
    } finally {
      setStructureBusy(false);
    }
  }

  async function removeSection() {
    if (!deletingSection) return;
    const id = deletingSection.template_id;
    await flushSave();
    const fresh = await api<ProjectDocument>(`${base}/sections/${id}`, { method: "DELETE" });
    mergeDoc(fresh);
    setRevision((value) => value + 1);
    setDeletingSection(null);
    if (!fresh.templates.some((item) => item.template_id === activeId)) {
      const first = [...fresh.templates].sort((a, b) => a.sequence_order - b.sequence_order)[0];
      setActiveId(first?.template_id ?? "");
    }
  }

  const outlineEditor: OutlineEditor | undefined = canEditStructure
    ? {
        busy: structureBusy,
        onRename: (id, name) => void changeStructure(() => api<ProjectDocument>(`${base}/sections/${id}`, { method: "PATCH", body: JSON.stringify({ section_name: name }) })),
        onMove: (id, delta) => applyOrder(moveSection(toTree(templates), id, delta)),
        onIndent: (id) => applyOrder(indentSection(toTree(templates), id), "It has no section above to join, or nesting would go past 5 levels."),
        onOutdent: (id) => applyOrder(outdentSection(toTree(templates), id)),
        onDelete: (id) => setDeletingSection(templates.find((item) => item.template_id === id) ?? null),
        onSettings: (id) => {
          const target = templates.find((item) => item.template_id === id);
          if (target) setSectionDialog({ kind: "edit", template: target });
        },
        onAdd: (parentId) => {
          const parent = templates.find((item) => item.template_id === parentId);
          setSectionDialog({ kind: "add", parentName: parent?.section_name, parentId });
        },
      }
    : undefined;

  async function persist(targetId: string, content: Sdd["content_json"]) {
    setSaveState("saving");
    try {
      const saved = await api<Sdd>(`/api/projects/${projectId}/documents/${targetId}`, {
        method: "PUT",
        body: JSON.stringify({ content_json: content }),
      });
      updateDoc(targetId, (current) => {
        const sections = { ...current.content_json.sections };
        for (const [id, item] of Object.entries(saved.content_json.sections)) {
          if (sections[id]) sections[id] = { ...sections[id], missing: item.missing };
        }
        return { ...current, last_modified: saved.last_modified, content_json: { sections } };
      });
      setSaveState("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  async function generateAll(onlyEmpty: boolean) {
    if (!doc) return;
    const targetId = doc.document_id;
    setError("");
    setProgress({});
    setRunning(true);
    await flushSave();
    const headers = authHeaders();
    const query = onlyEmpty ? "?only_empty=true" : "";
    const response = await fetch(`/api/projects/${projectId}/documents/${targetId}/generate${query}`, { method: "POST", headers });
    if (!response.ok) {
      const body = (await response.json()) as { detail?: string };
      setError(body.detail || "Generation failed");
      setRunning(false);
      return;
    }
    await readSse(response, (event) => {
      if (event.event === "section_start") {
        setProgress((current) => ({ ...current, [String(event.section_id)]: "running" }));
      }
      if (event.event === "section_skipped") {
        setProgress((current) => ({ ...current, [String(event.section_id)]: "skipped" }));
      }
      if (event.event === "section_done") {
        const done = event.section as Section;
        setProgress((current) => ({ ...current, [done.template_id]: "done" }));
        updateDoc(targetId, (current) => ({
          ...current,
          content_json: { sections: { ...current.content_json.sections, [done.template_id]: done } },
        }));
      }
      if (event.event === "error") setError(String(event.message || "Generation failed"));
      if (event.event === "complete") {
        mergeDoc((event.document ?? event.sdd) as Sdd);
        setRevision((value) => value + 1);
      }
    });
    setRunning(false);
  }

  async function fillSection(sectionId: string, instruction = "") {
    setFillingId(sectionId);
    setError("");
    setActiveId(sectionId);
    try {
      await flushSave();
      const fresh = await api<Sdd>(`${base}/sections/${sectionId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ instruction }),
      });
      mergeDoc(fresh);
      const filled = templates.find((item) => item.template_id === sectionId);
      if (sectionIsEmpty(fresh.content_json.sections[sectionId], filled)) {
        setError("Auto fill returned nothing for this section. Add project references or an extra instruction and try again.");
      }
      setRevision((value) => value + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Auto fill failed");
    } finally {
      setFillingId("");
    }
  }

  async function addDocument(layoutId: string) {
    const created = await api<ProjectDocument>(`/api/projects/${projectId}/documents`, {
      method: "POST",
      body: JSON.stringify({ layout_id: layoutId }),
    });
    setData((current) => (current ? { ...current, documents: [...current.documents, created] } : current));
    navigate(`/projects/${projectId}/documents/${created.document_id}`);
  }

  async function removeDocument(target: ProjectDocument) {
    await api(`/api/projects/${projectId}/documents/${target.document_id}`, { method: "DELETE" });
    const remaining = (data?.documents ?? []).filter((item) => item.document_id !== target.document_id);
    setData((current) => (current ? { ...current, documents: remaining } : current));
    if (remaining[0]) navigate(`/projects/${projectId}/documents/${remaining[0].document_id}`, { replace: true });
  }

  async function commitTitle(nextTitleRaw: string) {
    if (!data || user?.role_name !== "Analyst") return;
    const nextTitle = nextTitleRaw.trim();
    if (!nextTitle || nextTitle === data.project.project_name) {
      setTitle(data.project.project_name);
      return;
    }
    try {
      const updated = await api<Project>(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ project_name: nextTitle }),
      });
      setData((current) => (current ? { ...current, project: { ...current.project, ...updated } } : current));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the project");
      setTitle(data.project.project_name);
    }
  }

  const visibleMissing = (templateId: string) =>
    (doc?.content_json.sections[templateId]?.missing ?? []).filter((item) => !HIDDEN_ALERTS.has(item.message));
  const missingMessages = templates.flatMap((template) => visibleMissing(template.template_id));

  if (!data || !user) {
    return <p className="p-6 text-muted">{error || "Opening project…"}</p>;
  }
  if (!doc) {
    return <p className="p-6 text-muted">This project has no documents.</p>;
  }

  return (
    <div className="h-full min-h-full flex flex-col">
      <div className="px-4 py-3 border-b border-hairline bg-panel flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-end gap-4 min-w-0 flex-1">
          <div>
            <p className="font-label text-[10px] uppercase text-muted">Project</p>
            <input
              className="font-headline text-xl font-semibold bg-transparent border-b border-transparent focus:border-hairline outline-none min-w-[16rem]"
              aria-label="Project title"
              value={title}
              readOnly={user.role_name !== "Analyst"}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={(event) => void commitTitle(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </div>
          {data.project.description && (
            <p className="text-sm text-muted min-w-[16rem] flex-1 max-w-3xl" aria-label="Project description">
              {data.project.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canFill && !documentLocked && (
            <button type="button" className="btn" disabled={running} onClick={() => setFillDialog({ scope: "document" })}>
              <span className="material-symbols-outlined text-sm">auto_fix_high</span>
              Auto fill Document
            </button>
          )}
          <button type="button" className="btn" onClick={() => setReferencesOpen(true)}>
            <span className="material-symbols-outlined">menu_book</span>
            References ({data.references.length})
          </button>
          <button type="button" className="btn" onClick={() => setPreview("md")}>Markdown</button>
          <button type="button" className="btn" onClick={() => setPreview("html")}>HTML</button>
          <button type="button" className="btn" onClick={() => setPreview("pdf")}>PDF</button>
        </div>
      </div>
      <DocumentTabs
        documents={data.documents}
        activeId={doc.document_id}
        layouts={data.layouts}
        canManage={canEditStructure}
        onSelect={(id) => navigate(`/projects/${projectId}/documents/${id}`)}
        onAdd={addDocument}
        onRemove={removeDocument}
      />
      {saveState !== "idle" && (
        <p className="px-4 py-1 border-b border-hairline text-xs text-muted" role="status">
          {saveState === "saving" ? "Saving…" : "Saved"}
        </p>
      )}
      {error && <p className="px-4 py-2 text-alert border-b border-hairline">{error}</p>}
      {missingMessages.length > 0 && (
        <div className="px-4 py-2 border-b border-hairline flex items-center justify-between gap-3">
          <p className="text-sm">
            <span className="font-semibold text-alert">Missing Information Alert:</span> {missingMessages.map((item) => item.message).join("; ")}
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const target = templates.find((template) => visibleMissing(template.template_id).length > 0);
              if (target) setActiveId(target.template_id);
            }}
          >
            Review gap
          </button>
        </div>
      )}
      {running && (
        <div className="px-4 py-2 border-b border-hairline max-h-32 overflow-auto text-xs font-label">
          {templates.map((template) => (
            <div key={template.template_id}>{progress[template.template_id] || "waiting"} — {template.section_name}</div>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        <button type="button" className="btn m-2 xl:hidden" onClick={() => setOutlineOpen(true)}>Outline</button>
        <aside className={`${outlineOpen ? "fixed inset-y-14 left-0 z-30 w-[280px]" : "hidden"} xl:static xl:flex w-[280px] shrink-0 border-r border-hairline bg-panel`}>
          <Outline
            active={activeId}
            editor={outlineEditor}
            onSelect={(id) => {
              setActiveId(id);
              setOutlineOpen(false);
            }}
            items={outlineItems(templates, (id) => visibleMissing(id).length)}
          />
        </aside>
        <section className="flex-1 overflow-auto p-6">
          <div className="max-w-[920px] mx-auto space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-headline text-2xl font-semibold">{section?.title}</h2>
              {canFill && activeTemplate && (
                <button type="button" className="btn" disabled={fillingId === activeId} onClick={() => setFillDialog({ scope: "section", id: activeId })}>
                  <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                  {fillingId === activeId ? "Filling…" : "Auto fill"}
                </button>
              )}
            </div>
            {section?.blocks.map((block, index) => {
              const diagramCount = section.blocks.filter((item) => item.type === "diagram").length;
              const layoutDiagrams = (activeTemplate?.blocks ?? []).filter((item) => item.type === "diagram").length;
              return (
                <div key={`${docId}-${activeId}-${index}-${revision}`} className="space-y-2">
                  <BlockView
                    projectId={projectId}
                    block={block}
                    readOnly={documentLocked}
                    onError={setError}
                    onChange={(next) => {
                      if (!section) return;
                      const blocks = section.blocks.map((item, blockIndex) => (blockIndex === index ? next : item));
                      replaceSection(activeId, { ...section, blocks });
                    }}
                  />
                  {block.type === "diagram" && !documentLocked && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn" onClick={() => insertDiagram(index)}>
                        <span className="material-symbols-outlined text-sm" aria-hidden="true">add</span>
                        Add diagram
                      </button>
                      {diagramCount > layoutDiagrams && (
                        <button type="button" className="btn" onClick={() => removeBlock(index)}>
                          <span className="material-symbols-outlined text-sm" aria-hidden="true">close</span>
                          Remove diagram
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {section && !documentLocked && section.blocks.every((item) => item.type !== "diagram") && (
              <button type="button" className="btn" onClick={() => insertDiagram(section.blocks.length - 1)}>
                <span className="material-symbols-outlined text-sm" aria-hidden="true">add</span>
                Add diagram
              </button>
            )}
            {!documentLocked && (
              <button type="button" className="btn" onClick={() => void persist(doc.document_id, doc.content_json)}>
                Save document
              </button>
            )}
          </div>
        </section>
      </div>
      {sectionDialog && <SectionDialog mode={sectionDialog} onSubmit={saveSection} onClose={() => setSectionDialog(null)} />}
      {fillDialog && (
        <AutoFillDialog
          scope={fillDialog.scope}
          sectionName={fillDialog.scope === "section" ? templates.find((item) => item.template_id === fillDialog.id)?.section_name : undefined}
          hasContent={
            fillDialog.scope === "section"
              ? !sectionIsEmpty(doc.content_json.sections[fillDialog.id], templates.find((item) => item.template_id === fillDialog.id))
              : undefined
          }
          onClose={() => setFillDialog(null)}
          onConfirm={(request: AutoFillRequest) => {
            const target = fillDialog;
            setFillDialog(null);
            if (target.scope === "section") void fillSection(target.id, request.instruction);
            else void generateAll(request.onlyEmpty);
          }}
        />
      )}
      {deletingSection && (
        <ConfirmDialog
          title="Delete section"
          message={`Delete "${deletingSection.section_name}"${templates.some((item) => item.parent_id === deletingSection.template_id) ? ", its sub-sections" : ""} and the content written in ${templates.some((item) => item.parent_id === deletingSection.template_id) ? "them" : "it"}? This cannot be undone.`}
          onConfirm={removeSection}
          onClose={() => setDeletingSection(null)}
        />
      )}
      {referencesOpen && (
        <ReferencesPanel
          projectId={projectId}
          references={data.references}
          canEdit={user.role_name === "Analyst"}
          onChange={(references) => setData((current) => (current ? { ...current, references } : current))}
          onClose={() => setReferencesOpen(false)}
        />
      )}
      {preview && (
        <ExportPreview
          projectId={projectId}
          documentId={doc.document_id}
          projectName={`${data.project.project_name} - ${doc.name}`}
          format={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

const HEADER_STYLES: Record<number, string> = {
  1: "text-xl font-semibold",
  2: "text-lg font-semibold",
  3: "text-base font-semibold",
};

function BlockView({
  projectId,
  block,
  onChange,
  onError,
  readOnly,
}: {
  projectId: string;
  block: Block;
  onChange: (block: Block) => void;
  onError: (message: string) => void;
  readOnly: boolean;
}) {
  if (block.type === "header") {
    return (
      <div className="flex items-center gap-2">
        <input
          className={`field font-headline flex-1 ${HEADER_STYLES[block.level] ?? HEADER_STYLES[1]}`}
          aria-label="Header"
          value={block.text}
          readOnly={readOnly}
          placeholder="Header"
          onChange={(event) => onChange({ ...block, text: event.target.value })}
        />
        <select
          className="field w-28 shrink-0"
          aria-label="Header size"
          value={block.level}
          disabled={readOnly}
          onChange={(event) => onChange({ ...block, level: Number(event.target.value) })}
        >
          <option value={1}>Large</option>
          <option value={2}>Medium</option>
          <option value={3}>Small</option>
        </select>
      </div>
    );
  }
  if (block.type === "image") {
    return <ImageBlock projectId={projectId} block={block} readOnly={readOnly} onError={onError} onChange={(next) => onChange({ ...block, ...next })} />;
  }
  if (block.type === "prose") {
    return <ProseEditor value={block.markdown} readOnly={readOnly} onChange={(markdown) => onChange({ ...block, markdown })} />;
  }
  if (block.type === "table") {
    return <TableGrid columns={block.columns} rows={block.rows} readOnly={readOnly} onChange={(rows) => onChange({ ...block, rows })} />;
  }
  return <DiagramBlock block={block} readOnly={readOnly} onChange={onChange} />;
}
