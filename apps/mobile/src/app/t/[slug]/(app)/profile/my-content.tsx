import { useState } from "react";
import { FlatList, View , Text } from "react-native";
import { PostCard } from "@/components/PostCard";
import { ModerationBadge } from "@/components/ModerationBadge";
import { Card, EmptyState, Muted, Row, Spinner, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";
import { useRouter } from "expo-router";

type Tab = "posts" | "jobs" | "funding" | "events";

export default function MyContentScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("posts");
  const posts = useInfiniteList(qk.posts(slug, { mine: true }), (cursor) => api.posts.list(slug, { mine: true, cursor, limit: 20 }), tab === "posts");
  const jobs = useInfiniteList(qk.jobs(slug, { mine: true }), (cursor) => api.jobs.list(slug, { mine: true, cursor, limit: 20 }), tab === "jobs");
  const funding = useInfiniteList(qk.funding(slug, { mine: true }), (cursor) => api.funding.list(slug, { mine: true, cursor, limit: 20 }), tab === "funding");
  const events = useInfiniteList(qk.events(slug, { mine: true, scope: "upcoming" }), (cursor) => api.events.list(slug, { mine: true, scope: "upcoming", cursor, limit: 20 }), tab === "events");
  const active = { posts, jobs, funding, events }[tab];
  type Item = { id: string; title?: string; body?: string; moderationStatus: "PENDING" | "APPROVED" | "REJECTED" | "REMOVED"; moderationNote?: string | null };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.lg }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "posts", label: "Posts" }, { value: "jobs", label: "Jobs" }, { value: "funding", label: "Funding" }, { value: "events", label: "Events" }]} />
      </View>
      <FlatList
        data={active.items as Item[]}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 48 }}
        onEndReached={active.loadMore}
        ListEmptyComponent={active.isLoading ? <Spinner /> : <EmptyState title="Nothing here yet" />}
        renderItem={({ item }) =>
          tab === "posts" ? (
            <PostCard slug={slug} post={item as Parameters<typeof PostCard>[0]["post"]} />
          ) : (
            <Card onPress={() => router.push(`/t/${slug}/${tab}/${item.id}`)}>
              <Row style={{ justifyContent: "space-between" }}>
                <Text style={{ fontWeight: "700", color: colors.text, flex: 1 }} numberOfLines={1}>
                  {item.title ?? item.body}
                </Text>
                <ModerationBadge status={item.moderationStatus} />
              </Row>
              {item.moderationNote && item.moderationStatus !== "APPROVED" && <Muted>Admin note: {item.moderationNote}</Muted>}
            </Card>
          )
        }
      />
    </View>
  );
}
