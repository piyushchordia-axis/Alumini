import { approveAllDoneText, memberActionDoneText, memberActionErrorText, type MemberAdminAction, type MembershipStatus } from "@illuminize/shared";
import { isOutOfDate, unlessOutOfDate } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { invalidateTenant } from "@/lib/invalidate";

/** The member an action is for, as the admin's screen shows them: the status is the one they acted on. A notice's applicant may have no name left. */
export interface MemberRef {
  id: string;
  fullName: string | null;
  status: MembershipStatus;
}

/** What became of an action, for a StatusLine: `id` is the member's, or null for Approve all. */
export interface MemberActionOutcome {
  id: string | null;
  text: string;
  tone: "info" | "warning";
}

interface ActionInput {
  action: MemberAdminAction;
  member: MemberRef;
  reason?: string;
}

/**
 * Approve, reject, suspend and reinstate for the members list and the new-member notice, and Approve all, with what
 * became of each said through `say`. Approve and reject send the status the screen showed, so the API refuses (409) once
 * the member has moved on rather than overturn another admin's decision. Every answer refreshes the institution's
 * queries, the membership among them, so an admin refused because they no longer are one (403) leaves the console.
 * `say` should be a state setter (useStatus's), which keeps one identity, as the hook hands it on for effects.
 */
export function useMemberActions(slug: string, say: (outcome: MemberActionOutcome) => void) {
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
    onSuccess: (_row, { action, member }) => say({ id: member.id, text: memberActionDoneText(action, member.fullName), tone: "info" }),
    // Out of date: said here, wherever it was asked from. Anything else is for the caller, which a sheet shows inside it.
    onError: (err, { member }) => {
      if (isOutOfDate(err)) say({ id: member.id, text: memberActionErrorText(err, member.fullName), tone: "warning" });
    },
    // A refusal refreshes too: it usually means the screen was out of date.
    onSettled: (_row, _err, { member }) => {
      mark(member.id, null);
      void invalidateTenant(qc, slug);
    },
  });
  /** Resolves once done, or once refused as out of date (said already), so the sheet that asked can close; rejects otherwise. */
  const run = async (action: MemberAdminAction, member: MemberRef, reason?: string): Promise<void> => {
    await unlessOutOfDate(() => act.mutateAsync({ action, member, reason }));
  };
  const approveAll = useMutation({
    mutationFn: () => api.admin.members.approveAllPending(slug),
    onSuccess: (r) => say({ id: null, text: approveAllDoneText(r.approved), tone: "info" }),
    onSettled: () => void invalidateTenant(qc, slug),
  });
  return {
    run,
    /** One tap, with no sheet to show a failure in: every outcome is said. */
    tap: (action: MemberAdminAction, member: MemberRef) => {
      run(action, member).catch((err: unknown) => say({ id: member.id, text: memberActionErrorText(err, member.fullName), tone: "warning" }));
    },
    busyAction: (id: string): MemberAdminAction | undefined => busy.get(id),
    approveAll,
    /** Says something about a member the screen found out other than by acting, in the same line as the outcomes. */
    say,
  };
}

export type MemberActions = ReturnType<typeof useMemberActions>;
