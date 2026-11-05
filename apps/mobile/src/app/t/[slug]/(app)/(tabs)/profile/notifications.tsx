import { memberRequestOf } from "@illuminize/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { MemberRequestActions } from "@/components/admin/MemberRequestActions";
import { IconBell, IconSettings } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { Button, EmptyState, ListEmpty, Muted, StackScreen } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMemberActions, type MemberActionOutcome } from "@/hooks/useMemberActions";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { notificationHref } from "@/lib/notificationLinks";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

export default function NotificationsScreen() {
  const { tenant, isTenantAdmin } = useMembership();
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
  // Approve and Reject on an admin's new-member notices. What became of one is said in its row, which stays, now showing
  // where the request stands; at the top if a refetch has taken the row away.
  const [said, say] = useStatus<MemberActionOutcome>();
  const actions = useMemberActions(slug, say);
  const inRow = !!said && list.items.some((n) => memberRequestOf(n)?.membershipId === said.id);
  return (
    <StackScreen title="Notifications">
      <View style={{ padding: spacing.md, flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="Mark all read" variant="outline" onPress={() => readAll.mutate()} loading={readAll.isPending} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Settings" variant="ghost" icon={(color) => <IconSettings size={18} color={color} />} onPress={() => router.push(`/t/${slug}/profile/notification-settings`)} />
        </View>
      </View>
      <StatusLine text={said && !inRow ? said.text : null} tone={said?.tone} />
      <FlatList
        data={list.items}
        keyExtractor={(n) => n.id}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon={<IconBell size={32} color={colors.faint} />} title="You're all caught up" />
          </ListEmpty>
        }
        renderItem={({ item: n }) => {
          // No withAnchor, unlike a push: an admin notice's console screen goes back to this list, not the console's home.
          const to = notificationHref(slug, n.type, n.data, { isAdmin: isTenantAdmin });
          const request = isTenantAdmin ? memberRequestOf(n) : null;
          return (
            <View style={[styles.row, { backgroundColor: n.readAt ? "#fff" : theme.primarySoft }]}>
              {/* The notice's text, and beside it, never inside it, a request's Approve and Reject. */}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (!n.readAt) readOne.mutate(n.id);
                  if (to) router.push(to);
                }}
                style={styles.text}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ flex: 1, fontWeight: n.readAt ? "400" : "600", color: colors.text }}>{n.title}</Text>
                  <Muted>{timeAgo(n.createdAt)}</Muted>
                </View>
                {n.body && <Muted size={13}>{n.body}</Muted>}
              </Pressable>
              {request && (
                <View style={styles.request}>
                  <MemberRequestActions subject={request} actions={actions} />
                  {said?.id === request.membershipId && <StatusLine flush text={said.text} tone={said.tone} />}
                </View>
              )}
            </View>
          );
        }}
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: 1, borderBottomColor: colors.border },
  text: { paddingHorizontal: spacing.lg, paddingVertical: 12 },
  request: { paddingHorizontal: spacing.lg, paddingBottom: 12, gap: spacing.sm },
});
