import { answersToValues, fieldErrorsFrom, type AdminMemberDetailDto, type AdminMemberDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CustomFieldInputs, type FieldAnswers } from "@/components/profile/CustomFieldInputs";
import { Badge, Button, Card } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

/**
 * A member's answers to the institution's questions; admins can edit them (including admin-managed fields). Editing starts
 * from the answers saved when Edit is pressed, and Cancel puts them back, so nothing typed outlives the edit.
 */
export function AdminFieldAnswers({ member }: { member: AdminMemberDto }) {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: qk.admin.profileFields(slug), queryFn: () => api.admin.profileFields.list(slug) });
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FieldAnswers>(() => answersToValues(member.fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const startEditing = () => {
    setValues(answersToValues(member.fields));
    setErrors({});
    setEditing(true);
  };
  const cancel = () => {
    setValues(answersToValues(member.fields));
    setErrors({});
    setEditing(false);
  };
  const save = useMutation({
    mutationFn: () => api.admin.members.updateProfile(slug, member.id, { fields: values }),
    onSuccess: (saved) => {
      // The answers as saved at once, so the page doesn't show the old ones until the refetch. The list shows answers
      // too, and so does the member's profile in the app.
      qc.setQueryData<AdminMemberDetailDto>(qk.admin.member(slug, member.id), (old) => (old ? { ...old, ...saved } : old));
      void qc.invalidateQueries({ queryKey: qk.admin.member(slug, member.id) });
      void qc.invalidateQueries({ queryKey: ["admin", slug, "members"] });
      void qc.invalidateQueries({ queryKey: qk.member(slug, member.id) });
      setEditing(false);
      toast.success("Answers saved");
    },
    onError: (e) => {
      const mine = fieldErrorsFrom(e, "fields.");
      if (Object.keys(mine).length) setErrors(mine);
      else toast.error(errorMessage(e));
    },
  });
  const defs = fields.data ?? [];
  // Only the first answer is waited for, so a refetch never swaps an edit for nothing.
  if ((fields.isLoading && !fields.isFetched) || defs.length === 0) return null;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Profile questions</h2>
        {!editing && (
          <Button variant="outline" size="sm" className="min-h-11" onClick={startEditing}>
            Edit answers
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <CustomFieldInputs fields={defs} values={values} errors={errors} audience="admin" onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="min-h-11" loading={save.isPending}>
              Save answers
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={cancel} disabled={save.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {defs.map((f) => {
            const a = member.fields.find((x) => x.key === f.key);
            return (
              <div key={f.key}>
                <dt className="flex items-center gap-1 text-slate-500">
                  {f.label}
                  {f.visibility === "ADMINS" && <Badge tone="neutral">Admins only</Badge>}
                </dt>
                <dd className="whitespace-pre-line text-slate-900">{a?.display || "—"}</dd>
              </div>
            );
          })}
        </dl>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Manage the questions under <Link to={`/t/${slug}/admin/profile-fields`} className="underline">Profile fields</Link>.
      </p>
    </Card>
  );
}
