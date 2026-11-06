import { CHAT_GROUP_VISIBILITY_INFO, MODERATION_STATUS_LABELS, nameWithYears, type ChatGroupDto, type ChatGroupInviteDto } from "@illuminize/shared";
import { peerName } from "@illuminize/shared/chat";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { Avatar, Badge, Button } from "@/components/ui";
import { formatDate, pluralize } from "@/lib/format";
import { groupChatHref, groupHref } from "@/lib/groups";
import { colors, radius, spacing } from "@/theme";

/** Who can join and how many are in it, which every group row says. */
export function groupMeta(group: Pick<ChatGroupDto, "visibility" | "memberCount">): string {
  return `${CHAT_GROUP_VISIBILITY_INFO[group.visibility].label} · ${pluralize(group.memberCount, "member")}`;
}

/**
 * One group in a list. The top of the card opens the group's details; anything in `actions` sits below it, so a button there
 * never nests inside that link. A link's name stands in for everything inside it, so `spoken` says what its badges and
 * lines show (a status, an admin's note, who sent an invitation), or a screen reader would never hear them.
 */
function GroupRow({ slug, group, title, badges, spoken = [], children, actions }: { slug: string; group: ChatGroupDto; title?: string; badges?: ReactNode; spoken?: (string | null | false | undefined)[]; children?: ReactNode; actions?: ReactNode }) {
  const router = useRouter();
  const name = title ?? group.name;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
      <Pressable
        onPress={() => router.push(groupHref(slug, group.id))}
        accessibilityRole="link"
        accessibilityLabel={[name, groupMeta(group), ...spoken].filter(Boolean).join(", ")}
        style={({ pressed }) => ({ padding: spacing.lg, gap: spacing.sm, backgroundColor: pressed ? colors.bg : colors.card })}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
          <Avatar name={name} size={44} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>
              {name}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{groupMeta(group)}</Text>
          </View>
          {badges ? <View style={{ alignItems: "flex-end", gap: 4, flexShrink: 0 }}>{badges}</View> : null}
        </View>
        {children}
      </Pressable>
      {actions ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>{actions}</View> : null}
    </View>
  );
}

function Description({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Text numberOfLines={2} style={{ fontSize: 14, color: "#475569" }}>
      {text}
    </Text>
  );
}

/** A group in Discover or My groups. A member gets straight into its chat; anyone else opens its details first, where they can join. */
export function GroupCard({ slug, group }: { slug: string; group: ChatGroupDto }) {
  const router = useRouter();
  const member = group.myState === "ACTIVE";
  const review = group.review;
  const status = review && review.moderationStatus !== "APPROVED" ? MODERATION_STATUS_LABELS[review.moderationStatus] : null;
  return (
    <GroupRow
      slug={slug}
      group={group}
      spoken={[group.isOwner ? "Owner" : member && "Member", group.archived && "Archived", status, group.description]}
      badges={
        <>
          {group.isOwner && <Badge label="Owner" tone="primary" />}
          {member && !group.isOwner && <Badge label="Member" />}
          {group.archived && <Badge label="Archived" />}
          {review && <ModerationBadge status={review.moderationStatus} />}
        </>
      }
      actions={member ? <Button title="Open chat" variant="outline" accessibilityRole="link" accessibilityLabel={`Open chat, ${group.name}`} onPress={() => router.push(groupChatHref(slug, group.id))} /> : undefined}
    >
      <Description text={group.description} />
    </GroupRow>
  );
}

/** An invitation, answered here or from the group's details. Who sent it shows; whether others were invited never does. */
export function InvitationCard({ slug, invite, busy, onAccept, onDecline }: { slug: string; invite: ChatGroupInviteDto; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  const { group } = invite;
  const invitedBy = `Invited by ${invite.invitedBy ? nameWithYears(invite.invitedBy) : peerName(null)} · ${formatDate(invite.invitedAt)}`;
  return (
    <GroupRow
      slug={slug}
      group={group}
      spoken={[group.description, invitedBy]}
      actions={
        <>
          <Button title="Accept invitation" loading={busy} onPress={onAccept} style={{ flexGrow: 1 }} />
          <Button title="Decline invitation" variant="outline" disabled={busy} onPress={onDecline} style={{ flexGrow: 1 }} />
        </>
      }
    >
      <Description text={group.description} />
      <Text style={{ fontSize: 12, color: colors.muted }}>{invitedBy}</Text>
    </GroupRow>
  );
}

/**
 * A group in My posts, as its owner sees it: what they last submitted, and what moderation made of it, with the admin's note.
 * Members never see the submitted text until it's approved.
 */
export function OwnedGroupCard({ slug, group }: { slug: string; group: ChatGroupDto }) {
  const review = group.review;
  const edited = !!review && review.shownToMembers && review.moderationStatus === "PENDING";
  const editedText = `Your changes are waiting for review. Members still see “${group.name}”.`;
  const description = review ? review.description : group.description;
  const note = review?.moderationNote && (review.moderationStatus === "REJECTED" || review.moderationStatus === "REMOVED") ? `Admin note: ${review.moderationNote}` : null;
  return (
    <GroupRow
      slug={slug}
      group={group}
      title={review ? review.name : group.name}
      spoken={[review && review.moderationStatus !== "APPROVED" && MODERATION_STATUS_LABELS[review.moderationStatus], group.archived && "Archived", note, edited && editedText, description]}
      badges={
        <>
          {review && <ModerationBadge status={review.moderationStatus} />}
          {group.archived && <Badge label="Archived" />}
        </>
      }
    >
      {review && <ModerationNote status={review.moderationStatus} note={review.moderationNote} />}
      {edited && <Text style={{ fontSize: 12, color: colors.muted }}>{editedText}</Text>}
      {/* What they submitted, which can be no description at all while members still see the old one. */}
      <Description text={description} />
    </GroupRow>
  );
}
