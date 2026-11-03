import { CAN_REFER_BADGE, JOB_DELETED_TEXT, JOB_TYPE_LABELS, waitingReferralsCloseText } from "@illuminize/shared";
import { fatalQueryError } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Text } from "react-native";
import { StatusLine } from "@/components/chat/ChatFrame";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { JobReferrals, MyReferral } from "@/components/jobs/JobReferrals";
import { JobUnavailable } from "@/components/jobs/JobUnavailable";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { ReportButton } from "@/components/ReportButton";
import { Badge, Body, Button, Card, ErrorText, Muted, Row, Screen, Spinner } from "@/components/ui";
import { useJob } from "@/hooks/useJob";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { leaveGroupNotice, useGroupNotice } from "@/lib/groups";
import { qk } from "@/lib/queryKeys";
import { refreshReferrals } from "@/lib/referrals";
import { colors } from "@/theme";

export default function JobDetailScreen() {
  const { jobId = "" } = useLocalSearchParams<{ jobId: string }>();
  // Keyed, so nothing from one job (a sheet left open, say) carries into the next.
  return <JobDetail key={jobId} jobId={jobId} />;
}

function JobDetail({ jobId }: { jobId: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<"close" | "delete" | null>(null);
  const [status, setStatus] = useStatus();
  // Such as "Job published", from the form that has gone.
  useGroupNotice(`job:${jobId}`, setStatus);
  const job = useJob(slug, jobId);
  // Closing or deleting a job closes the referral requests waiting on it, so their lists change too.
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["jobs", slug] });
    void qc.invalidateQueries({ queryKey: qk.job(slug, jobId) });
    void refreshReferrals(qc, slug);
  };
  const close = useMutation({
    mutationFn: () => api.jobs.close(slug, jobId),
    onSuccess: () => {
      setConfirming(null);
      invalidate();
      setStatus("Job closed");
    },
  });
  const remove = useMutation({
    mutationFn: () => api.jobs.remove(slug, jobId),
    onSuccess: () => {
      setConfirming(null);
      invalidate();
      leaveGroupNotice("jobs", JOB_DELETED_TEXT);
      router.back();
    },
  });

  // Only an answer, or nothing at all to show: a refetch failing in the background keeps the page.
  const error = fatalQueryError(job);
  if (error) return <JobUnavailable error={error} onRetry={() => void job.refetch()} />;
  if (!job.data) return <Spinner />;
  const j = job.data;
  const waiting = j.pendingReferralCount ?? 0;
  const closesWaiting = waiting > 0 ? waitingReferralsCloseText(waiting) : undefined;
  return (
    <Screen>
      <Card>
        <Text role="heading" style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
          {j.title}
        </Text>
        <Muted size={14}>
          {j.companyName}
          {j.location ? ` · ${j.location}` : ""}
          {j.isRemote ? " · Remote" : ""}
        </Muted>
        <Row>
          <Badge label={JOB_TYPE_LABELS[j.jobType]} tone="info" />
          {/* A closed job takes no requests, whatever its poster offered. */}
          {j.canRefer && !j.isClosed && <Badge label={CAN_REFER_BADGE} tone="success" />}
          {j.isClosed && <Badge label="Closed" />}
          <ModerationBadge status={j.moderationStatus} />
        </Row>
        <ModerationNote status={j.moderationStatus} note={j.moderationNote} />
        {j.salaryRange && <Muted size={13}>💰 {j.salaryRange}</Muted>}
        {j.expiresAt && <Muted>Applications close {formatDate(j.expiresAt)}</Muted>}
        <Body>{j.description}</Body>
        {j.applyUrl && !j.isClosed && <Button title="Apply ↗" onPress={() => void Linking.openURL(j.applyUrl!)} />}
        {j.contactEmail && <Button title={`✉️ ${j.contactEmail}`} variant="outline" onPress={() => void Linking.openURL(`mailto:${j.contactEmail}`)} />}
        {j.contactPhone && <Button title={`📞 ${j.contactPhone}`} variant="outline" onPress={() => void Linking.openURL(`tel:${j.contactPhone}`)} />}
        <Row style={{ justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
          <MemberRow slug={slug} member={j.author} meta={`Posted ${formatDate(j.createdAt)}`} />
          {!j.isMine && <ReportButton slug={slug} contentType="JOB" contentId={j.id} />}
        </Row>
        {j.isMine && (
          <Row>
            <Button title="Edit" variant="outline" onPress={() => router.push(`/t/${slug}/jobs/edit/${j.id}`)} />
            {!j.isClosed && (
              <Button
                title="Mark closed"
                variant="outline"
                loading={close.isPending && !confirming}
                onPress={() => {
                  close.reset();
                  // Asked first only when it would close requests someone is waiting on.
                  if (closesWaiting) setConfirming("close");
                  else close.mutate();
                }}
              />
            )}
            <Button
              title="Delete"
              variant="ghost"
              onPress={() => {
                remove.reset();
                setConfirming("delete");
              }}
            />
          </Row>
        )}
        {/* Closing straight away has no sheet to say why it failed. */}
        {!confirming && <ErrorText error={close.error} />}
        <StatusLine flush text={status} />
      </Card>
      {j.isMine ? <JobReferrals slug={slug} job={j} /> : <MyReferral slug={slug} job={j} />}
      <ConfirmSheet
        open={confirming === "close"}
        title="Close this job?"
        body={closesWaiting}
        confirmLabel="Close job"
        busy={close.isPending}
        error={close.error}
        onConfirm={() => close.mutate()}
        onCancel={() => {
          close.reset();
          setConfirming(null);
        }}
      />
      <ConfirmSheet
        open={confirming === "delete"}
        title="Delete this job?"
        body={closesWaiting}
        confirmLabel="Delete job"
        destructive
        busy={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
        onCancel={() => {
          remove.reset();
          setConfirming(null);
        }}
      />
    </Screen>
  );
}
