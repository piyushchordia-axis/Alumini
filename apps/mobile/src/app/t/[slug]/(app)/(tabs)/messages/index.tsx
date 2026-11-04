import type { ChatConversationDto, ChatInbox, TenantFeatures } from "@illuminize/shared";
import { chatKeys, conversationPreview, conversationTitle, formatChatTime, isMuted } from "@illuminize/shared/chat";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { Avatar, Button, EmptyState, ListEmpty, SectionScreen, Tabs } from "@/components/ui";
import { useChatBadge, useNow } from "@/hooks/useChat";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { useChatStore } from "@/stores/chatStore";
import { colors, radius, spacing, useTheme } from "@/theme";

function ConversationRow({ c, now, onPress }: { c: ChatConversationDto; now: Date; onPress: () => void }) {
  const theme = useTheme();
  const name = conversationTitle(c);
  const unread = c.unread > 0;
  const muted = isMuted(c, now);
  const preview = conversationPreview(c);
  const time = formatChatTime(c.lastMessageAt, now);
  const label = [c.group ? `Group: ${name}` : name, unread ? `${c.unread} unread` : null, muted ? "muted" : null, c.group?.archived ? "archived" : null, preview || null, time].filter(Boolean).join(", ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: pressed ? colors.bg : colors.card, borderBottomWidth: 1, borderBottomColor: colors.border })}
    >
      <View>
        <Avatar name={name} src={c.peer?.avatarUrl} size={44} />
        {c.group && (
          <View style={{ position: "absolute", right: -3, bottom: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
            <Text accessible={false} style={{ fontSize: 11 }}>
              👥
            </Text>
          </View>
        )}
      </View>
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
          {c.group?.archived && (
            <View style={{ backgroundColor: "#f1f5f9", borderRadius: radius.full, paddingHorizontal: 6 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>Archived</Text>
            </View>
          )}
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

/** What an empty Chats tab suggests, from whichever kinds of chat the institution has on. */
function emptyChatsHint(features: TenantFeatures): string {
  if (!features.messaging) return "When you join a group, its conversation shows here.";
  const message = features.directory ? "Open a member's profile in the Directory and choose Message this member" : "When you message a member, or accept a request, the conversation shows here";
  if (!features.groups) return `${message}.`;
  return features.directory ? `${message}, or join a group.` : "When you message a member, accept a request or join a group, the conversation shows here.";
}

/**
 * The inbox: conversations, groups' among them, under Chats, and requests waiting for an answer under Requests. With direct
 * messages off there are no requests, so there's no Requests tab.
 */
export default function MessagesScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const features = tenant.settings.features;
  const router = useRouter();
  const now = useNow();
  // In the store, so a thread that answers a request can say where the inbox should be when the member comes back to it.
  const asked = useChatStore((s) => s.inbox);
  const inbox: ChatInbox = features.messaging ? asked : "MAIN";
  const setInbox = useChatStore((s) => s.setInbox);
  const badge = useChatBadge(slug, true);
  const list = useInfiniteList(chatKeys.list(slug, inbox), (cursor) => api.chat.conversations(slug, { inbox, cursor, limit: 20 }));
  const requests = badge.data?.requests ?? 0;

  return (
    <SectionScreen>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text role="heading" style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
            Messages
          </Text>
          <Pressable onPress={() => router.push(`/t/${slug}/messages/blocked`)} accessibilityRole="link" accessibilityLabel="Blocked members" style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm }}>
            <Text style={{ fontSize: 13, color: colors.muted }}>Blocked members</Text>
          </Pressable>
        </View>
        {features.messaging && (
          <Tabs
            tall
            value={inbox}
            onChange={setInbox}
            tabs={[
              { value: "MAIN", label: "Chats" },
              { value: "REQUESTS", label: "Requests", ...(requests > 0 ? { count: requests } : {}) },
            ]}
          />
        )}
      </View>
      <View role={features.messaging ? "tabpanel" : "region"} aria-label={inbox === "MAIN" ? "Chats" : "Requests"} style={{ flex: 1 }}>
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
                <View style={{ gap: spacing.md }}>
                  <EmptyState icon="✉️" title="No conversations yet" description={emptyChatsHint(features)} />
                  {features.groups && <Button title="Find a group" variant="outline" accessibilityRole="link" onPress={() => router.push(`/t/${slug}/groups`)} />}
                </View>
              ) : (
                <EmptyState icon="📨" title="No message requests" description="When someone you haven't talked to messages you, it waits here until you accept or decline." />
              )}
            </ListEmpty>
          }
          renderItem={({ item }) => <ConversationRow c={item} now={now} onPress={() => router.push(`/t/${slug}/messages/${item.id}`)} />}
        />
      </View>
    </SectionScreen>
  );
}
