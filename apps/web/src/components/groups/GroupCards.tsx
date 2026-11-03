import { CHAT_GROUP_VISIBILITY_INFO, type ChatGroupDto, type ChatGroupInviteDto } from "@illuminize/shared";
import { peerName } from "@illuminize/shared/chat";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ModerationCardNote, ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import { formatDate, pluralize } from "@/lib/format";
import { groupChatPath, groupPath } from "@/lib/groups";

/** Who can join and how many are in it, which every group row says. */
export function groupMeta(group: Pick<ChatGroupDto, "visibility" | "memberCount">): string {
  return `${CHAT_GROUP_VISIBILITY_INFO[group.visibility].label} · ${pluralize(group.memberCount, "member")}`;
}

/** Long names wrap rather than run off a phone, and a name with no spaces still breaks. */
const NAME = "font-semibold text-slate-900 [overflow-wrap:anywhere]";

/**
 * One group in a list. Its name opens the group's details, and the whole card is that link's target area; anything in
 * `actions` sits above it, so a second link or a button there never nests inside the first.
 */
function GroupRow({ slug, group, title, badges, children, actions }: { slug: string; group: ChatGroupDto; title?: string; badges?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <Card as="article" className="relative p-4 transition focus-within:ring-2 focus-within:ring-primary/30 hover:border-slate-300 hover:shadow">
      <div className="flex items-start gap-3">
        <Avatar name={title ?? group.name} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className={clsx(NAME, "line-clamp-2")}>
            <Link to={groupPath(slug, group.id)} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
              {title ?? group.name}
            </Link>
          </h3>
          <p className="text-xs text-slate-500">{groupMeta(group)}</p>
        </div>
        {badges && <div className="flex shrink-0 flex-col items-end gap-1">{badges}</div>}
      </div>
      {children}
      {actions && <div className="relative z-10 mt-3 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  );
}

function Description({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="mt-2 line-clamp-2 text-sm text-slate-600 [overflow-wrap:anywhere]">{text}</p>;
}

/** A group in Discover or My groups. A member gets straight into its chat; anyone else opens its details first, where they can join. */
export function GroupCard({ slug, group }: { slug: string; group: ChatGroupDto }) {
  const member = group.myState === "ACTIVE";
  const review = group.review;
  return (
    <GroupRow
      slug={slug}
      group={group}
      badges={
        <>
          {group.isOwner && <Badge tone="primary">Owner</Badge>}
          {member && !group.isOwner && <Badge>Member</Badge>}
          {group.archived && <Badge>Archived</Badge>}
          {review && review.moderationStatus !== "APPROVED" && <ModerationStatusBadge status={review.moderationStatus} />}
        </>
      }
      actions={
        member ? (
          <Link to={groupChatPath(slug, group.id)} aria-label={`Open chat, ${group.name}`} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary">
            Open chat
          </Link>
        ) : undefined
      }
    >
      <Description text={group.description} />
    </GroupRow>
  );
}

/** An invitation, answered here or from the group's details. Who sent it shows; whether others were invited never does. */
export function InvitationCard({ slug, invite, busy, onAccept, onDecline }: { slug: string; invite: ChatGroupInviteDto; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  const { group } = invite;
  return (
    <GroupRow
      slug={slug}
      group={group}
      actions={
        <>
          <Button className="min-h-11" onClick={onAccept} loading={busy}>
            Accept invitation
          </Button>
          <Button variant="outline" className="min-h-11" onClick={onDecline} disabled={busy}>
            Decline invitation
          </Button>
        </>
      }
    >
      <Description text={group.description} />
      <p className="mt-2 text-xs text-slate-500">
        Invited by {peerName(invite.invitedBy)} · {formatDate(invite.invitedAt)}
      </p>
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
  return (
    <GroupRow
      slug={slug}
      group={group}
      title={review ? review.name : group.name}
      badges={
        <>
          {review && <ModerationStatusBadge status={review.moderationStatus} />}
          {group.archived && <Badge>Archived</Badge>}
        </>
      }
    >
      {review && <ModerationCardNote status={review.moderationStatus} note={review.moderationNote} />}
      {edited && <p className="mt-2 text-xs text-slate-500">Your changes are waiting for review. Members still see “{group.name}”.</p>}
      {/* What they submitted, which can be no description at all while members still see the old one. */}
      <Description text={review ? review.description : group.description} />
    </GroupRow>
  );
}
