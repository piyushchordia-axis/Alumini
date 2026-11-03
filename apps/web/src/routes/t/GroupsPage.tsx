import { CHAT_INVITE_DECLINE_DAYS, type ChatGroupInviteDto, type CursorPage } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ListBody } from "@/components/common/ListBody";
import { GroupCard, InvitationCard } from "@/components/groups/GroupCards";
import { EmptyState, Input, LinkButton, PageHeader, Tabs } from "@/components/ui";
import { useChatBadge } from "@/hooks/useChat";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { peerName } from "@/lib/chat";
import { forgetGroupThread, groupChatPath, groupsTabFromParams, refreshGroup, type GroupsTab } from "@/lib/groups";
import { toast } from "@/stores/uiStore";

const PAGE = 20;

function Discover({ slug }: { slug: string }) {
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const list = useInfiniteList(chatKeys.groupList(slug, "DISCOVER", search), (cursor) => api.chat.groups.list(slug, { scope: "DISCOVER", q: search || undefined, cursor, limit: PAGE }));
  return (
    <div className="space-y-3">
      <Input aria-label="Search groups" placeholder="Search groups by name" value={q} onChange={(e) => setQ(e.target.value)} type="search" autoComplete="off" />
      <ListBody
        list={{ ...list, hasNextPage: !!list.hasNextPage }}
        empty={
          search ? (
            <EmptyState icon="🔎" title="No groups match" description="Try another name, or create the group yourself." />
          ) : (
            <EmptyState icon="👥" title="No open groups yet" description="Create one, and any member here can find and join it." action={<LinkButton to={`/t/${slug}/app/groups/new`}>Create group</LinkButton>} />
          )
        }
      >
        {(items) => items.map((g) => <GroupCard key={g.id} slug={slug} group={g} />)}
      </ListBody>
    </div>
  );
}

function MyGroups({ slug }: { slug: string }) {
  const list = useInfiniteList(chatKeys.groupList(slug, "MINE"), (cursor) => api.chat.groups.list(slug, { scope: "MINE", cursor, limit: PAGE }));
  return (
    <ListBody list={{ ...list, hasNextPage: !!list.hasNextPage }} empty={<EmptyState icon="👥" title="You're not in any groups yet" description="Find one to join in Discover, or create your own." />}>
      {(items) => items.map((g) => <GroupCard key={g.id} slug={slug} group={g} />)}
    </ListBody>
  );
}

function Invitations({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useInfiniteList<CursorPage<ChatGroupInviteDto>>(chatKeys.groupInvites(slug), (cursor) => api.chat.groups.invites(slug, { cursor, limit: PAGE }));
  const [declining, setDeclining] = useState<ChatGroupInviteDto | null>(null);
  const accept = useMutation({
    mutationFn: (id: string) => api.chat.groups.accept(slug, id),
    onSuccess: (group) => {
      void refreshGroup(qc, slug, group);
      toast.success("You joined the group");
      navigate(groupChatPath(slug, group.id));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const decline = useMutation({
    mutationFn: (id: string) => api.chat.groups.decline(slug, id),
    onSuccess: (_, id) => {
      setDeclining(null);
      forgetGroupThread(qc, slug, id);
      void refreshGroup(qc, slug);
      toast.success("Invitation declined");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <>
      <ListBody list={{ ...list, hasNextPage: !!list.hasNextPage }} empty={<EmptyState icon="📨" title="No invitations" description="When someone invites you to a group, the invitation waits here for you to accept or decline." />}>
        {(items) =>
          items.map((invite) => (
            <InvitationCard
              key={invite.group.id}
              slug={slug}
              invite={invite}
              busy={accept.isPending && accept.variables === invite.group.id}
              onAccept={() => accept.mutate(invite.group.id)}
              onDecline={() => setDeclining(invite)}
            />
          ))
        }
      </ListBody>
      <ConfirmDialog
        open={!!declining}
        title="Decline this invitation?"
        body={declining ? `${peerName(declining.invitedBy)} won't be told, and their invitations won't reach you for ${CHAT_INVITE_DECLINE_DAYS} days.` : undefined}
        confirmLabel="Decline invitation"
        destructive
        busy={decline.isPending}
        onConfirm={() => declining && decline.mutate(declining.group.id)}
        onCancel={() => setDeclining(null)}
      />
    </>
  );
}

const TABS: Array<{ value: GroupsTab; label: string }> = [
  { value: "discover", label: "Discover" },
  { value: "mine", label: "My groups" },
  { value: "invitations", label: "Invitations" },
];

/** Groups: finding open ones, the member's own, and invitations to answer. Each group's conversation is in Messages. */
export function GroupsPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const tab = groupsTabFromParams(params);
  const invites = useChatBadge(slug, true).data?.invites ?? 0;
  const changeTab = (next: GroupsTab) => setParams(next === "discover" ? {} : { tab: next }, { replace: true });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Groups" subtitle="Shared conversations with other members" actions={<LinkButton to={`/t/${slug}/app/groups/new`} className="min-h-11">Create group</LinkButton>} />
      <Tabs
        className="w-full [&>button]:min-h-11 [&>button]:flex-1"
        value={tab}
        onChange={changeTab}
        tabs={TABS.map((t) => (t.value === "invitations" && invites > 0 ? { ...t, count: invites } : t))}
      />
      <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)!.label}>
        {tab === "discover" ? <Discover slug={slug} /> : tab === "mine" ? <MyGroups slug={slug} /> : <Invitations slug={slug} />}
      </div>
    </div>
  );
}
