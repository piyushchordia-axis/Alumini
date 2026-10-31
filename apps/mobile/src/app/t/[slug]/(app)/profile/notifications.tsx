import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { Button, EmptyState, ListEmpty, Muted } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { notificationHref } from "@/lib/notificationLinks";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";


export default function NotificationsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const qc = useQueryClient();
  const theme = useTheme();
  const list = useInfiniteList(qk.notifications(slug), (cursor) => api.notifications.list(slug, { cursor, limit: 30 }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.notifications(slug) });
    void qc.invalidateQueries({ queryKey: qk.unread(slug) });
  };
  const readAll = useMutation({ mutationFn: () => api.notifications.markAllRead(slug), onSuccess: refresh });
  const readOne = useMutation({ mutationFn: (id: string) => api.notifications.markRead(slug, id), onSuccess: refresh });
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.md }}>
        <Button title="Mark all read" variant="outline" onPress={() => readAll.mutate()} loading={readAll.isPending} />
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(n) => n.id}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon="🔔" title="You're all caught up" />
          </ListEmpty>
        }
        renderItem={({ item: n }) => {
          const to = notificationHref(slug, n.type, n.data);
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (!n.readAt) readOne.mutate(n.id);
                if (to) router.push(to);
              }}
              style={{ backgroundColor: n.readAt ? "#fff" : theme.primarySoft, paddingHorizontal: spacing.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ flex: 1, fontWeight: n.readAt ? "400" : "600", color: colors.text }}>{n.title}</Text>
                <Muted>{timeAgo(n.createdAt)}</Muted>
              </View>
              {n.body && <Muted size={13}>{n.body}</Muted>}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
