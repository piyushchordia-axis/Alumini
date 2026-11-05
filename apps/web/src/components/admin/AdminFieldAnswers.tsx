import { fieldErrorsFrom, type AdminMemberDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CustomFieldInputs, answersToValues, type FieldAnswers } from "@/components/profile/CustomFieldInputs";
import { Badge, Button, Card } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

/** A member's answers to the institution's questions; admins can edit them (including admin-managed fields). */
export function AdminFieldAnswers({ member }: { member: AdminMemberDto }) {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: qk.admin.profileFields(slug), queryFn: () => api.admin.profileFields.list(slug) });
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FieldAnswers>(answersToValues(member.fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.admin.members.updateProfile(slug, member.id, { fields: values }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.member(slug, member.id) });
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
  if (fields.isLoading || defs.length === 0) return null;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Profile questions</h2>
        {!editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
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
            <CustomFieldInputs fields={defs} values={values} errors={errors} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
              Save answers
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
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
                  {f.visibility === "ADMINS" && <Badge tone="neutral">admins only</Badge>}
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
