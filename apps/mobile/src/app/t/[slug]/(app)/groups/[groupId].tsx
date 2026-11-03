import { CHAT_GROUP_VISIBILITY_INFO, CHAT_INVITE_DECLINE_DAYS, type ChatGroupDto, type ChatGroupMemberDto } from "@illuminize/shared";
import { chatKeys, groupLeaveText } from "@illuminize/shared/chat";
import { fatalQueryError } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlockConfirmSheet, BlockMemberButton } from "@/components/chat/BlockMember";
import { ChatHeader, ChatScreen, iconButton, Sheet, StatusLine } from "@/components/chat/ChatFrame";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { GroupUnavailable, GroupsOff, useGroupsEnabled } from "@/components/groups/GroupFrame";
import { InviteMembersSheet } from "@/components/groups/InviteMembersSheet";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { ReportButton } from "@/components/ReportButton";
import { Avatar, Badge, Button, ErrorText, Spinner } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { forgetGroupThread, groupChatHref, groupsHref, leaveGroupNotice, refreshGroup, useGroupNotice, type GroupsTab } from "@/lib/groups";
import { colors, radius, spacing } from "@/theme";

export default function GroupDetailScreen() {
  const enabled = useGroupsEnabled();
  const { groupId = "" } = useLocalSearchParams<{ groupId: string }>();
  if (!enabled) return <GroupsOff title="Group details" />;
  // Keyed, so a sheet half-open on one group never carries into the next.
  return <GroupDetail key={groupId} id={groupId} />;
}

const card = { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border } as const;

/** What the owner alone is told about moderation: members never learn an edit is waiting, or that one was turned down. */
function ReviewNotice({ group }: { group: ChatGroupDto }) {
  const review = group.review;
  if (!review || review.moderationStatus === "APPROVED") return null;
  const changed = review.name !== group.name || review.description !== group.description;
  const text: Record<Exclude<typeof review.moderationStatus, "APPROVED">, string> = {
    PENDING: review.shownToMembers
      ? "Your changes are waiting for an admin. Members still see the name and description above, and nobody can invite anyone until an admin has looked."
      : "An admin needs to approve this group before anyone else can see it. Nobody can send messages or invite anyone until then.",
    REJECTED: "An admin didn't approve this group, so members can't see it and nobody can send messages in it. You can edit it and send it for review again.",
    REMOVED: "An admin removed this group. Members can't see it, and nobody can send messages in it.",
  };
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", padding: spacing.md, gap: spacing.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: "#78350f" }}>Only you can see this</Text>
        <ModerationBadge status={review.moderationStatus} />
      </View>
      <Text style={{ fontSize: 13, color: "#78350f" }}>{text[review.moderationStatus]}</Text>
      <ModerationNote status={review.moderationStatus} note={review.moderationNote} />
      {review.shownToMembers && changed && (
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 13, color: "#78350f" }}>
            <Text style={{ fontWeight: "600" }}>Waiting for review: </Text>
            {review.name}
          </Text>
          {review.description !== group.description && <Text style={{ fontSize: 13, color: "#78350f" }}>{review.description ?? "No description"}</Text>}
        </View>
      )}
    </View>
  );
}

function MemberRow({ row, onOptions }: { row: ChatGroupMemberDto; onOptions?: () => void }) {
  const { member } = row;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
      <Avatar name={member.fullName} src={member.avatarUrl} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
          {member.fullName}
          {row.isMe && <Text style={{ fontWeight: "400", color: colors.muted }}> (you)</Text>}
        </Text>
        {row.blockedByMe && <Text style={{ fontSize: 12, color: colors.muted }}>You blocked them</Text>}
      </View>
      {row.role === "OWNER" && (
        // In a box, because a badge sits at the top of whatever holds it.
        <View>
          <Badge label="Owner" tone="primary" />
        </View>
      )}
      {onOptions && (
        <Pressable onPress={onOptions} accessibilityRole="button" accessibilityLabel={`Options for ${member.fullName}`} style={({ pressed }) => [iconButton, pressed ? { backgroundColor: colors.bg } : null]}>
          <Text accessible={false} style={{ fontSize: 22, color: colors.muted }}>
            ⋯
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Remove from group, and block or unblock, for one member. Asks first, in place of this sheet rather than over it: iOS can't
 * show one modal while another is still sliding away, so there the question waits for this sheet to go.
 */
function MemberOptionsSheet({
  slug,
  row,
  canRemove,
  directoryOn,
  onClose,
  onRemove,
  onBlock,
  onStatus,
}: {
  slug: string;
  row: ChatGroupMemberDto | null;
  canRemove: boolean;
  directoryOn: boolean;
  onClose: () => void;
  onRemove: (row: ChatGroupMemberDto) => void;
  onBlock: (row: ChatGroupMemberDto) => void;
  onStatus: (text: string) => void;
}) {
  const router = useRouter();
  const next = useRef<(() => void) | null>(null);
  const then = (fn: () => void) => {
    onClose();
    if (Platform.OS === "ios") next.current = fn;
    else fn();
  };
  return (
    <Sheet
      open={!!row}
      title={row?.member.fullName ?? "Member"}
      onClose={onClose}
      onDismiss={() => {
        const fn = next.current;
        next.current = null;
        fn?.();
      }}
    >
      {row && (
        <>
          {directoryOn && (
            <Button
              title="View profile"
              variant="outline"
              accessibilityRole="link"
              onPress={() => {
                onClose();
                // Down into the tabs, which are under this screen, rather than a second set of tabs on top of it.
                router.dismissTo(`/t/${slug}/directory/${row.member.id}`);
              }}
            />
          )}
          {canRemove && <Button title="Remove from group" variant="outline" onPress={() => then(() => onRemove(row))} />}
          {row.blockedByMe ? (
            <BlockMemberButton
              slug={slug}
              member={row.member}
              blocked
              onChange={() => {
                onClose();
                onStatus(`${row.member.fullName} is unblocked`);
              }}
            />
          ) : (
            <Button title="Block member" variant="danger" onPress={() => then(() => onBlock(row))} />
          )}
          <Text style={{ fontSize: 12, color: colors.muted }}>{"Blocking hides their messages from you in every group, and they won't be told."}</Text>
          <Button title="Close" variant="ghost" onPress={onClose} />
        </>
      )}
    </Sheet>
  );
}

function Members({ slug, group, directoryOn, onStatus, onRemove }: { slug: string; group: ChatGroupDto; directoryOn: boolean; onStatus: (text: string) => void; onRemove: (row: ChatGroupMemberDto) => void }) {
  const list = useInfiniteList(chatKeys.groupMembers(slug, group.id), (cursor) => api.chat.groups.members(slug, group.id, { cursor, limit: 30 }));
  const [options, setOptions] = useState<ChatGroupMemberDto | null>(null);
  const [blocking, setBlocking] = useState<ChatGroupMemberDto | null>(null);
  return (
    <View style={[card, { overflow: "hidden" }]}>
      <Text role="heading" style={{ fontSize: 16, fontWeight: "700", color: colors.text, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        Members · {group.memberCount}
      </Text>
      {list.isLoading ? (
        <Spinner label="Loading members…" />
      ) : list.error && list.items.length === 0 ? (
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          <ErrorText error={list.error} />
          <Button title="Retry loading" variant="outline" onPress={() => void list.refetch()} />
        </View>
      ) : list.items.length === 0 ? (
        <Text style={{ padding: spacing.lg, fontSize: 14, color: colors.muted }}>Nobody is in this group now.</Text>
      ) : (
        // A plain list in the screen's own scroll view, paged by the button below.
        list.items.map((row, i) => (
          <View key={row.member.id} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
            <MemberRow row={row} onOptions={row.isMe ? undefined : () => setOptions(row)} />
          </View>
        ))
      )}
      {list.hasNextPage && (
        <View style={{ padding: spacing.md }}>
          <Button title="Show more members" variant="ghost" loading={list.isFetchingNextPage} onPress={list.loadMore} />
        </View>
      )}
      <MemberOptionsSheet
        slug={slug}
        row={options}
        canRemove={group.isOwner && !group.archived}
        directoryOn={directoryOn}
        onClose={() => setOptions(null)}
        onRemove={onRemove}
        onBlock={setBlocking}
        onStatus={onStatus}
      />
      {blocking && (
        <BlockConfirmSheet
          slug={slug}
          member={blocking.member}
          open
          onClose={() => setBlocking(null)}
          onDone={() => onStatus(`${blocking.member.fullName} is blocked`)}
        />
      )}
    </View>
  );
}

type Confirm = { kind: "leave" | "archive" | "decline" } | { kind: "remove"; row: ChatGroupMemberDto };

/**
 * A group's details: what it's for, who's in it, and what this member can do about it. Someone not in an open group sees
 * this as its preview, with Join group. Its owner also sees how moderation left it.
 */
function GroupDetail({ id }: { id: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const query = useQuery({ queryKey: chatKeys.group(slug, id), queryFn: () => api.chat.groups.get(slug, id) });
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  useGroupNotice(id, setStatus);
  const done = (group?: ChatGroupDto) => void refreshGroup(qc, slug, group);
  // Into the chat in place of this screen, so going back from it lands where the member found the group, or back to the
  // chat if it's under this screen already, so one conversation is never open twice. Its own line there says they joined.
  const intoChat = (group: ChatGroupDto) => {
    done(group);
    router.dismissTo(groupChatHref(slug, group.id));
  };
  const join = useMutation({ mutationFn: () => api.chat.groups.join(slug, id), onSuccess: intoChat });
  const accept = useMutation({ mutationFn: () => api.chat.groups.accept(slug, id), onSuccess: intoChat });
  /** Out of the group, or done with its invitation: back to a list, since an invite-only group is now out of sight. */
  const leaveTo = (tab: GroupsTab, text: string) => {
    setConfirm(null);
    forgetGroupThread(qc, slug, id);
    qc.removeQueries({ queryKey: chatKeys.group(slug, id) });
    done();
    leaveGroupNotice("groups", text);
    // Back past this group's thread too, if it's underneath.
    router.dismissTo(groupsHref(slug, tab));
  };
  const leave = useMutation({ mutationFn: () => api.chat.groups.leave(slug, id), onSuccess: () => leaveTo("mine", "You left the group") });
  const decline = useMutation({ mutationFn: () => api.chat.groups.decline(slug, id), onSuccess: () => leaveTo("invitations", "Invitation declined") });
  const archive = useMutation({
    mutationFn: () => api.chat.groups.archive(slug, id),
    onSuccess: (group) => {
      setConfirm(null);
      done(group);
      setStatus("Group archived");
    },
  });
  const remove = useMutation({
    mutationFn: (row: ChatGroupMemberDto) => api.chat.groups.removeMember(slug, id, row.member.id),
    onSuccess: (_, row) => {
      setConfirm(null);
      done();
      setStatus(`${row.member.fullName} was removed from the group`);
    },
  });
  const ask = (next: Confirm) => {
    for (const m of [leave, decline, archive, remove]) m.reset();
    setConfirm(next);
  };

  // Only an answer, or nothing at all to show: a refetch that fails in the background keeps the screen.
  const error = fatalQueryError(query);
  if (error) return <GroupUnavailable header="Group details" error={error} onRetry={() => void query.refetch()} />;
  if (!query.data) {
    return (
      <ChatScreen>
        <ChatHeader title="Group details" />
        <Spinner label="Loading group…" />
      </ChatScreen>
    );
  }
  const g = query.data;
  const member = g.myState === "ACTIVE";
  const invited = g.myState === "INVITED";
  const actionError = join.error ?? accept.error;

  const leaveBody = groupLeaveText(g);

  return (
    <ChatScreen>
      <ChatHeader title="Group details" />
      <StatusLine text={status} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl + insets.bottom, gap: spacing.lg }}>
        <View style={[card, { padding: spacing.lg, gap: spacing.md }]}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
            <Avatar name={g.name} size={56} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text role="heading" style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
                {g.name}
              </Text>
              <Text style={{ fontSize: 13, color: colors.muted }}>
                {CHAT_GROUP_VISIBILITY_INFO[g.visibility].label} · {pluralize(g.memberCount, "member")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {g.isOwner && <Badge label="You own this group" tone="primary" />}
                {g.archived && <Badge label="Archived" />}
                {invited && <Badge label="You're invited" tone="info" />}
              </View>
            </View>
          </View>
          {g.description ? <Text style={{ fontSize: 15, lineHeight: 22, color: "#1e293b" }}>{g.description}</Text> : null}
          <Text style={{ fontSize: 13, color: colors.muted }}>
            {g.archived ? "This group is archived. Its members can still read it, but nobody can send messages in it or join it." : CHAT_GROUP_VISIBILITY_INFO[g.visibility].description}
          </Text>
          {g.myState === "REMOVED" && <Text style={{ fontSize: 13, color: "#475569" }}>{"You were removed from this group, so you'd need a new invitation to join it again."}</Text>}
          <ReviewNotice group={g} />
          <ErrorText error={actionError} />
          <View style={{ gap: spacing.sm }}>
            {/* Back to the chat when this was opened from it, so it's never open twice, or the chat in place of this screen. */}
            {member && <Button title="Open chat" accessibilityRole="link" onPress={() => router.dismissTo(groupChatHref(slug, g.id))} />}
            {invited ? (
              <>
                <Button title="Accept invitation" loading={accept.isPending} onPress={() => accept.mutate()} />
                <Button title="Decline invitation" variant="outline" disabled={accept.isPending} onPress={() => ask({ kind: "decline" })} />
              </>
            ) : g.canJoin ? (
              <Button title="Join group" loading={join.isPending} onPress={() => join.mutate()} />
            ) : null}
            {g.canInvite && <Button title="Invite members" variant="outline" onPress={() => setInviting(true)} />}
            {g.canEdit && <Button title="Edit group" variant="outline" accessibilityRole="link" onPress={() => router.push(`/t/${slug}/groups/edit/${g.id}`)} />}
          </View>
          <View style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            {g.canLeave && <Button title="Leave group" variant="ghost" onPress={() => ask({ kind: "leave" })} />}
            {g.isOwner && !g.archived && <Button title="Archive group" variant="ghost" onPress={() => ask({ kind: "archive" })} />}
            {!g.isOwner && <ReportButton slug={slug} contentType="GROUP" contentId={g.id} label="Report group" onReported={setStatus} />}
          </View>
        </View>

        <Members slug={slug} group={g} directoryOn={tenant.settings.features.directory} onStatus={setStatus} onRemove={(row) => ask({ kind: "remove", row })} />
      </ScrollView>

      {g.canInvite && <InviteMembersSheet slug={slug} group={g} open={inviting} onClose={() => setInviting(false)} onDone={setStatus} directoryOn={tenant.settings.features.directory} />}
      <ConfirmSheet
        open={confirm?.kind === "leave"}
        title="Leave this group?"
        body={leaveBody}
        confirmLabel="Leave group"
        destructive
        busy={leave.isPending}
        error={leave.error}
        onConfirm={() => leave.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirm?.kind === "archive"}
        title="Archive this group?"
        body="Nobody will be able to send messages in it again, and it leaves Discover. Its members can still read it. This can't be undone."
        confirmLabel="Archive group"
        destructive
        busy={archive.isPending}
        error={archive.error}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirm?.kind === "decline"}
        title="Decline this invitation?"
        body={`Whoever invited you won't be told, and their invitations won't reach you for ${CHAT_INVITE_DECLINE_DAYS} days.`}
        confirmLabel="Decline invitation"
        destructive
        busy={decline.isPending}
        error={decline.error}
        onConfirm={() => decline.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirm?.kind === "remove"}
        title={confirm?.kind === "remove" ? `Remove ${confirm.row.member.fullName} from the group?` : "Remove from group?"}
        body="They won't be able to read or send messages here, and they'd need a new invitation to come back."
        confirmLabel="Remove from group"
        destructive
        busy={remove.isPending}
        error={remove.error}
        onConfirm={() => confirm?.kind === "remove" && remove.mutate(confirm.row)}
        onCancel={() => setConfirm(null)}
      />
    </ChatScreen>
  );
}
