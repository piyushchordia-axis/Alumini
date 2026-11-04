import { FUNDING_STAGE_LABELS } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Linking, Text } from "react-native";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { ReportButton } from "@/components/ReportButton";
import { Badge, Body, Button, Card, LoadError, Muted, Row, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatAmountRange, formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors } from "@/theme";

export default function FundingDetailScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const item = useQuery({ queryKey: qk.fundingItem(slug, id), queryFn: () => api.funding.get(slug, id) });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["funding", slug] });
  const close = useMutation({ mutationFn: () => api.funding.close(slug, id), onSuccess: invalidate, onError: (e) => Alert.alert("Failed", errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.funding.remove(slug, id), onSuccess: () => { invalidate(); router.back(); }, onError: (e) => Alert.alert("Failed", errorMessage(e)) });
  if (item.isLoading) return <Spinner />;
  if (item.error || !item.data) return <LoadError error={item.error ?? "Not found"} onRetry={() => void item.refetch()} onBack={() => router.back()} backLabel="Back" />;
  const f = item.data;
  return (
    <Screen title="Funding">
      <Card>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{f.title}</Text>
        <Muted size={14}>{formatAmountRange(f.amountMinMinor, f.amountMaxMinor, f.currency)}</Muted>
        <Row>
          <Badge label={f.kind === "SEEKING" ? "Raising" : "Investing"} tone={f.kind === "SEEKING" ? "primary" : "success"} />
          {f.stage && <Badge label={FUNDING_STAGE_LABELS[f.stage]} />}
          {f.isClosed && <Badge label="Closed" />}
          <ModerationBadge status={f.moderationStatus} />
        </Row>
        <ModerationNote status={f.moderationStatus} note={f.moderationNote} />
        <Body>{f.pitch}</Body>
        {f.sectors.length > 0 && <Muted>{f.sectors.map((s) => `#${s}`).join("  ")}</Muted>}
        {f.websiteUrl && <Button title="🌐 Website" variant="outline" onPress={() => void Linking.openURL(f.websiteUrl!)} />}
        {f.contactEmail && <Button title="✉️ Get in touch" onPress={() => void Linking.openURL(`mailto:${f.contactEmail}`)} />}
        {f.contactPhone && <Button title={`📞 ${f.contactPhone}`} variant="outline" onPress={() => void Linking.openURL(`tel:${f.contactPhone}`)} />}
        <Row style={{ justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
          <MemberRow slug={slug} member={f.author} meta={`Listed ${formatDate(f.createdAt)}`} />
          {!f.isMine && <ReportButton slug={slug} contentType="FUNDING" contentId={f.id} />}
        </Row>
        {f.isMine && (
          <Row>
            <Button title="Edit" variant="outline" onPress={() => router.push(`/t/${slug}/funding/edit/${f.id}`)} />
            {!f.isClosed && <Button title="Mark closed" variant="outline" onPress={() => close.mutate()} loading={close.isPending} />}
            <Button title="Delete" variant="ghost" onPress={() => Alert.alert("Delete this listing?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate() }])} />
          </Row>
        )}
      </Card>
    </Screen>
  );
}
