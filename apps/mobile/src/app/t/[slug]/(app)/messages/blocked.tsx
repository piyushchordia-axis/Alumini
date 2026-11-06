import { memberYearsLine } from "@illuminize/shared";
import { BLOCKED_LIST_EXPLAINED, chatKeys } from "@illuminize/shared/chat";
import { FlatList, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlockMemberButton } from "@/components/chat/BlockMember";
import { ChatHeader, ChatOff, ChatScreen } from "@/components/chat/ChatFrame";
import { IconShield } from "@/components/icons";
import { Avatar, EmptyState, ListEmpty } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { colors, spacing } from "@/theme";

/**
 * Open whenever the member may chat at all, messages on or off, as blocking is on the API: switching messages off in the
 * middle of an incident mustn't take away the way to block someone, or to see who's blocked.
 */
export default function BlockedMembersScreen() {
  const { membership } = useMembership();
  if (!membership.chatEligible) return <ChatOff />;
  return <BlockedMembers />;
}

function BlockedMembers() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const insets = useSafeAreaInsets();
  const list = useInfiniteList(chatKeys.blocks(slug), (cursor) => api.chat.blocks(slug, { cursor, limit: 30 }));
  return (
    <ChatScreen>
      <ChatHeader title="Blocked members" />
      <FlatList
        data={list.items}
        keyExtractor={(b) => b.member.id}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg + insets.bottom, gap: spacing.sm }}
        ListHeaderComponent={<Text style={{ fontSize: 13, color: colors.muted, marginBottom: spacing.sm }}>{BLOCKED_LIST_EXPLAINED}</Text>}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon={<IconShield size={32} color={colors.faint} />} title="You haven't blocked anyone" description="You can block a member from their profile or from a conversation with them." />
          </ListEmpty>
        }
        renderItem={({ item: b }) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md }}>
            <Avatar name={b.member.fullName} src={b.member.avatarUrl} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
                {b.member.fullName}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted }}>
                {memberYearsLine(b.member, `Blocked ${formatDate(b.createdAt)}`)}
              </Text>
            </View>
            <BlockMemberButton slug={slug} member={b.member} blocked />
          </View>
        )}
      />
    </ChatScreen>
  );
}
