import { MARITAL_STATUS_LABELS, MENTOR_AREA_LABELS, PROFESSION_TYPE_LABELS, countryName, formatPhone, mentorAvailabilityText, type MentorProfileDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AuditTable } from "@/components/admin/AuditTable";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { ProfileDetails, ProfileSummary } from "@/components/profile/ProfileDetails";
import { Button, Card, ErrorBox, Loading } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { AdminFieldAnswers } from "@/components/admin/AdminFieldAnswers";
import { MemberActionButtons, useMemberActions } from "@/components/admin/MemberActions";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { toast } from "@/stores/uiStore";

export function AdminMemberDetailPage() {
  const { tenant, me } = useAdminTenant();
  const slug = tenant.slug;
  const { membershipId = "" } = useParams();
  const q = useQuery({ queryKey: qk.admin.member(slug, membershipId), queryFn: () => api.admin.members.get(slug, membershipId) });
  const actions = useMemberActions(slug);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? "Not found"} />;
  const m = q.data;
  const isSelf = m.id === me?.id;
  // The work, studies, links and bio are in ProfileDetails below; these are the facts it doesn't show.
  const fields: Array<[string, string | number | null | undefined]> = [
    ["Phone", formatPhone(m.phone)],
    ["Batch", m.batchYear],
    ["Profession", PROFESSION_TYPE_LABELS[m.professionType]],
    ["City", [m.city, countryName(m.country)].filter(Boolean).join(", ")],
    ["Date of birth", m.dateOfBirth ? formatDate(m.dateOfBirth) : null],
    ["Marital status", m.maritalStatus ? MARITAL_STATUS_LABELS[m.maritalStatus] : null],
    ["Kids", m.kidsCount],
    ["Member since", formatDate(m.createdAt)],
    ["Last active", m.lastActiveAt ? formatDateTime(m.lastActiveAt) : "never"],
    ["Last login", m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "never"],
  ];
  return (
    <div className="space-y-4">
      <Link to={`/t/${slug}/admin/members`} className="text-sm text-slate-500 hover:text-slate-800">
        ← Members
      </Link>
      <Card className="p-5">
        <ProfileSummary
          profile={{ ...m, isMentor: !!m.mentorProfile?.isActive }}
          nameExtras={
            <>
              <MemberStatusBadge status={m.status} />
              {m.role === "TENANT_ADMIN" && <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">Admin</span>}
            </>
          }
        >
          {m.statusReason && <p className="mt-1 text-sm text-slate-500">Reason: {m.statusReason}</p>}
          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            {!isSelf && <MemberActionButtons member={m} actions={actions} />}
            {!isSelf && m.status === "APPROVED" && (
              <Button variant="ghost" onClick={() => actions.setRole.mutate({ id: m.id, role: m.role === "TENANT_ADMIN" ? "MEMBER" : "TENANT_ADMIN" })} loading={actions.setRole.isPending}>
                {m.role === "TENANT_ADMIN" ? "Remove admin role" : "Make admin"}
              </Button>
            )}
            {isSelf && <span className="text-sm text-slate-400">This is you.</span>}
          </div>
        </ProfileSummary>
        <dl className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-900">{v === null || v === undefined || v === "" ? "—" : String(v)}</dd>
            </div>
          ))}
        </dl>
        <ProfileDetails profile={m} tenant={tenant} className="mt-5 border-t border-slate-100 pt-5" />
      </Card>
      <AdminFieldAnswers member={m} />
      {m.mentorProfile && <MentorProfileCard slug={slug} membershipId={m.id} profile={m.mentorProfile} />}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent activity</h2>
        <AuditTable rows={m.audit} />
      </section>
    </div>
  );
}

/**
 * What the member wrote to offer mentoring. Its note can't be reported like a chat message, so it's shown here, where an
 * admin can take them out of the Mentors list.
 */
function MentorProfileCard({ slug, membershipId, profile }: { slug: string; membershipId: string; profile: MentorProfileDto }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.admin.mentors.remove(slug, membershipId),
    onSuccess: () => {
      setConfirming(false);
      toast.success("Removed as a mentor");
      void qc.invalidateQueries({ queryKey: qk.admin.member(slug, membershipId) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rows: Array<[string, string]> = [
    ["Areas", profile.areas.map((a) => MENTOR_AREA_LABELS[a]).join(", ")],
    ["Availability", mentorAvailabilityText(profile)],
    ["Note", profile.note ?? "—"],
  ];
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Mentor profile</h2>
        <span className="text-xs text-slate-500">{profile.isActive ? "Listed in Mentors" : "Not listed in Mentors"}</span>
      </div>
      <dl className="mt-3 grid gap-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-slate-500">{k}</dt>
            <dd className="whitespace-pre-wrap break-words text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
      {profile.isActive && (
        <Button variant="outline" className="mt-4 min-h-11" onClick={() => setConfirming(true)}>
          Remove as mentor
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        title="Remove as mentor?"
        body="They'll no longer appear in Mentors, and requests waiting for them will be declined. Mentorships already under way carry on. They can offer to mentor again, so suspend them if it happens again."
        confirmLabel="Remove as mentor"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
