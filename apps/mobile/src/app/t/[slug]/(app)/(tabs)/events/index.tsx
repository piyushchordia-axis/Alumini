import { EVENT_KIND_LABELS, type EventDto } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { ModerationBadge } from "@/components/ModerationBadge";
import { Badge, Card, EmptyState, ListEmpty, Muted, Row, SectionScreen, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

function EventCard({ slug, event }: { slug: string; event: EventDto }) {
  const router = useRouter();
  const theme = useTheme();
  const d = new Date(event.startAt);
  return (
    <Card onPress={() => router.push(`/t/${slug}/events/${event.id}`)}>
      <Row gap={12} style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: theme.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.primary, fontSize: 10, fontWeight: "700", textTransform: "uppercase" }}>{d.toLocaleString(undefined, { month: "short", timeZone: event.timezone })}</Text>
          <Text style={{ color: theme.primary, fontSize: 22, fontWeight: "800", lineHeight: 24 }}>{d.toLocaleString(undefined, { day: "numeric", timeZone: event.timezone })}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontWeight: "700", color: colors.text }} numberOfLines={1}>
            {event.title}
          </Text>
          <Muted size={13}>
            {formatDateTime(event.startAt, event.timezone)} · {event.city}
          </Muted>
          <Row>
            <Badge label={EVENT_KIND_LABELS[event.kind]} tone="info" />
            {event.isCancelled && <Badge label="Cancelled" tone="danger" />}
            {event.myRsvp && <Badge label={`You: ${event.myRsvp.toLowerCase()}`} tone={event.myRsvp === "YES" ? "success" : event.myRsvp === "MAYBE" ? "warning" : "neutral"} />}
            <ModerationBadge status={event.moderationStatus} />
          </Row>
          <Muted>
            {event.yesCount} going{event.maybeCount ? `, ${event.maybeCount} maybe` : ""} · by {event.author.fullName}
          </Muted>
        </View>
      </Row>
    </Card>
  );
}

export default function EventsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const theme = useTheme();
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const list = useInfiniteList(qk.events(slug, { scope }), (cursor) => api.events.list(slug, { scope, cursor, limit: 20 }));
  return (
    <SectionScreen>
      <View style={{ padding: spacing.lg }}>
        <Tabs value={scope} onChange={setScope} tabs={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]} />
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 96 }}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon="📅" title={scope === "upcoming" ? "Nothing planned yet" : "No past events"} description="Heading somewhere? Post a meetup and see who wants to join." />
          </ListEmpty>
        }
        renderItem={({ item }) => <EventCard slug={slug} event={item} />}
      />
      <Pressable onPress={() => router.push(`/t/${slug}/events/new`)} accessibilityRole="button" accessibilityLabel="Plan a gathering" style={{ position: "absolute", right: 20, bottom: 24, backgroundColor: theme.primary, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", elevation: 4 }}>
        <Text style={{ color: "#fff", fontSize: 28, lineHeight: 30 }}>+</Text>
      </Pressable>
    </SectionScreen>
  );
}
