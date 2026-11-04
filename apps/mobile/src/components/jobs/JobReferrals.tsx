import { REFERRAL_CONFIRM, jobReferralsIntro, jobReferralsWayOutText, myReferralText, referralAskRefusalText, referralAskText, takesReferralRequests, type JobDetailDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Fragment, useState } from "react";
import { Text, View } from "react-native";
import { StatusLine } from "@/components/chat/ChatFrame";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { IconMail } from "@/components/icons";
import { WayOutBanner } from "@/components/jobs/ReferralRequests";
import { useJobReferralList, useReferralRows } from "@/components/jobs/ReferralRows";
import { Badge, Button, Card, EmptyState, ErrorText, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { chatHref } from "@/lib/mentors";
import { jobsHref, refreshReferrals, referralRequestHref, useReferralsAvailable } from "@/lib/referrals";
import { colors, spacing } from "@/theme";

const heading = { fontSize: 16, fontWeight: "700", color: colors.text } as const;
const body = { fontSize: 14, color: "#475569" } as const;

/**
 * On someone else's job: Ask for a referral, for a member who can and has no request waiting or answered about it, or where
 * their own request stands, with Withdraw request while it waits and Open chat once accepted. Something of their own that
 * would refuse a request (they've asked as many times as they can, or blocked the poster) is said in place of Ask, before
 * any note is written. Nothing at all on a job that takes no requests and that they never asked about. The Jobs list is
 * under this page, so its Referrals tab is reached by going back down to it rather than stacking a second copy.
 */
export function MyReferral({ slug, job }: { slug: string; job: JobDetailDto }) {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const router = useRouter();
  const available = useReferralsAvailable();
  const [now] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useStatus<{ text: string; tone: "info" | "warning" }>();
  const withdraw = useMutation({
    mutationFn: (id: string) => api.jobs.referrals.withdraw(slug, id),
    onSuccess: () => {
      setConfirming(false);
      void refreshReferrals(qc, slug);
      setStatus({ text: "Request withdrawn", tone: "info" });
    },
    // It may have been answered meanwhile, or the job closed: the sheet closes, as on the web app, and the page refetches to
    // say where it stands now.
    onError: (err) => {
      setConfirming(false);
      setStatus({ text: errorMessage(err), tone: "warning" });
      void refreshReferrals(qc, slug);
    },
  });
  const mine = job.myReferral;
  const poster = job.author.fullName;
  // Asking again is allowed once an earlier request was withdrawn or closed with the job, as many times as the API allows.
  const askable = available && takesReferralRequests(job, now) && (!mine || mine.status === "WITHDRAWN" || mine.status === "CLOSED");
  const refusal = askable && job.referralAskRefusal ? referralAskRefusalText(job.referralAskRefusal, poster) : null;
  const canAsk = askable && !refusal;
  if (!mine && !askable) return null;
  const chatOn = tenant.settings.features.messaging && membership.chatEligible;
  return (
    <Card>
      <Text role="heading" style={heading}>
        Referral
      </Text>
      {(mine || !refusal) && <Text style={body}>{mine ? myReferralText(mine.status, poster) : referralAskText(poster)}</Text>}
      {refusal && <Text style={body}>{refusal.body}</Text>}
      {canAsk && <Button title="Ask for a referral" accessibilityRole="link" onPress={() => router.push(referralRequestHref(slug, job.id))} />}
      {mine?.status === "ACCEPTED" && mine.conversationId && chatOn && <Button title="Open chat" accessibilityRole="link" onPress={() => router.push(chatHref(slug, mine.conversationId!))} />}
      {mine?.status === "REQUESTED" && (
        <Button
          title="Withdraw request"
          variant="outline"
          onPress={() => {
            withdraw.reset();
            setStatus(null);
            setConfirming(true);
          }}
        />
      )}
      {mine && <Button title="See your requests" variant="ghost" accessibilityRole="link" onPress={() => router.dismissTo(jobsHref(slug, "referrals", "sent"))} />}
      <StatusLine flush text={status?.text ?? null} tone={status?.tone} />
      <ConfirmSheet
        open={confirming}
        title={REFERRAL_CONFIRM.withdraw.title}
        body={REFERRAL_CONFIRM.withdraw.body(poster)}
        confirmLabel={REFERRAL_CONFIRM.withdraw.confirm}
        destructive
        busy={withdraw.isPending}
        onConfirm={() => mine && withdraw.mutate(mine.id)}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}

/**
 * On the poster's own job: its referral requests, each with the note, who sent it, where it stands and when, and Accept,
 * Decline and Report while it waits, or Open chat once accepted. Shown while the job offers referrals, and afterwards while
 * any request about it is left to see. While referrals are off for the poster, only Decline and Report are offered. The
 * rows sit in the page's own scroll, so more load from a button rather than at the end of a list.
 */
export function JobReferrals({ slug, job }: { slug: string; job: JobDetailDto }) {
  const { tenant, membership } = useMembership();
  const available = useReferralsAvailable();
  const [now] = useState(() => Date.now());
  const list = useJobReferralList(slug, job.id);
  const rows = useReferralRows(slug, { limited: !available, showJob: false });
  if (!job.canRefer && list.items.length === 0) return null;
  const waiting = list.first?.waiting ?? job.pendingReferralCount ?? 0;
  const failed = list.error && list.data === undefined;
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
          <Text role="heading" style={heading}>
            Referral requests
          </Text>
          {waiting > 0 && <Badge label={`${waiting} waiting`} tone="warning" />}
        </View>
        {available ? <Text style={body}>{jobReferralsIntro(job, now)}</Text> : <WayOutBanner text={jobReferralsWayOutText(tenant.shortName ?? tenant.name, membership.chatEligible)} />}
      </View>
      {rows.statusAbove(list.items)}
      {list.isLoading ? (
        <Spinner label="Loading requests…" />
      ) : failed ? (
        <View style={{ gap: spacing.sm }}>
          <ErrorText error={list.error} />
          <Button title="Retry loading" variant="outline" onPress={() => void list.refetch()} />
        </View>
      ) : list.items.length === 0 ? (
        <EmptyState icon={<IconMail size={32} color={colors.faint} />} title="No referral requests yet" description="When members ask you to refer them for this job, their requests wait here for your answer." />
      ) : (
        list.items.map((r) => <Fragment key={r.id}>{rows.renderRow(r)}</Fragment>)
      )}
      {list.hasNextPage && <Button title="Load more" variant="outline" loading={list.isFetchingNextPage} onPress={list.loadMore} />}
      {rows.sheets}
    </View>
  );
}
