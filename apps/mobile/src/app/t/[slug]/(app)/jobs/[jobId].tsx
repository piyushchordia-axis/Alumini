import { JOB_TYPE_LABELS } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Linking, Text } from "react-native";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge } from "@/components/ModerationBadge";
import { ReportButton } from "@/components/ReportButton";
import { Badge, Body, Button, Card, ErrorText, Muted, Row, Screen, Spinner } from "@/components/ui";
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
  const job = useQuery({ queryKey: qk.job(slug, jobId), queryFn: () => api.jobs.get(slug, jobId) });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["jobs", slug] });
    void qc.invalidateQueries({ queryKey: qk.job(slug, jobId) });
  };
  const close = useMutation({ mutationFn: () => api.jobs.close(slug, jobId), onSuccess: invalidate, onError: (e) => Alert.alert("Failed", errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.jobs.remove(slug, jobId), onSuccess: () => { invalidate(); router.back(); }, onError: (e) => Alert.alert("Failed", errorMessage(e)) });
  if (job.isLoading) return <Spinner />;
  if (job.error || !job.data) return <ErrorText error={job.error ?? "Not found"} />;
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
            {!j.isClosed && <Button title="Mark closed" variant="outline" onPress={() => close.mutate()} loading={close.isPending} />}
            <Button title="Delete" variant="ghost" onPress={() => Alert.alert("Delete this job?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate() }])} />
          </Row>
        )}
      </Card>
    </Screen>
  );
}
