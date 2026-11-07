import { CHAT_INVITE_DECLINE_DAYS, groupsEmpty, type ChatGroupInviteDto, type CursorPage, type EmptyCopy } from "@illuminize/shared";
import { chatKeys, peerName } from "@illuminize/shared/chat";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { StatusLine } from "@/components/chat/ChatFrame";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { GroupCard, InvitationCard } from "@/components/groups/GroupCards";
import { IconGroups, IconMail, IconSearch } from "@/components/icons";
import { Button, EmptyState, Input, ListEmpty, Muted, SectionScreen, Tabs } from "@/components/ui";
import { useChatBadge } from "@/hooks/useChat";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { forgetGroupThread, groupChatHref, groupsTabFromParam, refreshGroup, useGroupNotice, type GroupsTab } from "@/lib/groups";
import { colors, spacing } from "@/theme";

const PAGE = 20;
const listStyle = { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 };

/** An empty Discover or My groups, with Create group while the member may make one. */
function GroupsEmpty({ slug, empty }: { slug: string; empty: EmptyCopy }) {
  const router = useRouter();
  return (
    <EmptyState
      icon={empty.live ? <IconSearch /> : <IconGroups />}
      title={empty.title}
      description={empty.description}
      live={empty.live}
      action={empty.action && <Button title={empty.action.label} variant={empty.action.variant} accessibilityRole="link" onPress={() => router.push(`/t/${slug}/groups/new`)} />}
    />
  );
}

function Discover({ slug }: { slug: string }) {
  const member = useMembership();
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const list = useInfiniteList(chatKeys.groupList(slug, "DISCOVER", search), (cursor) => api.chat.groups.list(slug, { scope: "DISCOVER", q: search || undefined, cursor, limit: PAGE }));
  return (
    <>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <Input accessibilityLabel="Search groups" placeholder="Search groups by name" value={q} onChangeText={setQ} autoCorrect={false} autoComplete="off" />
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(g) => g.id}
        contentContainerStyle={listStyle}
        keyboardShouldPersistTaps="handled"
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <GroupsEmpty slug={slug} empty={groupsEmpty(member, "discover", !!search)} />
          </ListEmpty>
        }
        renderItem={({ item }) => <GroupCard slug={slug} group={item} />}
      />
    </>
  );
}

function MyGroups({ slug }: { slug: string }) {
  const member = useMembership();
  const list = useInfiniteList(chatKeys.groupList(slug, "MINE"), (cursor) => api.chat.groups.list(slug, { scope: "MINE", cursor, limit: PAGE }));
  return (
    <FlatList
      data={list.items}
      keyExtractor={(g) => g.id}
      contentContainerStyle={listStyle}
      onEndReached={list.loadMore}
      refreshing={list.isRefetching && !list.isFetchingNextPage}
      onRefresh={() => void list.refetch()}
      ListEmptyComponent={
        <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
          <GroupsEmpty slug={slug} empty={groupsEmpty(member, "mine", false)} />
        </ListEmpty>
      }
      renderItem={({ item }) => <GroupCard slug={slug} group={item} />}
    />
  );
}

function Invitations({ slug, onStatus }: { slug: string; onStatus: (text: string) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const list = useInfiniteList<CursorPage<ChatGroupInviteDto>>(chatKeys.groupInvites(slug), (cursor) => api.chat.groups.invites(slug, { cursor, limit: PAGE }));
  const [declining, setDeclining] = useState<ChatGroupInviteDto | null>(null);
  const accept = useMutation({
    mutationFn: (id: string) => api.chat.groups.accept(slug, id),
    onSuccess: (group) => {
      void refreshGroup(qc, slug, group);
      router.push(groupChatHref(slug, group.id));
    },
  });
  const decline = useMutation({
    mutationFn: (id: string) => api.chat.groups.decline(slug, id),
    onSuccess: (_, id) => {
      setDeclining(null);
      forgetGroupThread(qc, slug, id);
      void refreshGroup(qc, slug);
      onStatus("Invitation declined");
    },
  });
  return (
    <>
      <FlatList
        data={list.items}
        keyExtractor={(invite) => invite.group.id}
        contentContainerStyle={listStyle}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListHeaderComponent={accept.error ? <StatusLine tone="warning" text={errorMessage(accept.error)} /> : undefined}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon={<IconMail />} title="No invitations" description="When someone invites you to a group, the invitation waits here for you to accept or decline." />
          </ListEmpty>
        }
        renderItem={({ item }) => (
          <InvitationCard
            slug={slug}
            invite={item}
            busy={accept.isPending && accept.variables === item.group.id}
            onAccept={() => accept.mutate(item.group.id)}
            onDecline={() => {
              decline.reset();
              setDeclining(item);
            }}
          />
        )}
      />
      <ConfirmSheet
        open={!!declining}
        title="Decline this invitation?"
        body={declining ? `${peerName(declining.invitedBy)} won't be told, and their invitations won't reach you for ${CHAT_INVITE_DECLINE_DAYS} days.` : undefined}
        confirmLabel="Decline invitation"
        destructive
        busy={decline.isPending}
        error={decline.error}
        onConfirm={() => declining && decline.mutate(declining.group.id)}
        onCancel={() => setDeclining(null)}
      />
    </>
  );
}

const TABS: { value: GroupsTab; label: string }[] = [
  { value: "discover", label: "Discover" },
  { value: "mine", label: "My groups" },
  { value: "invitations", label: "Invitations" },
];

/** Groups: finding open ones, the member's own, and invitations to answer. Each group's conversation is in Messages. */
export default function GroupsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  // In the URL, as on the web app, so a push about an invitation opens Invitations.
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = groupsTabFromParam(params.tab);
  const invites = useChatBadge(slug, true).data?.invites ?? 0;
  const [status, setStatus] = useState<string | null>(null);
  // Such as "You left the group", from a group's details that have gone.
  useGroupNotice("groups", setStatus);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <SectionScreen>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text role="heading" style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
              Groups
            </Text>
            <Muted size={13}>Shared conversations with other members</Muted>
          </View>
          <Button title="Create group" accessibilityRole="link" onPress={() => router.push(`/t/${slug}/groups/new`)} />
        </View>
        <Tabs tall value={tab} onChange={(next) => router.setParams({ tab: next === "discover" ? undefined : next })} tabs={TABS.map((t) => (t.value === "invitations" && invites > 0 ? { ...t, count: invites } : t))} />
      </View>
      <StatusLine text={status} />
      <View role="tabpanel" aria-label={TABS.find((t) => t.value === tab)!.label} style={{ flex: 1 }}>
        {tab === "discover" ? <Discover slug={slug} /> : tab === "mine" ? <MyGroups slug={slug} /> : <Invitations slug={slug} onStatus={setStatus} />}
      </View>
    </SectionScreen>
  );
}
