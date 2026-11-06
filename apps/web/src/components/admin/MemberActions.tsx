import { MEMBER_ACTION_COPY, approveAllDoneText, memberActionDoneText, memberActionErrorText, memberActionLabel, memberActionsFor, memberStatusNowText, type MemberAdminAction, type MembershipRole, type MembershipStatus, type NotificationSubjectDto } from "@illuminize/shared";
import { unlessOutOfDate } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { ReasonModal } from "@/components/admin/ReasonModal";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { invalidateTenant } from "@/lib/invalidate";
import { toast } from "@/stores/uiStore";

/** The member an action is for, as the admin's screen shows them: the status is the one they acted on. */
export interface MemberRef {
  id: string;
  fullName: string | null;
  status: MembershipStatus;
}

interface ActionInput {
  action: MemberAdminAction;
  member: MemberRef;
  reason?: string;
}

/**
 * Approve, reject, suspend and reinstate for the members list, a member's page and the new-member notice. Approve and
 * reject send the status the screen showed, so the API refuses (409) once the member has moved on rather than overturn
 * another admin's decision.
 */
export function useMemberActions(slug: string) {
  const qc = useQueryClient();
  // By member, not the mutation's latest variables, which only know the last of two quick taps on different rows.
  const [busy, setBusy] = useState<ReadonlyMap<string, MemberAdminAction>>(() => new Map());
  const mark = (id: string, action: MemberAdminAction | null) =>
    setBusy((prev) => {
      const next = new Map(prev);
      if (action) next.set(id, action);
      else next.delete(id);
      return next;
    });
  const act = useMutation({
    mutationFn: ({ action, member, reason = "" }: ActionInput) => {
      switch (action) {
        case "approve":
          return api.admin.members.approve(slug, member.id, member.status);
        case "reject":
          return api.admin.members.reject(slug, member.id, reason, member.status);
        case "suspend":
          return api.admin.members.suspend(slug, member.id, reason);
        case "reinstate":
          return api.admin.members.reinstate(slug, member.id);
      }
    },
    onMutate: ({ action, member }) => mark(member.id, action),
    onSuccess: (_row, { action, member }) => toast.success(memberActionDoneText(action, member.fullName)),
    onError: (err, { member }) => toast.error(memberActionErrorText(err, member.fullName)),
    // A refusal refreshes too: it usually means the screen was out of date.
    onSettled: (_row, _err, { member }) => {
      mark(member.id, null);
      void invalidateTenant(qc, slug);
    },
  });
  const approveAll = useMutation({
    mutationFn: () => api.admin.members.approveAllPending(slug),
    onSuccess: (r) => toast.success(approveAllDoneText(r.approved)),
    onSettled: () => void invalidateTenant(qc, slug),
  });
  // The page that asks first says how it went. A refusal refreshes too: the member may have been suspended meanwhile.
  const setRole = useMutation({
    mutationFn: (v: { id: string; role: MembershipRole }) => api.admin.members.setRole(slug, v.id, v.role),
    onSettled: () => void invalidateTenant(qc, slug),
  });
  return {
    run: (action: MemberAdminAction, member: MemberRef, reason?: string) => act.mutateAsync({ action, member, reason }),
    busyAction: (id: string): MemberAdminAction | undefined => busy.get(id),
    approveAll,
    setRole,
  };
}

export type MemberActions = ReturnType<typeof useMemberActions>;

/** Asks for the reason the member is told, then acts. An out-of-date answer closes it, as trying again can't help. */
function ReasonFor({ action, member, actions, open, onClose }: { action: "reject" | "suspend"; member: MemberRef; actions: MemberActions; open: boolean; onClose: () => void }) {
  const reason = MEMBER_ACTION_COPY[action].reason;
  if (!reason) return null;
  return (
    <ReasonModal
      open={open}
      title={reason.title(member.fullName)}
      label={reason.body}
      required
      tone="danger"
      confirmLabel={reason.confirm}
      onClose={onClose}
      onConfirm={(text) => unlessOutOfDate(() => actions.run(action, member, text))}
    />
  );
}

export function MemberActionButtons({ member, actions, compact }: { member: MemberRef; actions: MemberActions; compact?: boolean }) {
  const [asking, setAsking] = useState<"reject" | "suspend" | null>(null);
  const busy = actions.busyAction(member.id);
  const press = (action: MemberAdminAction) => {
    if (action === "reject" || action === "suspend") setAsking(action);
    // The hook's toast reports a failure.
    else void actions.run(action, member).catch(() => {});
  };
  return (
    <div className="flex flex-wrap gap-2">
      {memberActionsFor(member.status).map((action) => {
        const copy = MEMBER_ACTION_COPY[action];
        return (
          <Button
            key={action}
            size={compact ? "sm" : "md"}
            variant={copy.variant}
            aria-label={memberActionLabel(action, member.fullName)}
            onClick={() => press(action)}
            loading={busy === action}
            disabled={!!busy && busy !== action}
          >
            {copy.label}
          </Button>
        );
      })}
      <ReasonFor action="reject" member={member} actions={actions} open={asking === "reject"} onClose={() => setAsking(null)} />
      <ReasonFor action="suspend" member={member} actions={actions} open={asking === "suspend"} onClose={() => setAsking(null)} />
    </div>
  );
}

/**
 * Approve and Reject on a new-member notice while the request still waits, and otherwise where it stands now. Both send
 * PENDING, so a notice left open can't overturn what another admin decided.
 */
export function MemberRequestActions({ slug, subject }: { slug: string; subject: NotificationSubjectDto }) {
  const actions = useMemberActions(slug);
  const [rejecting, setRejecting] = useState(false);
  // Where the request stood when last drawn. Once a refetch shows it has moved on (another admin decided, or the applicant
  // left), an open Reject closes, said as the API's refusal would be, and doesn't open again by itself should the
  // applicant apply again. Not while this admin's own answer is on its way: its toast says how that went.
  const [shown, setShown] = useState(subject.status);
  const [overtaken, setOvertaken] = useState<{ text: string } | null>(null);
  if (shown !== subject.status) {
    setShown(subject.status);
    if (rejecting && subject.status !== "PENDING" && !actions.busyAction(subject.membershipId)) setOvertaken({ text: memberStatusNowText(subject.status, subject.fullName) });
    setRejecting(false);
  }
  useEffect(() => {
    if (overtaken) toast.error(overtaken.text);
  }, [overtaken]);
  if (subject.status === null) return <span className="text-sm text-slate-500">No longer waiting</span>;
  if (subject.status !== "PENDING") return <MemberStatusBadge status={subject.status} />;
  const member: MemberRef = { id: subject.membershipId, fullName: subject.fullName, status: "PENDING" };
  const busy = actions.busyAction(member.id);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        className="min-h-11"
        aria-label={memberActionLabel("approve", member.fullName)}
        onClick={() => void actions.run("approve", member).catch(() => {})}
        loading={busy === "approve"}
        disabled={!!busy && busy !== "approve"}
      >
        {MEMBER_ACTION_COPY.approve.label}
      </Button>
      <Button size="sm" variant="outline" className="min-h-11" aria-label={memberActionLabel("reject", member.fullName)} onClick={() => setRejecting(true)} disabled={!!busy}>
        {MEMBER_ACTION_COPY.reject.label}
      </Button>
      <ReasonFor action="reject" member={member} actions={actions} open={rejecting} onClose={() => setRejecting(false)} />
    </div>
  );
}
