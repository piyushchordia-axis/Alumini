import { JOB_TYPE_LABELS } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Text } from "react-native";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { ReportButton } from "@/components/ReportButton";
import { Badge, Body, Button, Card, LoadError, Muted, Row, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors } from "@/theme";

export default function JobDetailScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { jobId = "" } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const job = useQuery({ queryKey: qk.job(slug, jobId), queryFn: () => api.jobs.get(slug, jobId) });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["jobs", slug] });
    void qc.invalidateQueries({ queryKey: qk.job(slug, jobId) });
  };
  const close = useMutation({ mutationFn: () => api.jobs.close(slug, jobId), onSuccess: invalidate, onError: (e) => Alert.alert("Failed", errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.jobs.remove(slug, jobId), onSuccess: () => { setConfirmingDelete(false); invalidate(); router.back(); } });
  if (job.isLoading) return <Spinner />;
  if (job.error || !job.data) return <LoadError error={job.error ?? "Not found"} onRetry={() => void job.refetch()} onBack={() => router.back()} backLabel="Back" />;
  const j = job.data;
  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{j.title}</Text>
        <Muted size={14}>
          {j.companyName}
          {j.location ? ` · ${j.location}` : ""}
          {j.isRemote ? " · Remote" : ""}
        </Muted>
        <Row>
          <Badge label={JOB_TYPE_LABELS[j.jobType]} tone="info" />
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
            {!j.isClosed && <Button title="Mark closed" variant="outline" onPress={() => close.mutate()} loading={close.isPending} />}
            <Button title="Delete" variant="ghost" onPress={() => setConfirmingDelete(true)} />
            <ConfirmSheet open={confirmingDelete} title="Delete this job?" confirmLabel="Delete job" destructive busy={remove.isPending} error={remove.error} onConfirm={() => remove.mutate()} onCancel={() => { remove.reset(); setConfirmingDelete(false); }} />
          </Row>
        )}
      </Card>
    </Screen>
  );
}
