import { feedEmpty, LATEST_POSTS_TITLE, PINNED_POSTS_LABEL, UPCOMING_EVENTS_STRIP, type PostDto } from "@illuminize/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { CelebrationsCard } from "@/components/CelebrationsCard";
import { DigestBanner } from "@/components/DigestBanner";
import { ExploreRow } from "@/components/ExploreRow";
import { IconFeed } from "@/components/icons";
import { PostCard } from "@/components/PostCard";
import { ProfileStrengthCard } from "@/components/profile/ProfileStrengthCard";
import { Button, EmptyState, headingRole, ListEmpty, SectionScreen, Spinner } from "@/components/ui";
import { UpcomingEvents } from "@/components/UpcomingEvents";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

/** The pinned strip, as one row of the list, so it can be a region of its own as the web's is. */
type PinnedRow = { id: "pinned"; posts: PostDto[] };

export default function FeedScreen() {
  const member = useMembership();
  const { tenant } = member;
  const slug = tenant.slug;
  const router = useRouter();
  const theme = useTheme();
  const qc = useQueryClient();
  const list = useInfiniteList(qk.posts(slug), (cursor) => api.posts.list(slug, { cursor, limit: 10 }));
  const pinned = list.first?.pinned ?? [];
  const data: (PostDto | PinnedRow)[] = pinned.length ? [{ id: "pinned", posts: pinned }, ...list.items] : list.items;
  const empty = feedEmpty(member);
  return (
    <SectionScreen>
      <FlatList
        data={data}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 96 }}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => {
          void list.refetch();
          void qc.invalidateQueries({ queryKey: qk.events(slug, UPCOMING_EVENTS_STRIP) });
        }}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState
              icon={<IconFeed />}
              title={empty.title}
              description={empty.description}
              action={empty.action && <Button title={empty.action.label} variant={empty.action.variant} accessibilityRole="link" onPress={() => router.push(`/t/${slug}/feed/new`)} />}
            />
          </ListEmpty>
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            <ExploreRow />
            <ProfileStrengthCard />
            <DigestBanner slug={slug} />
            <CelebrationsCard slug={slug} />
            <UpcomingEvents slug={slug} />
          </View>
        }
        ListFooterComponent={list.isFetchingNextPage ? <Spinner /> : undefined}
        renderItem={({ item }) => ("posts" in item ? <PinnedPosts slug={slug} posts={item.posts} latest={list.items.length > 0} /> : <PostCard slug={slug} post={item} />)}
      />
      <Pressable onPress={() => router.push(`/t/${slug}/feed/new`)} accessibilityRole="button" accessibilityLabel="New post" style={{ position: "absolute", right: 20, bottom: 24, backgroundColor: theme.primary, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", elevation: 4 }}>
        <Text style={{ color: "#fff", fontSize: 28, lineHeight: 30 }}>+</Text>
      </Pressable>
    </SectionScreen>
  );
}

/** The pinned posts, then, when more follow, the heading over them. The region paints nothing, so its cards stay white. */
function PinnedPosts({ slug, posts, latest }: { slug: string; posts: PostDto[]; latest: boolean }) {
  const { pageMuted } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <View role="region" aria-label={PINNED_POSTS_LABEL} style={{ gap: spacing.md }}>
        {posts.map((p) => (
          <PostCard key={p.id} slug={slug} post={p} />
        ))}
      </View>
      {latest && (
        // Grey text on the page (pageMuted), a shade darker on a tint or a photo, as the web's is.
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.xs }}>
          <Text {...headingRole(2)} style={{ color: pageMuted, fontSize: 14, fontWeight: "700" }}>
            {LATEST_POSTS_TITLE}
          </Text>
          <View aria-hidden style={{ flex: 1, height: 1, backgroundColor: colors.borderStrong }} />
        </View>
      )}
    </View>
  );
}
