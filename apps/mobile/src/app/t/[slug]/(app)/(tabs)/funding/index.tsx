import { FUNDING_STAGE_LABELS, type FundingDto } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { ModerationBadge } from "@/components/ModerationBadge";
import { Badge, Button, Card, EmptyState, ListEmpty, Muted, Row, SectionScreen, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatAmountRange, timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

function FundingCard({ slug, item }: { slug: string; item: FundingDto }) {
  const router = useRouter();
  return (
    <Card onPress={() => router.push(`/t/${slug}/funding/${item.id}`)}>
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={{ fontWeight: "700", color: colors.text, flex: 1 }} numberOfLines={1}>
          {item.title}
        </Text>
        <Badge label={item.kind === "SEEKING" ? "Raising" : "Investing"} tone={item.kind === "SEEKING" ? "primary" : "success"} />
        {item.stage && <Badge label={FUNDING_STAGE_LABELS[item.stage]} />}
        {item.isClosed && <Badge label="Closed" />}
        <ModerationBadge status={item.moderationStatus} />
      </Row>
      <Muted size={13}>{formatAmountRange(item.amountMinMinor, item.amountMaxMinor, item.currency)}</Muted>
      <Text numberOfLines={2} style={{ color: "#475569" }}>
        {item.pitch}
      </Text>
      <Muted>
        {item.author.fullName} · {timeAgo(item.createdAt)}
      </Muted>
    </Card>
  );
}

export default function FundingScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const [kind, setKind] = useState<"SEEKING" | "OFFERING">("SEEKING");
  const list = useInfiniteList(qk.funding(slug, { kind }), (cursor) => api.funding.list(slug, { kind, cursor, limit: 20 }));
  return (
    <SectionScreen>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Tabs value={kind} onChange={setKind} tabs={[{ value: "SEEKING", label: "Seeking funding" }, { value: "OFFERING", label: "Investors" }]} />
        <Row>
          <Button title="I'm raising" variant="outline" onPress={() => router.push(`/t/${slug}/funding/new?kind=SEEKING`)} style={{ flex: 1 }} />
          <Button title="I'm investing" onPress={() => router.push(`/t/${slug}/funding/new?kind=OFFERING`)} style={{ flex: 1 }} />
        </Row>
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 48 }}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon="🚀" title={kind === "SEEKING" ? "No one is raising right now" : "No investors listed yet"} />
          </ListEmpty>
        }
        renderItem={({ item }) => <FundingCard slug={slug} item={item} />}
      />
    </SectionScreen>
  );
}
