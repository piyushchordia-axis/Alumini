import { MY_CONTENT_OFF, MY_CONTENT_SKELETONS, myContentEmpty, myContentTabs, type ChatGroupDto, type JobCardDto, type MyContentTab } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import { useState } from "react";
import { FlatList, View , Text } from "react-native";
import { OwnedGroupCard } from "@/components/groups/GroupCards";
import { NavIcon } from "@/components/icons";
import { JobCard } from "@/components/jobs/JobCard";
import { PostCard } from "@/components/PostCard";
import { ModerationBadge } from "@/components/ModerationBadge";
import { Button, Card, EmptyState, ListEmpty, Muted, Row, StackScreen, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { myContentPush } from "@/lib/emptyStates";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function MyContentScreen() {
  const member = useMembership();
  const slug = member.tenant.slug;
  const router = useRouter();
  const tabs = myContentTabs(member);
  // A link can choose the tab, as a notice about a group's review chooses Groups. Choosing another here stays on this
  // screen: changing the route's params would make the next link to My posts push a second copy of it.
  // A choice made here holds until a link chooses again.
  const { tab: linked } = useLocalSearchParams<{ tab?: string }>();
  const [picked, setPicked] = useState<{ linked: string | undefined; tab: MyContentTab } | null>(null);
  const setTab = (next: MyContentTab) => setPicked({ linked, tab: next });
  const tab: MyContentTab = (picked && picked.linked === linked ? picked.tab : undefined) ?? tabs.find((t) => t.value === linked)?.value ?? tabs[0]?.value ?? "posts";
  const posts = useInfiniteList(qk.posts(slug, { mine: true }), (cursor) => api.posts.list(slug, { mine: true, cursor, limit: 20 }), tab === "posts");
  const jobs = useInfiniteList(qk.jobs(slug, { mine: true }), (cursor) => api.jobs.list(slug, { mine: true, cursor, limit: 20 }), tab === "jobs");
  const funding = useInfiniteList(qk.funding(slug, { mine: true }), (cursor) => api.funding.list(slug, { mine: true, cursor, limit: 20 }), tab === "funding");
  const businesses = useInfiniteList(qk.businesses(slug, { mine: true }), (cursor) => api.businesses.list(slug, { mine: true, cursor, limit: 20 }), tab === "businesses");
  // Groups they own, with how moderation left each one: the only place a rejected or removed group's note shows.
  const groups = useInfiniteList(chatKeys.groupList(slug, "OWNED"), (cursor) => api.chat.groups.list(slug, { scope: "OWNED", cursor, limit: 20 }), tab === "groups");
  const events = useInfiniteList(qk.events(slug, { mine: true, scope: "upcoming" }), (cursor) => api.events.list(slug, { mine: true, scope: "upcoming", cursor, limit: 20 }), tab === "events");
  const pastEvents = useInfiniteList(qk.events(slug, { mine: true, scope: "past" }), (cursor) => api.events.list(slug, { mine: true, scope: "past", cursor, limit: 20 }), tab === "pastEvents");
  const active = { posts, jobs, funding, businesses, groups, events, pastEvents }[tab];
  const section = tab === "pastEvents" ? "events" : tab;
  const empty = myContentEmpty(tab, member);
  type Item = { id: string; title?: string; name?: string; body?: string; moderationStatus: "PENDING" | "APPROVED" | "REJECTED" | "REMOVED"; moderationNote?: string | null };
  if (tabs.length === 0) {
    return (
      <StackScreen title="My posts & listings">
        <View style={{ padding: spacing.lg }}>
          <EmptyState icon={<NavIcon name={MY_CONTENT_OFF.icon} />} title={MY_CONTENT_OFF.title} description={MY_CONTENT_OFF.description} />
        </View>
      </StackScreen>
    );
  }
  return (
    <StackScreen title="My posts & listings">
      <View style={{ padding: spacing.lg }}>
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
      </View>
      <FlatList
        data={active.items as Item[]}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 48 }}
        onEndReached={active.loadMore}
        ListEmptyComponent={
          <ListEmpty view={active.view} skeleton={MY_CONTENT_SKELETONS[tab]} error={active.error} onRetry={active.retry} retrying={active.retrying}>
            <EmptyState
              icon={<NavIcon name={empty.icon} />}
              title={empty.title}
              description={empty.description}
              action={
                empty.actions.length > 0 &&
                empty.actions.map((a) => <Button key={a.what} title={a.label} variant={a.variant} accessibilityRole="link" onPress={() => myContentPush(router, slug, a.what)} />)
              }
            />
          </ListEmpty>
        }
        renderItem={({ item }) =>
          tab === "posts" ? (
            <PostCard slug={slug} post={item as Parameters<typeof PostCard>[0]["post"]} />
          ) : tab === "jobs" ? (
            <JobCard slug={slug} job={item as unknown as JobCardDto} />
          ) : tab === "groups" ? (
            <OwnedGroupCard slug={slug} group={item as unknown as ChatGroupDto} />
          ) : (
            // A removed item's page 404s even for its author, so that card opens nothing.
            <Card onPress={item.moderationStatus === "REMOVED" ? undefined : () => router.push(`/t/${slug}/${section}/${item.id}`)}>
              <Row style={{ justifyContent: "space-between" }}>
                <Text style={{ fontWeight: "700", color: colors.text, flex: 1 }} numberOfLines={1}>
                  {item.title ?? item.name ?? item.body}
                </Text>
                <ModerationBadge status={item.moderationStatus} />
              </Row>
              {item.moderationNote && item.moderationStatus !== "APPROVED" && <Muted>Admin note: {item.moderationNote}</Muted>}
            </Card>
          )
        }
      />
    </StackScreen>
  );
}
