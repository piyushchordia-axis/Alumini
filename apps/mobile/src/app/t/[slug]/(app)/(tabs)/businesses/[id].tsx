import { BUSINESS_CATEGORY_LABELS } from "@illuminize/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { ReportButton } from "@/components/ReportButton";
import { RichText } from "@/components/RichText";
import { Avatar, Badge, Button, Card, LoadError, Muted, Row, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors } from "@/theme";

export default function BusinessDetailScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // A listing opened from a link or a reload has nothing behind it, and back() would leave the member stuck here.
  const leave = () => (router.canGoBack() ? router.back() : router.replace(`/t/${slug}/businesses`));
  const item = useQuery({ queryKey: qk.business(slug, id), queryFn: () => api.businesses.get(slug, id) });
  const remove = useMutation({
    mutationFn: () => api.businesses.remove(slug, id),
    onSuccess: () => {
      setConfirmingDelete(false);
      void qc.invalidateQueries({ queryKey: ["businesses", slug] });
      leave();
    },
  });
  if (item.isLoading) return <Spinner />;
  if (item.error || !item.data) return <LoadError error={item.error ?? "Not found"} onRetry={() => void item.refetch()} onBack={leave} backLabel="Back" />;
  const b = item.data;
  return (
    <Screen title="Business">
      <Card>
        <Row style={{ flexWrap: "nowrap" }}>
          <Avatar name={b.name} src={b.logoUrl} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{b.name}</Text>
            {b.city && <Muted size={14}>{b.city}</Muted>}
          </View>
        </Row>
        <Row>
          <Badge label={BUSINESS_CATEGORY_LABELS[b.category]} tone="info" />
          <ModerationBadge status={b.moderationStatus} />
        </Row>
        <ModerationNote status={b.moderationStatus} note={b.moderationNote} />
        <RichText text={b.description} />
        {b.websiteUrl && <Button title="🌐 Website" variant="outline" onPress={() => void Linking.openURL(b.websiteUrl!)} />}
        {b.contactEmail && <Button title={`✉️ ${b.contactEmail}`} variant="outline" onPress={() => void Linking.openURL(`mailto:${b.contactEmail}`)} />}
        {b.contactPhone && <Button title={`📞 ${b.contactPhone}`} variant="outline" onPress={() => void Linking.openURL(`tel:${b.contactPhone}`)} />}
        <Row style={{ justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
          <MemberRow slug={slug} member={b.author} meta={`Listed ${formatDate(b.createdAt)}`} />
          {!b.isMine && <ReportButton slug={slug} contentType="BUSINESS" contentId={b.id} />}
        </Row>
        {b.isMine && (
          <Row>
            <Button title="Edit" variant="outline" onPress={() => router.push(`/t/${slug}/businesses/edit/${b.id}`)} />
            <Button title="Delete" variant="ghost" onPress={() => setConfirmingDelete(true)} />
            <ConfirmSheet open={confirmingDelete} title="Delete this listing?" confirmLabel="Delete listing" destructive busy={remove.isPending} error={remove.error} onConfirm={() => remove.mutate()} onCancel={() => { remove.reset(); setConfirmingDelete(false); }} />
          </Row>
        )}
      </Card>
    </Screen>
  );
}
