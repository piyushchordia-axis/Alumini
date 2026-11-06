import { CHAT_GROUP_VISIBILITY_INFO, CHAT_INVITE_DECLINE_DAYS, memberYearsLine, type ChatGroupDto, type ChatGroupMemberDto } from "@illuminize/shared";
import { chatKeys, groupLeaveText } from "@illuminize/shared/chat";
import { errorMessage, fatalQueryError } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BlockConfirmDialog, BlockMemberButton } from "@/components/chat/BlockMemberButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { GroupUnavailable } from "@/components/groups/GroupUnavailable";
import { InviteMembersDialog } from "@/components/groups/InviteMembersDialog";
import { ModerationCardNote, ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Avatar, Badge, Button, Card, ErrorBox, LinkButton, LoadMore, Loading, Modal } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { forgetGroupThread, groupChatPath, groupsPath, refreshGroup, type GroupsTab } from "@/lib/groups";
import { toast } from "@/stores/uiStore";

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
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Only you can see this</span>
        <ModerationStatusBadge status={review.moderationStatus} />
      </div>
      <p className="mt-1">{text[review.moderationStatus]}</p>
      <ModerationCardNote status={review.moderationStatus} note={review.moderationNote} />
      {review.shownToMembers && changed && (
        <div className="mt-2 space-y-1 [overflow-wrap:anywhere]">
          <p>
            <span className="font-medium">Waiting for review: </span>
            {review.name}
          </p>
          {review.description !== group.description && <p className="whitespace-pre-line">{review.description ?? "No description"}</p>}
        </div>
      )}
    </div>
  );
}

/** Remove from group, and block or unblock, for one member. Asks first, in place of this sheet rather than over it. */
function MemberOptions({
  slug,
  row,
  canRemove,
  profileHref,
  onClose,
  onRemove,
  onBlock,
}: {
  slug: string;
  row: ChatGroupMemberDto;
  canRemove: boolean;
  profileHref: string | null;
  onClose: () => void;
  onRemove: () => void;
  onBlock: () => void;
}) {
  const { member } = row;
  return (
    <Modal open onClose={onClose} title={member.fullName}>
      <div className="flex flex-col items-start gap-2">
        {profileHref && (
          <Link to={profileHref} className="inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-medium text-primary underline focus-visible:outline-2 focus-visible:outline-primary">
            View profile
          </Link>
        )}
        {canRemove && (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              onClose();
              onRemove();
            }}
          >
            Remove from group
          </Button>
        )}
        {row.blockedByMe ? (
          // Closes once it's done, so this sheet never goes on offering what was just undone.
          <BlockMemberButton slug={slug} member={member} blocked size="md" onDone={onClose} />
        ) : (
          <Button
            variant="danger"
            className="min-h-11"
            onClick={() => {
              onClose();
              onBlock();
            }}
          >
            Block member
          </Button>
        )}
        <p className="text-xs text-slate-500">Blocking hides their messages from you in every group, and they won't be told.</p>
      </div>
    </Modal>
  );
}

function MemberRow({ row, onOptions }: { row: ChatGroupMemberDto; onOptions?: () => void }) {
  const { member } = row;
  const line = memberYearsLine(member, row.blockedByMe && "You blocked them");
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      <Avatar name={member.fullName} src={member.avatarUrl} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">
          {member.fullName}
          {row.isMe && <span className="font-normal text-slate-500"> (you)</span>}
        </span>
        {line && <span className="block truncate text-xs text-slate-500">{line}</span>}
      </span>
      {row.role === "OWNER" && <Badge tone="primary">Owner</Badge>}
      {onOptions && (
        <button
          type="button"
          onClick={onOptions}
          aria-label={`Options for ${member.fullName}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
      )}
    </li>
  );
}

function Members({
  slug,
  group,
  directoryOn,
  headingRef,
  onRemove,
  onBlock,
}: {
  slug: string;
  group: ChatGroupDto;
  directoryOn: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRemove: (row: ChatGroupMemberDto) => void;
  onBlock: (row: ChatGroupMemberDto) => void;
}) {
  const list = useInfiniteList(chatKeys.groupMembers(slug, group.id), (cursor) => api.chat.groups.members(slug, group.id, { cursor, limit: 30 }));
  const [options, setOptions] = useState<ChatGroupMemberDto | null>(null);
  return (
    <Card as="section" className="overflow-hidden">
      {/* Focus comes here after a removal, whose row and its Options button are about to go. */}
      <h2 ref={headingRef} tabIndex={-1} className="border-b border-slate-100 px-4 py-3 text-base font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
        Members · {group.memberCount}
      </h2>
      {list.isLoading ? (
        <Loading />
      ) : list.error && list.items.length === 0 ? (
        <div className="space-y-3 p-4">
          <ErrorBox error={list.error} />
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => void list.refetch()}>
            Retry loading
          </Button>
        </div>
      ) : list.items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Nobody is in this group now.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.items.map((row) => (
            <MemberRow key={row.member.id} row={row} onOptions={row.isMe ? undefined : () => setOptions(row)} />
          ))}
        </ul>
      )}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
      {options && (
        <MemberOptions
          slug={slug}
          row={options}
          canRemove={group.isOwner && !group.archived}
          profileHref={directoryOn ? `/t/${slug}/app/directory/${options.member.id}` : null}
          onClose={() => setOptions(null)}
          onRemove={() => onRemove(options)}
          onBlock={() => onBlock(options)}
        />
      )}
    </Card>
  );
}

type Confirm = { kind: "leave" | "archive" | "decline" } | { kind: "remove"; row: ChatGroupMemberDto };

/** Remounts per group, so a dialog open on one never carries over to the next. */
export function GroupDetailRoute() {
  const { groupId = "" } = useParams();
  return <GroupDetailPage key={groupId} id={groupId} />;
}

/**
 * A group's details: what it's for, who's in it, and what this member can do about it. Someone not in an open group sees
 * this as its preview, with Join group. Its owner also sees how moderation left it.
 */
function GroupDetailPage({ id }: { id: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: chatKeys.group(slug, id), queryFn: () => api.chat.groups.get(slug, id) });
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [blocking, setBlocking] = useState<ChatGroupMemberDto | null>(null);
  const membersHeading = useRef<HTMLHeadingElement>(null);

  const done = (group?: ChatGroupDto) => void refreshGroup(qc, slug, group);
  // Into the chat in place of this page, as on the app, so going back from it lands where the member found the group. Its
  // own line there says they joined.
  const intoChat = (group: ChatGroupDto) => {
    done(group);
    navigate(groupChatPath(slug, id), { replace: true });
  };
  const join = useMutation({ mutationFn: () => api.chat.groups.join(slug, id), onSuccess: intoChat, onError: (err) => toast.error(errorMessage(err)) });
  const accept = useMutation({ mutationFn: () => api.chat.groups.accept(slug, id), onSuccess: intoChat, onError: (err) => toast.error(errorMessage(err)) });
  /** Out of the group, or done with its invitation: back to a list, since an invite-only group is now out of sight. */
  const leaveTo = (tab: GroupsTab, message: string) => {
    setConfirm(null);
    forgetGroupThread(qc, slug, id);
    qc.removeQueries({ queryKey: chatKeys.group(slug, id) });
    done();
    toast.success(message);
    navigate(groupsPath(slug, tab));
  };
  const leave = useMutation({ mutationFn: () => api.chat.groups.leave(slug, id), onSuccess: () => leaveTo("mine", "You left the group"), onError: (err) => toast.error(errorMessage(err)) });
  const decline = useMutation({ mutationFn: () => api.chat.groups.decline(slug, id), onSuccess: () => leaveTo("invitations", "Invitation declined"), onError: (err) => toast.error(errorMessage(err)) });
  const archive = useMutation({
    mutationFn: () => api.chat.groups.archive(slug, id),
    onSuccess: (group) => {
      setConfirm(null);
      done(group);
      toast.success("Group archived");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (membershipId: string) => api.chat.groups.removeMember(slug, id, membershipId),
    onSuccess: () => {
      const name = confirm?.kind === "remove" ? confirm.row.member.fullName : "They";
      setConfirm(null);
      done();
      toast.success(`${name} was removed from the group`);
      // After the dialog has handed focus back to a row that's about to go.
      setTimeout(() => membersHeading.current?.focus(), 0);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const error = fatalQueryError(query);
  if (error) return <GroupUnavailable slug={slug} error={error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const g = query.data;
  const member = g.myState === "ACTIVE";
  const invited = g.myState === "INVITED";
  const backTab: GroupsTab = member ? "mine" : invited ? "invitations" : "discover";

  const actions: ReactNode[] = [];
  if (member) actions.push(<LinkButton key="chat" to={groupChatPath(slug, g.id)} className="min-h-11">Open chat</LinkButton>);
  if (invited)
    actions.push(
      <Button key="accept" className="min-h-11" onClick={() => accept.mutate()} loading={accept.isPending}>
        Accept invitation
      </Button>,
      <Button key="decline" variant="outline" className="min-h-11" onClick={() => setConfirm({ kind: "decline" })}>
        Decline invitation
      </Button>,
    );
  else if (g.canJoin)
    actions.push(
      <Button key="join" className="min-h-11" onClick={() => join.mutate()} loading={join.isPending}>
        Join group
      </Button>,
    );
  if (g.canInvite)
    actions.push(
      <Button key="invite" variant="outline" className="min-h-11" onClick={() => setInviting(true)}>
        Invite members
      </Button>,
    );
  if (g.canEdit)
    actions.push(
      <LinkButton key="edit" variant="outline" to={`/t/${slug}/app/groups/${g.id}/edit`} state={{ fromGroup: g.id }} className="min-h-11">
        Edit group
      </LinkButton>,
    );

  const leaveBody = groupLeaveText(g);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={groupsPath(slug, backTab)} className="text-sm text-slate-500 hover:text-slate-800">
        ← Groups
      </Link>
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Avatar name={g.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-slate-900 [overflow-wrap:anywhere]">{g.name}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {CHAT_GROUP_VISIBILITY_INFO[g.visibility].label} · {pluralize(g.memberCount, "member")}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {g.isOwner && <Badge tone="primary">You own this group</Badge>}
              {g.archived && <Badge>Archived</Badge>}
              {invited && <Badge tone="info">You're invited</Badge>}
            </div>
          </div>
        </div>
        {g.description && <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{g.description}</p>}
        <p className="mt-3 text-sm text-slate-500">
          {g.archived ? "This group is archived. Its members can still read it, but nobody can send messages in it or join it." : CHAT_GROUP_VISIBILITY_INFO[g.visibility].description}
        </p>
        {g.myState === "REMOVED" && <p className="mt-2 text-sm text-slate-600">You were removed from this group, so you'd need a new invitation to join it again.</p>}
        <ReviewNotice group={g} />
        {actions.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
        {(g.canLeave || (g.isOwner && !g.archived) || !g.isOwner) && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {g.canLeave && (
              <Button variant="ghost" className="min-h-11" onClick={() => setConfirm({ kind: "leave" })}>
                Leave group
              </Button>
            )}
            {g.isOwner && !g.archived && (
              <Button variant="ghost" className="min-h-11 text-red-700 hover:bg-red-50" onClick={() => setConfirm({ kind: "archive" })}>
                Archive group
              </Button>
            )}
            {!g.isOwner && <ReportButton slug={slug} contentType="GROUP" contentId={g.id} label="Report group" className="ml-auto inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-slate-500 hover:bg-slate-100 hover:text-red-700" />}
          </div>
        )}
      </Card>

      <Members slug={slug} group={g} directoryOn={tenant.settings.features.directory} headingRef={membersHeading} onRemove={(row) => setConfirm({ kind: "remove", row })} onBlock={setBlocking} />

      {g.canInvite && <InviteMembersDialog slug={slug} group={g} open={inviting} onClose={() => setInviting(false)} directoryOn={tenant.settings.features.directory} />}
      {blocking && <BlockConfirmDialog slug={slug} member={blocking.member} open onClose={() => setBlocking(null)} />}
      <ConfirmDialog
        open={confirm?.kind === "leave"}
        title="Leave this group?"
        body={leaveBody}
        confirmLabel="Leave group"
        destructive
        busy={leave.isPending}
        onConfirm={() => leave.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "archive"}
        title="Archive this group?"
        body="Nobody will be able to send messages in it again, and it leaves Discover. Its members can still read it. This can't be undone."
        confirmLabel="Archive group"
        destructive
        busy={archive.isPending}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "decline"}
        title="Decline this invitation?"
        body={`Whoever invited you won't be told, and their invitations won't reach you for ${CHAT_INVITE_DECLINE_DAYS} days.`}
        confirmLabel="Decline invitation"
        destructive
        busy={decline.isPending}
        onConfirm={() => decline.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "remove"}
        title={confirm?.kind === "remove" ? `Remove ${confirm.row.member.fullName} from the group?` : "Remove from group?"}
        body="They won't be able to read or send messages here, and they'd need a new invitation to come back."
        confirmLabel="Remove from group"
        destructive
        busy={remove.isPending}
        onConfirm={() => confirm?.kind === "remove" && remove.mutate(confirm.row.member.id)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
