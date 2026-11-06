import { MENTOR_REMOVE_CONFIRM, memberFacts, mentorListedText, mentorProfileRows, mentorshipKeys, roleChangeCopy, type AdminMemberDetailDto, type MembershipRole, type MentorProfileDto } from "@illuminize/shared";
import { errorMessage, isOutOfDate } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AuditTable } from "@/components/admin/AuditTable";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { IconChevronLeft } from "@/components/icons";
import { ProfileDetails, ProfileSummary } from "@/components/profile/ProfileDetails";
import { Badge, Button, Card, ErrorBox, Loading } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { AdminFieldAnswers } from "@/components/admin/AdminFieldAnswers";
import { MemberActionButtons, useMemberActions, type MemberActions } from "@/components/admin/MemberActions";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { toast } from "@/stores/uiStore";

export function AdminMemberDetailPage() {
  const { membershipId = "" } = useParams();
  // The router keeps this page open from one member to the next (a link in Recent activity, Back, Forward), so each
  // member's page starts afresh, as on the phone app: an open answers editor, what was typed in it, or a question asked
  // never carries over to the next member, where Save would write the last one's answers.
  return <AdminMemberDetail key={membershipId} membershipId={membershipId} />;
}

function AdminMemberDetail({ membershipId }: { membershipId: string }) {
  const { tenant, me } = useAdminTenant();
  const slug = tenant.slug;
  const q = useQuery({ queryKey: qk.admin.member(slug, membershipId), queryFn: () => api.admin.members.get(slug, membershipId) });
  const actions = useMemberActions(slug);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? "Not found"} />;
  const m = q.data;
  const isSelf = m.id === me?.id;
  return (
    <div className="space-y-4">
      <Link to={`/t/${slug}/admin/members`} className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <IconChevronLeft size={16} />
        Members
      </Link>
      <Card className="p-5">
        <ProfileSummary
          profile={{ ...m, isMentor: !!m.mentorProfile?.isActive }}
          nameExtras={
            <>
              <MemberStatusBadge status={m.status} />
              {m.role === "TENANT_ADMIN" && <Badge tone="primary">Admin</Badge>}
            </>
          }
        >
          {m.statusReason && <p className="mt-1 text-sm text-slate-500">Reason: {m.statusReason}</p>}
          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            {!isSelf && <MemberActionButtons member={m} actions={actions} />}
            {!isSelf && m.status === "APPROVED" && <RoleChange member={m} tenantName={tenant.name} actions={actions} />}
            {isSelf && <span className="text-sm text-slate-400">This is you.</span>}
          </div>
        </ProfileSummary>
        {/* The work, studies, links and bio are in ProfileDetails below; these are the facts it doesn't show. */}
        <dl className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {memberFacts(m, { formatDate, formatDateTime }).map((f) => (
            <div key={f.label}>
              <dt className="text-slate-500">{f.label}</dt>
              <dd className="text-slate-900">{f.value}</dd>
            </div>
          ))}
        </dl>
        <ProfileDetails profile={m} tenant={tenant} className="mt-5 border-t border-slate-100 pt-5" />
        {m.status === "APPROVED" && tenant.settings.features.directory && (
          <Link to={`/t/${slug}/app/directory/${m.id}`} className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary-ink underline-offset-2 hover:underline">
            View profile in the app
          </Link>
        )}
      </Card>
      <AdminFieldAnswers member={m} />
      {m.mentorProfile && <MentorProfileCard slug={slug} membershipId={m.id} profile={m.mentorProfile} />}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent activity</h2>
        <AuditTable rows={m.audit} memberHref={(id) => `/t/${slug}/admin/members/${id}`} selfId={m.id} />
      </section>
    </div>
  );
}

/**
 * Make admin, or Remove admin role, asked first. An answer that says the page was out of date (the member suspended or
 * gone, or this admin held back by a report) closes the question and says why; anything else stays in it to try again.
 */
function RoleChange({ member, tenantName, actions }: { member: AdminMemberDetailDto; tenantName: string; actions: MemberActions }) {
  // The role asked for, kept while the dialog is open so a refetch underneath can't turn the question round.
  const [asking, setAsking] = useState<MembershipRole | null>(null);
  const next: MembershipRole = member.role === "TENANT_ADMIN" ? "MEMBER" : "TENANT_ADMIN";
  const copy = roleChangeCopy(member.fullName, asking ?? next, tenantName);
  const close = () => {
    setAsking(null);
    actions.setRole.reset();
  };
  const confirm = () => {
    if (!asking) return;
    actions.setRole.mutate(
      { id: member.id, role: asking },
      {
        onSuccess: () => {
          close();
          toast.success(copy.done);
        },
        onError: (err) => {
          if (!isOutOfDate(err)) return;
          close();
          toast.error(errorMessage(err));
        },
      },
    );
  };
  return (
    <>
      <Button
        variant="ghost"
        className="min-h-11"
        onClick={() => {
          actions.setRole.reset();
          setAsking(next);
        }}
      >
        {copy.label}
      </Button>
      <ConfirmDialog
        open={asking !== null}
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.confirm}
        destructive={copy.destructive}
        busy={actions.setRole.isPending}
        error={actions.setRole.error}
        onConfirm={confirm}
        onCancel={close}
      />
    </>
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
      toast.success(MENTOR_REMOVE_CONFIRM.done);
    },
    onError: (err) => {
      if (!isOutOfDate(err)) return;
      setConfirming(false);
      toast.error(errorMessage(err));
    },
    // The list and the Mentors section show it too.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.member(slug, membershipId) });
      void qc.invalidateQueries({ queryKey: ["admin", slug, "members"] });
      void qc.invalidateQueries({ queryKey: qk.member(slug, membershipId) });
      void qc.invalidateQueries({ queryKey: mentorshipKeys.all(slug) });
    },
  });
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Mentor profile</h2>
        <Badge tone={profile.isActive ? "success" : "neutral"}>{mentorListedText(profile.isActive)}</Badge>
      </div>
      <dl className="mt-3 grid gap-3 text-sm">
        {mentorProfileRows(profile).map((r) => (
          <div key={r.label}>
            <dt className="text-slate-500">{r.label}</dt>
            <dd className="whitespace-pre-wrap break-words text-slate-900">{r.value}</dd>
          </div>
        ))}
      </dl>
      {profile.isActive && (
        <Button
          variant="outline"
          className="mt-4 min-h-11"
          onClick={() => {
            remove.reset();
            setConfirming(true);
          }}
        >
          {MENTOR_REMOVE_CONFIRM.confirm}
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        title={MENTOR_REMOVE_CONFIRM.title}
        body={MENTOR_REMOVE_CONFIRM.body}
        confirmLabel={MENTOR_REMOVE_CONFIRM.confirm}
        destructive
        busy={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
