import type { ChatConversationDto } from "@illuminize/shared";
import { chatKeys, conversationPreview, formatChatTime, isMuted, peerName } from "@illuminize/shared/chat";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { Avatar, EmptyState, ListEmpty, Tabs } from "@/components/ui";
import { useChatBadge, useNow } from "@/hooks/useChat";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { useChatStore } from "@/stores/chatStore";
import { colors, radius, spacing, useTheme } from "@/theme";

function ConversationRow({ c, now, onPress }: { c: ChatConversationDto; now: Date; onPress: () => void }) {
  const theme = useTheme();
  const name = peerName(c.peer);
  const unread = c.unread > 0;
  const muted = isMuted(c, now);
  const preview = conversationPreview(c);
  const time = formatChatTime(c.lastMessageAt, now);
  const label = [name, unread ? `${c.unread} unread` : null, muted ? "muted" : null, preview || null, time].filter(Boolean).join(", ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: pressed ? colors.bg : colors.card, borderBottomWidth: 1, borderBottomColor: colors.border })}
    >
      <Avatar name={name} src={c.peer?.avatarUrl} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: unread ? "700" : "600", color: colors.text }}>
            {name}
          </Text>
          <Text style={{ fontSize: 12, fontWeight: unread ? "700" : "400", color: unread ? theme.primary : colors.faint }}>{time}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: unread ? colors.text : colors.muted, fontStyle: c.lastMessage && !c.lastMessage.body ? "italic" : "normal" }}>
            {preview}
          </Text>
          {muted && <Text style={{ fontSize: 12 }}>🔕</Text>}
          {unread && (
            <View style={{ minWidth: 20, height: 20, borderRadius: radius.full, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{c.unread > 99 ? "99+" : c.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

/** The inbox: conversations under Chats, and requests waiting for an answer under Requests. */
export default function MessagesScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const now = useNow();
  // In the store, so a thread that answers a request can say where the inbox should be when the member comes back to it.
  const inbox = useChatStore((s) => s.inbox);
  const setInbox = useChatStore((s) => s.setInbox);
  const badge = useChatBadge(slug, true);
  const list = useInfiniteList(chatKeys.list(slug, inbox), (cursor) => api.chat.conversations(slug, { inbox, cursor, limit: 20 }));
  const requests = badge.data?.requests ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text role="heading" style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
            Messages
          </Text>
          <Pressable onPress={() => router.push(`/t/${slug}/messages/blocked`)} accessibilityRole="link" accessibilityLabel="Blocked members" style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm }}>
            <Text style={{ fontSize: 13, color: colors.muted }}>Blocked members</Text>
          </Pressable>
        </View>
        <Tabs
          tall
          value={inbox}
          onChange={setInbox}
          tabs={[
            { value: "MAIN", label: "Chats" },
            { value: "REQUESTS", label: "Requests", ...(requests > 0 ? { count: requests } : {}) },
          ]}
        />
      </View>
      <View role="tabpanel" aria-label={inbox === "MAIN" ? "Chats" : "Requests"} style={{ flex: 1 }}>
        <FlatList
          data={list.items}
          keyExtractor={(c) => c.id}
          onEndReached={list.loadMore}
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => void list.refetch()}
          contentContainerStyle={list.items.length === 0 ? { padding: spacing.lg } : undefined}
          ListEmptyComponent={
            <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
              {inbox === "MAIN" ? (
                <EmptyState
                  icon="✉️"
                  title="No conversations yet"
                  description={tenant.settings.features.directory ? "Open a member's profile in the Directory and choose Message this member." : "When you message a member, or accept a request, the conversation shows here."}
                />
              ) : (
                <EmptyState icon="📨" title="No message requests" description="When someone you haven't talked to messages you, it waits here until you accept or decline." />
              )}
            </ListEmpty>
          }
          renderItem={({ item }) => <ConversationRow c={item} now={now} onPress={() => router.push(`/t/${slug}/messages/${item.id}`)} />}
        />
      </View>
    </View>
  );
}
