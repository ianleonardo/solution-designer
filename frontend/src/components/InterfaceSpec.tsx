import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { InterfaceField, InterfaceRecord } from "../types";
import { ProcessingRulesEditor } from "./ProcessingRulesEditor";
import { SelectField } from "./SelectField";
import { DownloadButtons } from "./DownloadButtons";

export const FIELD_TYPES = ["string", "number", "integer", "boolean", "date", "datetime", "object", "array", "enum"] as const;

const REQUIRED_OPTIONS = [
  { value: "Y", label: "Required" },
  { value: "N", label: "Optional" },
  { value: "C", label: "Conditional" },
];

function requiredLabel(value: string) {
  return REQUIRED_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function pathDepth(path: string) {
  const dots = path.split(".").length - 1;
  return Math.max(0, dots);
}

function emptyField(direction: InterfaceField["direction"]): InterfaceField {
  return {
    direction,
    position: 0,
    field_path: "",
    field_type: "string",
    required: "Y",
    length: "",
    validation: "",
    description: "",
    example: "",
  };
}

function FieldDialog({
  field,
  existing,
  onSave,
  onClose,
}: {
  field: InterfaceField;
  existing: InterfaceField[];
  onSave: (field: InterfaceField) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(field);
  const [error, setError] = useState("");
  const editing = Boolean(field.field_path);

  function submit() {
    const path = draft.field_path.trim();
    if (!path) {
      setError("Field path is required.");
      return;
    }
    if (existing.some((item) => item.field_path === path && item.field_path !== field.field_path)) {
      setError(`Field '${path}' is listed more than once.`);
      return;
    }
    onSave({ ...draft, field_path: path, length: draft.length.trim(), validation: draft.validation.trim(), description: draft.description.trim(), example: draft.example.trim() });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={editing ? "Edit field" : "Add field"} className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-hairline bg-panel p-6 shadow-xl space-y-3">
        <h3 className="font-headline text-lg font-semibold m-0">{editing ? "Edit field" : "Add field"}</h3>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Field path</span>
          <input className="field mt-1" aria-label="Field path" value={draft.field_path} onChange={(event) => setDraft({ ...draft, field_path: event.target.value })} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Type</span>
          <div className="mt-1">
            <SelectField
              aria-label="Field type"
              value={draft.field_type}
              className="w-full [&_button]:w-full [&_button]:max-w-none"
              options={FIELD_TYPES.map((item) => ({ value: item, label: item }))}
              onChange={(field_type) => setDraft({ ...draft, field_type })}
            />
          </div>
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Required</span>
          <div className="mt-1">
            <SelectField
              aria-label="Required"
              value={draft.required}
              className="w-full [&_button]:w-full [&_button]:max-w-none"
              options={REQUIRED_OPTIONS}
              onChange={(required) => setDraft({ ...draft, required })}
            />
          </div>
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Length</span>
          <input className="field mt-1" aria-label="Length" value={draft.length} placeholder="20, 10,2, or enum: SG, MY" onChange={(event) => setDraft({ ...draft, length: event.target.value })} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Validation</span>
          <textarea className="field mt-1 min-h-[70px]" aria-label="Field validation" value={draft.validation} onChange={(event) => setDraft({ ...draft, validation: event.target.value })} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Description</span>
          <textarea className="field mt-1 min-h-[70px]" aria-label="Field description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <label className="block">
          <span className="font-label text-[10px] uppercase text-muted">Example</span>
          <input className="field mt-1" aria-label="Example" value={draft.example} onChange={(event) => setDraft({ ...draft, example: event.target.value })} />
        </label>
        {error && <p className="text-alert text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {editing ? "Save field" : "Add field"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InterfaceFieldTable({
  direction,
  fields,
  readOnly,
  onChange,
}: {
  direction: InterfaceField["direction"];
  fields: InterfaceField[];
  readOnly: boolean;
  onChange: (fields: InterfaceField[]) => void;
}) {
  const [editing, setEditing] = useState<InterfaceField | null>(null);
  const rows = fields.filter((field) => field.direction === direction);
  const noun = direction === "request" ? "request" : "response";

  function commit(next: InterfaceField[]) {
    const others = fields.filter((field) => field.direction !== direction);
    onChange([...others, ...next.map((field, position) => ({ ...field, direction, position }))]);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = rows.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    commit(next);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Use a dotted path for nested fields, such as account.currency or payments[].amount.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No {noun} fields.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                {["Path", "Type", "Required", "Length", "Validation", "Description", "Example"].map((header) => (
                  <th key={header} className="px-3 py-2 font-label text-[10px] uppercase text-muted">
                    {header}
                  </th>
                ))}
                {!readOnly && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((field, index) => (
                <tr key={`${field.field_path}-${index}`} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-2 font-medium" style={{ paddingLeft: 12 + pathDepth(field.field_path) * 16 }}>
                    {field.field_path}
                  </td>
                  <td className="px-3 py-2">{field.field_type}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{requiredLabel(field.required)}</td>
                  <td className="px-3 py-2">{field.length || "—"}</td>
                  <td className="px-3 py-2 max-w-[12rem]">{field.validation || "—"}</td>
                  <td className="px-3 py-2 max-w-[14rem]">{field.description || "—"}</td>
                  <td className="px-3 py-2">{field.example || "—"}</td>
                  {!readOnly && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <button type="button" className="icon-btn" aria-label={`Move ${field.field_path} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                          <span className="material-symbols-outlined text-base">arrow_upward</span>
                        </button>
                        <button type="button" className="icon-btn" aria-label={`Move ${field.field_path} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                          <span className="material-symbols-outlined text-base">arrow_downward</span>
                        </button>
                        <button type="button" className="icon-btn" aria-label={`Edit ${field.field_path}`} onClick={() => setEditing(field)}>
                          <span className="material-symbols-outlined text-base">edit</span>
                        </button>
                        <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${field.field_path}`} onClick={() => commit(rows.filter((_, itemIndex) => itemIndex !== index))}>
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && (
        <button type="button" className="btn" onClick={() => setEditing(emptyField(direction))}>
          <span className="material-symbols-outlined text-base" aria-hidden="true">add</span>
          Add field
        </button>
      )}
      {editing && (
        <FieldDialog
          field={editing}
          existing={rows}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            const index = rows.findIndex((item) => item.field_path === editing.field_path && editing.field_path);
            const next = index >= 0 ? rows.map((item, itemIndex) => (itemIndex === index ? saved : item)) : [...rows, saved];
            commit(next);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function RuleBlock({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return <p className="text-sm text-muted">No {label.toLowerCase()}.</p>;
  return <ProcessingRulesEditor value={value} readOnly label={label} toolbarLabel={`${label} formatting`} onChange={() => undefined} />;
}

/** Read-only specification used when a capability opens a linked interface. */
export function InterfaceDetailDialog({
  channel,
  interfaceId,
  fallbackName,
  layerClass = "z-[60]",
  onClose,
}: {
  channel: string;
  interfaceId: string;
  fallbackName: string;
  layerClass?: string;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<InterfaceRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    api<InterfaceRecord>(`/api/interfaces/${encodeURIComponent(channel)}/${encodeURIComponent(interfaceId)}`)
      .then((data) => {
        if (current) setRecord(data);
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof ApiError ? err.message : "Could not load interface");
      });
    return () => {
      current = false;
    };
  }, [channel, interfaceId]);

  const name = record?.interface_name || fallbackName;
  const fields = record?.fields ?? [];
  const facts: [string, string][] = record
    ? [
        ["Channel", record.channel],
        ["Applicable for", record.country || "All countries"],
        ["Endpoint", record.endpoint || "—"],
        ["Protocol", record.protocol],
        ["Source", record.source],
        ["Destination", record.destination],
        ["Description", record.description || "—"],
      ]
    : [];

  return (
    <div className={`fixed inset-0 ${layerClass} flex items-center justify-center bg-black/50 p-4`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Interface specification" className="flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-lg border border-hairline bg-panel shadow-xl">
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-hairline px-6 py-4">
          <h3 className="font-headline text-lg font-semibold m-0 mr-auto">{name}</h3>
          <DownloadButtons path={`/api/interfaces/${encodeURIComponent(channel)}/${encodeURIComponent(interfaceId)}/export`} filename={name} />
          <button type="button" className="icon-btn" aria-label="Close linked detail" onClick={onClose}>
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && <p className="text-alert text-sm">{error}</p>}
          {!record && !error && <p className="text-muted">Loading…</p>}
          {record && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {facts.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="font-label text-[10px] uppercase text-muted">{label}</dt>
                    <dd className="m-0">{value}</dd>
                  </div>
                ))}
              </dl>
              <section className="space-y-2">
                <h4 className="font-headline text-base font-semibold m-0">Request</h4>
                <InterfaceFieldTable direction="request" fields={fields} readOnly onChange={() => undefined} />
              </section>
              <section className="space-y-2">
                <h4 className="font-headline text-base font-semibold m-0">Response</h4>
                <InterfaceFieldTable direction="response" fields={fields} readOnly onChange={() => undefined} />
              </section>
              <section className="space-y-2">
                <h4 className="font-headline text-base font-semibold m-0">Processing rules</h4>
                <RuleBlock label="Processing rules" value={record.processing_rules ?? ""} />
              </section>
              <section className="space-y-2">
                <h4 className="font-headline text-base font-semibold m-0">Validation rules</h4>
                <RuleBlock label="Validation rules" value={record.validation_rules ?? ""} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
