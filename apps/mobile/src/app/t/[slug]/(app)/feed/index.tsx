import { useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { CelebrationsCard } from "@/components/CelebrationsCard";
import { PostCard } from "@/components/PostCard";
import { EmptyState, ListEmpty, Spinner } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

export default function FeedScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const theme = useTheme();
  const list = useInfiniteList(qk.posts(slug), (cursor) => api.posts.list(slug, { cursor, limit: 10 }));
  const data = [...(list.first?.pinned ?? []), ...list.items];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={data}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 96 }}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon="💬" title="No posts yet" description="Be the first to say hello to your batchmates." />
          </ListEmpty>
        }
        ListHeaderComponent={<CelebrationsCard slug={slug} />}
        ListFooterComponent={list.isFetchingNextPage ? <Spinner /> : undefined}
        renderItem={({ item }) => <PostCard slug={slug} post={item} />}
      />
      <Pressable onPress={() => router.push(`/t/${slug}/feed/new`)} accessibilityRole="button" accessibilityLabel="New post" style={{ position: "absolute", right: 20, bottom: 24, backgroundColor: theme.primary, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", elevation: 4 }}>
        <Text style={{ color: "#fff", fontSize: 28, lineHeight: 30 }}>+</Text>
      </Pressable>
    </View>
  );
}
