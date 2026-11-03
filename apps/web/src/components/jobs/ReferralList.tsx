import {
  DELETED_MEMBER_NAME,
  REFERRAL_CONFIRM,
  referralKeys,
  referralReportHelp,
  referralStatusLabel,
  referralWhen,
  type ReferralBox,
  type ReferralDto,
  type ReferralPageDto,
} from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChatReportDialog } from "@/components/chat/ReportMessageDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ListBody } from "@/components/common/ListBody";
import { RequestRow } from "@/components/connections/RequestRow";
import { Button, LinkButton } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { useRowFocus } from "@/hooks/useRowFocus";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { jobPath, refreshReferrals, refreshReferralsAndChat } from "@/lib/referrals";
import { toast } from "@/stores/uiStore";

const PAGE = 20;

/** One of the member's own lists. Received and sent share this, so a count on a tab reads the list itself. */
export function useReferralList(slug: string, box: ReferralBox, enabled = true) {
  return useInfiniteList<ReferralPageDto>(referralKeys.requests(slug, box), (cursor) => api.jobs.referrals.mine(slug, { box, cursor, limit: PAGE }), enabled);
}

/** The requests about one of the member's own jobs. */
export function useJobReferralList(slug: string, jobId: string, enabled = true) {
  return useInfiniteList<ReferralPageDto>(referralKeys.job(slug, jobId), (cursor) => api.jobs.referrals.forJob(slug, jobId, { cursor, limit: PAGE }), enabled);
}

type ReferralListState = ReturnType<typeof useReferralList>;
type Confirm = { kind: "withdraw" | "decline"; r: ReferralDto };
const DONE: Record<Confirm["kind"], string> = { withdraw: "Request withdrawn", decline: "Request declined" };
const TONE = { REQUESTED: "warning", ACCEPTED: "success", DECLINED: "neutral", WITHDRAWN: "neutral", CLOSED: "neutral" } as const;
const nameOf = (r: ReferralDto) => r.member?.fullName ?? DELETED_MEMBER_NAME;
/** Each row's element, for focus to land on once an action has run. */
const rowId = (id: string) => `referral-${id}`;

/** Which job a request is about, linked while the viewer can still open it. */
function JobLine({ slug, r }: { slug: string; r: ReferralDto }) {
  const what = `${r.job.title} at ${r.job.companyName}`;
  return (
    <p className="text-sm text-slate-700 [overflow-wrap:anywhere]">
      For{" "}
      {r.job.available && r.job.id ? (
        <Link to={jobPath(slug, r.job.id)} className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary">
          {what}
        </Link>
      ) : (
        <>
          <span className="font-medium">{what}</span>
          <span className="text-slate-500"> · this job is no longer available</span>
        </>
      )}
    </p>
  );
}

/**
 * Referral requests, each with its note, where it stands, and what this member can do about it: accept, decline or report
 * one they received, withdraw one they sent, open the chat an acceptance opened. `limited` is for a member who can't use
 * referrals now (they're switched off, or the member is a current pupil): only the ways out are offered, which the API keeps
 * open to them. `showJob` names the job on each row, which a job's own page doesn't need.
 */
export function ReferralList({ slug, list, empty, limited, showJob }: { slug: string; list: ReferralListState; empty: ReactNode; limited: boolean; showJob: boolean }) {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reporting, setReporting] = useState<ReferralDto | null>(null);
  const focus = useRowFocus(!!confirm || !!reporting);
  // An accepted referral's chat is a direct one, which needs messaging; the thread itself says if it can't be opened now.
  const chatOn = tenant.settings.features.messaging && membership.chatEligible;
  const directoryOn = tenant.settings.features.directory;

  // Whatever went wrong, the list may be out of date: someone else may have acted first, or the job closed, so the question
  // asked no longer stands. The list refetches.
  const failed = (err: unknown) => {
    toast.error(errorMessage(err));
    void refreshReferrals(qc, slug);
  };
  const accept = useMutation({
    mutationFn: (r: ReferralDto) => api.jobs.referrals.accept(slug, r.id),
    onSuccess: (r) => {
      void refreshReferralsAndChat(qc, slug);
      toast.success("Referral request accepted");
      // Into the chat it opened, where their note is already the first message.
      if (r.conversationId) navigate(`/t/${slug}/app/messages/${r.conversationId}`);
    },
    onError: (err, r) => {
      failed(err);
      // No dialog to close first: Accept had focus, and the refetch may take it away.
      focus.now(rowId(r.id));
    },
  });
  const act = useMutation({
    mutationFn: ({ kind, r }: Confirm) => api.jobs.referrals[kind](slug, r.id),
    onSuccess: (_, { kind, r }) => {
      focus.afterDialog(rowId(r.id));
      setConfirm(null);
      void refreshReferrals(qc, slug);
      toast.success(DONE[kind]);
    },
    // The dialog closes, as the question it asked may no longer stand, and the list refetches behind it.
    onError: (err, { r }) => {
      focus.afterDialog(rowId(r.id));
      setConfirm(null);
      failed(err);
    },
  });

  const actionsFor = (r: ReferralDto) => {
    const busy = accept.isPending && accept.variables?.id === r.id;
    const chatHref = r.status === "ACCEPTED" && r.conversationId && chatOn ? `/t/${slug}/app/messages/${r.conversationId}` : null;
    const actions = [
      r.canAccept && !limited && (
        <Button key="accept" className="min-h-11" onClick={() => accept.mutate(r)} loading={busy}>
          Accept request
        </Button>
      ),
      r.canDecline && (
        <Button key="decline" variant="outline" className="min-h-11" onClick={() => setConfirm({ kind: "decline", r })} disabled={busy}>
          Decline request
        </Button>
      ),
      r.canReport && (
        <Button key="report" variant="ghost" className="min-h-11" onClick={() => setReporting(r)} disabled={busy}>
          Report request
        </Button>
      ),
      r.canWithdraw && (
        <Button key="withdraw" variant="outline" className="min-h-11" onClick={() => setConfirm({ kind: "withdraw", r })}>
          Withdraw request
        </Button>
      ),
      chatHref && (
        <LinkButton key="chat" to={chatHref} className="min-h-11">
          Open chat
        </LinkButton>
      ),
    ].filter(Boolean);
    return actions.length ? actions : undefined;
  };

  const confirmText = confirm ? REFERRAL_CONFIRM[confirm.kind] : null;
  return (
    <>
      <ListBody list={{ ...list, hasNextPage: !!list.hasNextPage }} empty={empty}>
        {(items) =>
          items.map((r) => (
            <RequestRow
              key={r.id}
              id={rowId(r.id)}
              member={r.member}
              profileHref={r.member && directoryOn ? `/t/${slug}/app/directory/${r.member.id}` : null}
              status={referralStatusLabel(r)}
              // A request waiting for this member's answer stands out; one they're waiting on reads as information.
              tone={r.status === "REQUESTED" && r.box === "sent" ? "info" : TONE[r.status]}
              when={referralWhen(r, (iso) => formatDate(iso))}
              about={showJob ? <JobLine slug={slug} r={r} /> : undefined}
              noteLabel={r.box === "received" ? "Their note" : "Your note"}
              note={r.note}
              actions={actionsFor(r)}
            />
          ))
        }
      </ListBody>
      <ConfirmDialog
        open={!!confirm}
        title={confirmText?.title ?? ""}
        body={confirm && confirmText ? confirmText.body(nameOf(confirm.r)) : undefined}
        confirmLabel={confirmText?.confirm ?? ""}
        destructive
        busy={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ChatReportDialog
        open={!!reporting}
        title="Report request"
        intro={reporting ? referralReportHelp(nameOf(reporting), reporting.status === "REQUESTED") : ""}
        submit={(input) => api.jobs.referrals.report(slug, reporting!.id, input)}
        onDone={() => {
          if (reporting) focus.afterDialog(rowId(reporting.id));
          void refreshReferrals(qc, slug);
        }}
        onClose={() => setReporting(null)}
      />
    </>
  );
}
