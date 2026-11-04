import {
  MAX_PROFILE_FIELDS,
  PROFILE_FIELD_TYPES,
  PROFILE_FIELD_TYPE_LABELS,
  type ProfileFieldCreateInput,
  type ProfileFieldDto,
  type ProfileFieldOption,
  type ProfileFieldType,
} from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, FormField, Input, Loading, Modal, PageHeader, Select } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

const CHOICE: ProfileFieldType[] = ["SELECT", "MULTI_SELECT"];
const FILTERABLE: ProfileFieldType[] = ["SELECT", "MULTI_SELECT", "BOOLEAN"];

/** "Blood group" → "blood_group" (a valid field key / option value). */
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(?=[^a-z])/, "f_")
    .slice(0, 40);

function OptionsEditor({ options, onChange }: { options: ProfileFieldOption[]; onChange: (o: ProfileFieldOption[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const label = draft.trim();
    if (!label) return;
    let value = slugify(label) || "option";
    while (options.some((o) => o.value === value)) value = `${value}_`;
    onChange([...options, { value, label }]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      {options.map((o, i) => (
        <div key={o.value} className="flex gap-2">
          <Input aria-label={`Option ${i + 1}`} value={o.label} onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Button type="button" variant="ghost" aria-label={`Remove option ${o.label}`} onClick={() => onChange(options.filter((_, j) => j !== i))}>
            ✕
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          aria-label="New option"
          placeholder="Add an option…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          Add
        </Button>
      </div>
      <p className="text-xs text-slate-500">Removing an option keeps it on profiles that already chose it.</p>
    </div>
  );
}

function FieldModal({ field, onClose }: { field: ProfileFieldDto | null; onClose: () => void }) {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const isNew = !field;
  const [v, setV] = useState<ProfileFieldCreateInput>({
    key: field?.key ?? "",
    label: field?.label ?? "",
    helpText: field?.helpText ?? null,
    type: field?.type ?? "TEXT",
    options: field?.options ?? [],
    required: field?.required ?? false,
    visibility: field?.visibility ?? "MEMBERS",
    memberEditable: field?.memberEditable ?? true,
    filterable: field?.filterable ?? false,
  });
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof ProfileFieldCreateInput>(k: K, value: ProfileFieldCreateInput[K]) => setV((s) => ({ ...s, [k]: value }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, options: CHOICE.includes(v.type) ? v.options : [], filterable: FILTERABLE.includes(v.type) && v.filterable };
      if (isNew) return api.admin.profileFields.create(slug, body);
      const { key: _key, ...rest } = body;
      return api.admin.profileFields.update(slug, field.id, rest);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.profileFields(slug) });
      void qc.invalidateQueries({ queryKey: qk.profileFields(slug) });
      toast.success(isNew ? "Field added" : "Field saved");
      onClose();
    },
    onError: (e) => {
      if (isApiClientError(e) && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else toast.error(errorMessage(e));
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add a profile field" : `Edit “${field.label}”`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!v.label.trim() || !v.key}>
            {isNew ? "Add field" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Question" required error={errors.label}>
          <Input
            value={v.label}
            maxLength={80}
            placeholder="e.g. House, Roll number, Hostel"
            onChange={(e) => {
              set("label", e.target.value);
              if (!keyTouched) set("key", slugify(e.target.value));
            }}
          />
        </FormField>
        <FormField label="Key" required error={errors.key} hint={isNew ? "Used in CSV imports and exports. Can't be changed later." : "Can't be changed."}>
          <Input
            value={v.key}
            disabled={!isNew}
            className="font-mono"
            onChange={(e) => {
              setKeyTouched(true);
              set("key", e.target.value);
            }}
          />
        </FormField>
        <FormField label="Answer type" error={errors.type} hint={isNew ? undefined : "Can't change once members have answered."}>
          <Select value={v.type} onChange={(e) => set("type", e.target.value as ProfileFieldType)}>
            {PROFILE_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROFILE_FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Who can see answers">
          <Select value={v.visibility} onChange={(e) => set("visibility", e.target.value as ProfileFieldCreateInput["visibility"])}>
            <option value="MEMBERS">Members, on profiles</option>
            <option value="ADMINS">Only admins (and the member)</option>
          </Select>
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Help text" error={errors.helpText}>
            <Input value={v.helpText ?? ""} maxLength={200} onChange={(e) => set("helpText", e.target.value || null)} placeholder="Shown under the question" />
          </FormField>
        </div>
        {CHOICE.includes(v.type) && (
          <div className="sm:col-span-2">
            <FormField label="Options" required error={errors.options} group>
              <OptionsEditor options={v.options} onChange={(o) => set("options", o)} />
            </FormField>
          </div>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="Required when joining" checked={v.required} onChange={(e) => set("required", e.target.checked)} />
          <Checkbox label="Only admins fill this in (members can't change it)" checked={!v.memberEditable} onChange={(e) => set("memberEditable", !e.target.checked)} />
          {FILTERABLE.includes(v.type) && v.visibility === "MEMBERS" && (
            <Checkbox label="Members can filter the directory by it" checked={v.filterable} onChange={(e) => set("filterable", e.target.checked)} />
          )}
          {errors.filterable && <p className="text-xs text-red-600">{errors.filterable}</p>}
        </div>
      </div>
    </Modal>
  );
}

export function AdminProfileFieldsPage() {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProfileFieldDto | "new" | null>(null);
  const list = useQuery({ queryKey: [...qk.admin.profileFields(slug), { showArchived }], queryFn: () => api.admin.profileFields.list(slug, showArchived) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.admin.profileFields(slug) });
    void qc.invalidateQueries({ queryKey: qk.profileFields(slug) });
  };
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.admin.profileFields.reorder(slug, ids), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const archive = useMutation({
    mutationFn: (f: ProfileFieldDto) => (f.archivedAt ? api.admin.profileFields.restore(slug, f.id) : api.admin.profileFields.archive(slug, f.id)),
    onSuccess: (f) => {
      refresh();
      toast.success(f.archivedAt ? "Field archived; answers are kept" : "Field restored");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (list.isLoading) return <Loading />;
  if (list.error || !list.data) return <ErrorBox error={list.error ?? "Failed"} />;
  const fields = list.data;
  const active = fields.filter((f) => !f.archivedAt);
  const move = (index: number, delta: number) => {
    const ids = active.map((f) => f.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id!);
    reorder.mutate(ids);
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Profile fields"
        subtitle={`Your own questions on member profiles, such as house, roll number or hostel (${active.length} of ${MAX_PROFILE_FIELDS}).`}
        actions={
          <Button onClick={() => setEditing("new")} disabled={active.length >= MAX_PROFILE_FIELDS}>
            + Add field
          </Button>
        }
      />
      {/* Schools don't ask for either. */}
      {tenant.type !== "SCHOOL" && <p className="text-sm text-slate-600">Degree and field of study are now built into every profile, so they don't need a question here.</p>}
      <Checkbox label="Show archived fields" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
      {fields.length === 0 ? (
        <EmptyState icon="🧩" title="No profile fields yet" description="Add questions members answer when they join and on their profile." />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {fields.map((f) => {
              const i = active.findIndex((a) => a.id === f.id);
              return (
                <li key={f.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{f.label}</span>
                      <code className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{f.key}</code>
                      <Badge>{PROFILE_FIELD_TYPE_LABELS[f.type]}</Badge>
                      {f.required && <Badge tone="warning">Required</Badge>}
                      {f.visibility === "ADMINS" && <Badge tone="info">Admins only</Badge>}
                      {!f.memberEditable && <Badge tone="info">Set by admins</Badge>}
                      {f.filterable && <Badge tone="success">Directory filter</Badge>}
                      {f.archivedAt && <Badge tone="danger">Archived</Badge>}
                    </div>
                    {f.options.length > 0 && <p className="mt-1 truncate text-xs text-slate-500">{f.options.map((o) => o.label).join(" · ")}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!f.archivedAt && (
                      <>
                        <Button size="sm" variant="ghost" aria-label={`Move ${f.label} up`} disabled={i <= 0 || reorder.isPending} onClick={() => move(i, -1)}>
                          ↑
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Move ${f.label} down`} disabled={i === active.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>
                          ↓
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(f)}>
                          Edit
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" loading={archive.isPending && archive.variables?.id === f.id} onClick={() => archive.mutate(f)}>
                      {f.archivedAt ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {editing && <FieldModal field={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
