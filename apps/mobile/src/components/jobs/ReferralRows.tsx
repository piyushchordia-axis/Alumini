import { DELETED_MEMBER_NAME, REFERRAL_CONFIRM, referralKeys, referralReportHelp, referralStatusLabel, referralWhen, type ReferralBox, type ReferralDto, type ReferralPageDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StatusLine } from "@/components/chat/ChatFrame";
import { ChatReportSheet } from "@/components/chat/ChatSheets";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { RequestRow } from "@/components/connections/RequestRow";
import { Button } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { useStatus, type RowStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { chatHref } from "@/lib/mentors";
import { jobHref, refreshReferrals, refreshReferralsAndChat } from "@/lib/referrals";
import { colors, useTheme } from "@/theme";

const PAGE = 20;

/** One of the member's own lists. Received and sent share this, so a count on a tab reads the list itself. */
export function useReferralList(slug: string, box: ReferralBox, enabled = true) {
  return useInfiniteList<ReferralPageDto>(referralKeys.requests(slug, box), (cursor) => api.jobs.referrals.mine(slug, { box, cursor, limit: PAGE }), enabled);
}

/** The requests about one of the member's own jobs. */
export function useJobReferralList(slug: string, jobId: string, enabled = true) {
  return useInfiniteList<ReferralPageDto>(referralKeys.job(slug, jobId), (cursor) => api.jobs.referrals.forJob(slug, jobId, { cursor, limit: PAGE }), enabled);
}

type Confirm = { kind: "withdraw" | "decline"; r: ReferralDto };
const DONE: Record<Confirm["kind"], string> = { withdraw: "Request withdrawn", decline: "Request declined" };
const TONE = { REQUESTED: "warning", ACCEPTED: "success", DECLINED: "neutral", WITHDRAWN: "neutral", CLOSED: "neutral" } as const;
const nameOf = (r: ReferralDto) => r.member?.fullName ?? DELETED_MEMBER_NAME;
const line = { fontSize: 13, color: "#334155" } as const;

/** Which job a request is about, opening it while the viewer still can. The link is the job alone, as on the web app. */
function JobLine({ slug, r }: { slug: string; r: ReferralDto }) {
  const router = useRouter();
  const theme = useTheme();
  const what = `${r.job.title} at ${r.job.companyName}`;
  const id = r.job.available ? r.job.id : null;
  if (!id)
    return (
      <Text style={line}>
        For <Text style={{ fontWeight: "600" }}>{what}</Text>
        <Text style={{ color: colors.muted }}> · this job is no longer available</Text>
      </Text>
    );
  return (
    // The whole line, so a long title wraps after "For" rather than under it, and a full 44-point target.
    <Pressable onPress={() => router.push(jobHref(slug, id))} accessibilityRole="link" accessibilityLabel={what} style={{ minHeight: 44, justifyContent: "center" }}>
      <Text style={line}>
        For <Text style={{ fontWeight: "600", color: theme.primary, textDecorationLine: "underline" }}>{what}</Text>
      </Text>
    </Pressable>
  );
}

/**
 * Referral requests as rows, each with its note, where it stands, and what this member can do about it: accept, decline or
 * report one they received, withdraw one they sent, open the chat an acceptance opened. Shared by the Referrals lists and a
 * job's own requests, which lay the rows out themselves and render `sheets` once. `limited` is for a member who can't use
 * referrals now (they're switched off, or the member is a current pupil): only the ways out are offered, which the API keeps
 * open to them. `showJob` names the job on each row, which a job's own page doesn't need.
 */
export function useReferralRows(slug: string, { limited, showJob }: { limited: boolean; showJob: boolean }) {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reporting, setReporting] = useState<ReferralDto | null>(null);
  const [said, say] = useStatus<RowStatus>();
  // An accepted referral's chat is a direct one, which needs messaging; the thread itself says if it can't be opened now.
  const chatOn = tenant.settings.features.messaging && membership.chatEligible;
  const directoryOn = tenant.settings.features.directory;

  const accept = useMutation({
    mutationFn: (r: ReferralDto) => api.jobs.referrals.accept(slug, r.id),
    onSuccess: (r) => {
      void refreshReferralsAndChat(qc, slug);
      say({ id: r.id, text: "Referral request accepted", tone: "info" });
      // Into the chat it opened, where their note is already the first message.
      if (r.conversationId) router.push(chatHref(slug, r.conversationId));
    },
    // Whatever went wrong, the list may be out of date: someone else may have acted first, or the job closed.
    onError: (err, r) => {
      say({ id: r.id, text: errorMessage(err), tone: "warning" });
      void refreshReferrals(qc, slug);
    },
  });
  const act = useMutation({
    mutationFn: ({ kind, r }: Confirm) => api.jobs.referrals[kind](slug, r.id),
    onSuccess: (_, { kind, r }) => {
      setConfirm(null);
      void refreshReferrals(qc, slug);
      say({ id: r.id, text: DONE[kind], tone: "info" });
    },
    // The question asked may no longer stand (someone acted first, or the job closed), so the sheet closes, the row says what
    // went wrong, as the web app's toast does, and the list refetches behind it.
    onError: (err, { r }) => {
      setConfirm(null);
      say({ id: r.id, text: errorMessage(err), tone: "warning" });
      void refreshReferrals(qc, slug);
    },
  });
  const ask = (next: Confirm) => {
    act.reset();
    say(null);
    setConfirm(next);
  };

  const actionsFor = (r: ReferralDto) => {
    const busy = accept.isPending && accept.variables?.id === r.id;
    const grow = { flexGrow: 1 };
    const actions = [
      r.canAccept && !limited && (
        <Button
          key="accept"
          title="Accept request"
          loading={busy}
          style={grow}
          onPress={() => {
            say(null);
            accept.mutate(r);
          }}
        />
      ),
      r.canDecline && <Button key="decline" title="Decline request" variant="outline" disabled={busy} style={grow} onPress={() => ask({ kind: "decline", r })} />,
      r.canReport && (
        <Button
          key="report"
          title="Report request"
          variant="ghost"
          disabled={busy}
          style={grow}
          onPress={() => {
            say(null);
            setReporting(r);
          }}
        />
      ),
      r.canWithdraw && <Button key="withdraw" title="Withdraw request" variant="outline" style={grow} onPress={() => ask({ kind: "withdraw", r })} />,
      r.status === "ACCEPTED" && r.conversationId && chatOn && (
        <Button key="chat" title="Open chat" accessibilityRole="link" style={grow} onPress={() => router.push(chatHref(slug, r.conversationId!))} />
      ),
    ].filter(Boolean);
    return actions.length ? actions : undefined;
  };

  const renderRow = (r: ReferralDto) => (
    <View role="article">
      <RequestRow
        member={r.member}
        onOpenProfile={r.member && directoryOn ? () => router.push(`/t/${slug}/directory/${r.member!.id}`) : undefined}
        status={referralStatusLabel(r)}
        // A request waiting for this member's answer stands out; one they're waiting on reads as information.
        tone={r.status === "REQUESTED" && r.box === "sent" ? "info" : TONE[r.status]}
        when={referralWhen(r, (iso) => formatDate(iso))}
        about={showJob ? <JobLine slug={slug} r={r} /> : undefined}
        noteLabel={r.box === "received" ? "Their note" : "Your note"}
        note={r.note}
        actions={actionsFor(r)}
        notice={said?.id === r.id ? <StatusLine flush text={said.text} tone={said.tone} /> : undefined}
      />
    </View>
  );

  /** What just happened, above the rows, for one a refetch has taken away since (a request hidden since, say). */
  const statusAbove = (items: ReferralDto[]) => (said && !items.some((r) => r.id === said.id) ? <StatusLine flush text={said.text} tone={said.tone} /> : null);

  const confirmText = confirm ? REFERRAL_CONFIRM[confirm.kind] : null;
  const sheets = (
    <>
      <ConfirmSheet
        open={!!confirm}
        title={confirmText?.title ?? ""}
        body={confirm && confirmText ? confirmText.body(nameOf(confirm.r)) : undefined}
        confirmLabel={confirmText?.confirm ?? ""}
        destructive
        busy={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ChatReportSheet
        open={!!reporting}
        title="Report request"
        intro={reporting ? referralReportHelp(nameOf(reporting), reporting.status === "REQUESTED") : ""}
        submit={(input) => api.jobs.referrals.report(slug, reporting!.id, input)}
        onClose={() => setReporting(null)}
        onDone={(text) => {
          if (reporting) say({ id: reporting.id, text, tone: "info" });
          setReporting(null);
          void refreshReferrals(qc, slug);
        }}
      />
    </>
  );
  return { renderRow, statusAbove, sheets };
}
