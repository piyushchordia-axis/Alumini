import {
  archiveFieldConfirm,
  CHOICE_TYPES,
  emptyFieldDraft,
  FIELD_FILTER_HINT,
  FIELD_VISIBILITY_OPTIONS,
  fieldBadges,
  fieldCanFilter,
  inFieldOrder,
  MAX_PROFILE_FIELDS,
  moveId,
  normalizeFieldBody,
  PROFILE_FIELD_TYPES,
  PROFILE_FIELD_TYPE_LABELS,
  profileFieldFormErrors,
  profileFieldsSubtitle,
  slugifyKey,
  uniqueOptionValue,
  type ProfileFieldDraft,
  type ProfileFieldDto,
  type ProfileFieldOption,
  type ProfileFieldType,
  type ProfileFieldVisibility,
} from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { IconChevronDown, IconChevronUp, IconClose, IconFields, IconPlus } from "@/components/icons";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, FormField, Input, Loading, Modal, PageHeader, Select } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

function OptionsEditor({ options, onChange }: { options: ProfileFieldOption[]; onChange: (o: ProfileFieldOption[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const label = draft.trim();
    if (!label) return;
    onChange([...options, { value: uniqueOptionValue(options, label), label }]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      {options.map((o, i) => (
        <div key={o.value} className="flex gap-2">
          <Input aria-label={`Option ${i + 1}`} value={o.label} onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Button type="button" variant="ghost" className="min-h-10 min-w-10 px-2" aria-label={`Remove option ${o.label}`} onClick={() => onChange(options.filter((_, j) => j !== i))}>
            <IconClose size={16} />
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

/**
 * After a question is added, changed, moved, archived or restored: the console's lists, the member forms' questions, and
 * the directory's filters. Settles once they're refetched.
 */
function useRefreshFields(slug: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.admin.profileFields(slug) }),
      qc.invalidateQueries({ queryKey: qk.profileFields(slug) }),
      qc.invalidateQueries({ queryKey: qk.directoryFilters(slug) }),
    ]);
}

function FieldModal({ field, onClose }: { field: ProfileFieldDto | null; onClose: () => void }) {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const refresh = useRefreshFields(slug);
  const filterHintId = useId();
  const isNew = !field;
  const [v, setV] = useState<ProfileFieldDraft>(() => emptyFieldDraft(field));
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof ProfileFieldDraft>(k: K, value: ProfileFieldDraft[K]) => setV((s) => ({ ...s, [k]: value }));
  const canFilter = fieldCanFilter(v.type, v.visibility);
  const save = useMutation({
    mutationFn: (body: ProfileFieldDraft) => {
      if (isNew) return api.admin.profileFields.create(slug, body);
      const { key: _key, ...rest } = body;
      return api.admin.profileFields.update(slug, field.id, rest);
    },
    onSuccess: () => {
      void refresh();
      toast.success(isNew ? "Field added" : "Field saved");
      onClose();
    },
    onError: (e) => {
      if (isApiClientError(e) && Object.keys(e.fieldErrors).length) {
        // By the input each is about: "options.2.label" is the options' error.
        const next: Record<string, string> = {};
        for (const [path, message] of Object.entries(e.fieldErrors)) next[path.split(".")[0]!] ??= message;
        setErrors(next);
      } else toast.error(errorMessage(e));
    },
  });
  const submit = () => {
    const body = normalizeFieldBody(v);
    const problems = profileFieldFormErrors(body, isNew);
    setErrors(problems);
    if (Object.keys(problems).length === 0) save.mutate(body);
  };
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
          <Button onClick={submit} loading={save.isPending} disabled={!v.label.trim() || !v.key}>
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
              const label = e.target.value;
              setV((s) => ({ ...s, label, ...(keyTouched ? {} : { key: slugifyKey(label) }) }));
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
        <FormField label="Who can see answers" error={errors.visibility}>
          <Select value={v.visibility} onChange={(e) => set("visibility", e.target.value as ProfileFieldVisibility)}>
            {FIELD_VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Help text" error={errors.helpText}>
            <Input value={v.helpText ?? ""} maxLength={200} onChange={(e) => set("helpText", e.target.value || null)} placeholder="Shown under the question" />
          </FormField>
        </div>
        {CHOICE_TYPES.includes(v.type) && (
          <div className="sm:col-span-2">
            <FormField label="Options" required error={errors.options} group>
              <OptionsEditor options={v.options} onChange={(o) => set("options", o)} />
            </FormField>
          </div>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="Required when joining" checked={v.required} onChange={(e) => set("required", e.target.checked)} />
          <Checkbox label="Only admins fill this in (members can't change it)" checked={!v.memberEditable} onChange={(e) => set("memberEditable", !e.target.checked)} />
          <div>
            <Checkbox
              label="Members can filter the directory by it"
              checked={canFilter && v.filterable}
              disabled={!canFilter}
              aria-describedby={canFilter ? undefined : filterHintId}
              className={canFilter ? undefined : "opacity-60"}
              onChange={(e) => set("filterable", e.target.checked)}
            />
            {!canFilter && (
              <p id={filterHintId} className="ml-6 text-xs text-slate-500">
                {FIELD_FILTER_HINT}
              </p>
            )}
          </div>
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
  const refresh = useRefreshFields(slug);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProfileFieldDto | "new" | null>(null);
  const [archiving, setArchiving] = useState<ProfileFieldDto | null>(null);
  const listKey = [...qk.admin.profileFields(slug), { showArchived }];
  // The other toggle's list stays on the page while this one loads, rather than a spinner in its place.
  const list = useQuery({ queryKey: listKey, queryFn: () => api.admin.profileFields.list(slug, showArchived), placeholderData: keepPreviousData });
  // Shown at once and put back if refused, as on the phone. The arrows wait until the stored order is back, so the next
  // move starts from it.
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.admin.profileFields.reorder(slug, ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: listKey });
      const before = qc.getQueryData<ProfileFieldDto[]>(listKey);
      if (before) qc.setQueryData(listKey, inFieldOrder(before, ids));
      return { before, key: listKey };
    },
    onError: (e, _ids, context) => {
      if (context?.before) qc.setQueryData(context.key, context.before);
      toast.error(`Couldn't move it: ${errorMessage(e)}`);
    },
    onSettled: () => refresh(),
  });
  const archive = useMutation({
    mutationFn: (f: ProfileFieldDto) => (f.archivedAt ? api.admin.profileFields.restore(slug, f.id) : api.admin.profileFields.archive(slug, f.id)),
    onSuccess: (f) => {
      void refresh();
      setArchiving(null);
      toast.success(f.archivedAt ? "Field archived; answers are kept" : "Field restored");
    },
    onError: (e) => {
      setArchiving(null);
      toast.error(errorMessage(e));
    },
  });
  if (list.isLoading) return <Loading />;
  if (list.error || !list.data) return <ErrorBox error={list.error ?? "Failed"} />;
  const fields = list.data;
  const active = fields.filter((f) => !f.archivedAt);
  const move = (index: number, delta: number) => reorder.mutate(moveId(active.map((f) => f.id), index, delta));
  const confirm = archiving ? archiveFieldConfirm(archiving.label) : null;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Profile fields"
        subtitle={profileFieldsSubtitle(active.length)}
        actions={
          <Button onClick={() => setEditing("new")} disabled={active.length >= MAX_PROFILE_FIELDS}>
            <IconPlus size={16} />
            Add field
          </Button>
        }
      />
      {/* Schools don't ask for either. */}
      {tenant.type !== "SCHOOL" && <p className="text-sm text-slate-600">Degree and field of study are now built into every profile, so they don't need a question here.</p>}
      <Checkbox label="Show archived fields" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
      {fields.length === 0 ? (
        <EmptyState icon={<IconFields size={32} className="text-slate-400" />} title="No profile fields yet" description="Add questions members answer when they join and on their profile." />
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
                      {fieldBadges(f).map((b) => (
                        <Badge key={b.label} tone={b.tone}>
                          {b.label}
                        </Badge>
                      ))}
                    </div>
                    {f.options.length > 0 && <p className="mt-1 truncate text-xs text-slate-500">{f.options.map((o) => o.label).join(" · ")}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!f.archivedAt && (
                      <>
                        <Button size="sm" variant="ghost" className="min-h-10 min-w-10 px-2" aria-label={`Move ${f.label} up`} disabled={i <= 0 || reorder.isPending} onClick={() => move(i, -1)}>
                          <IconChevronUp size={18} />
                        </Button>
                        <Button size="sm" variant="ghost" className="min-h-10 min-w-10 px-2" aria-label={`Move ${f.label} down`} disabled={i === active.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>
                          <IconChevronDown size={18} />
                        </Button>
                        <Button size="sm" variant="outline" aria-label={`Edit ${f.label}`} onClick={() => setEditing(f)}>
                          Edit
                        </Button>
                      </>
                    )}
                    {f.archivedAt ? (
                      <Button size="sm" variant="ghost" aria-label={`Restore ${f.label}`} loading={archive.isPending && archive.variables?.id === f.id} onClick={() => archive.mutate(f)}>
                        Restore
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" aria-label={`Archive ${f.label}`} onClick={() => setArchiving(f)}>
                        Archive
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {editing && <FieldModal field={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!archiving}
        title={confirm?.title ?? ""}
        body={confirm?.body}
        confirmLabel={confirm?.confirmLabel ?? "Archive"}
        destructive
        busy={archive.isPending}
        onConfirm={() => archiving && archive.mutate(archiving)}
        onCancel={() => setArchiving(null)}
      />
    </div>
  );
}
