import { CHAT_GROUP_INVITES_PER_CALL, type ChatGroupDto, type ChatMemberDto } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Avatar, Button, ErrorBox, Input, Loading, Modal } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { api } from "@/lib/api";
import { refreshGroup } from "@/lib/groups";
import { toast } from "@/stores/uiStore";

/**
 * Invite members, by searching for them. The list leaves out anyone already in the group or invited, and anyone this member
 * blocked. What the inviter is told afterwards is the same whether or not each invitation reaches its invitee.
 */
export function InviteMembersDialog({ slug, group, open, onClose, directoryOn }: { slug: string; group: ChatGroupDto; open: boolean; onClose: () => void; directoryOn: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const [chosen, setChosen] = useState<Map<string, ChatMemberDto>>(() => new Map());
  const candidates = useQuery({
    queryKey: chatKeys.groupCandidates(slug, group.id, search),
    queryFn: () => api.chat.groups.inviteCandidates(slug, group.id, { q: search || undefined, limit: 20 }),
    enabled: open,
  });
  const full = chosen.size >= CHAT_GROUP_INVITES_PER_CALL;

  const reset = () => {
    setQ("");
    setChosen(new Map());
  };
  const invite = useMutation({
    mutationFn: () => api.chat.groups.invite(slug, group.id, [...chosen.keys()]),
    onSuccess: ({ invited }) => {
      toast.success(invited === 0 ? "They're already in the group" : invited === 1 ? "Invitation sent" : `${invited} invitations sent`);
      void refreshGroup(qc, slug);
      reset();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const close = () => {
    if (invite.isPending) return;
    reset();
    onClose();
  };
  const toggle = (m: ChatMemberDto) =>
    setChosen((old) => {
      const next = new Map(old);
      if (next.has(m.id)) next.delete(m.id);
      else if (next.size < CHAT_GROUP_INVITES_PER_CALL) next.set(m.id, m);
      return next;
    });

  const list = candidates.data ?? [];
  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite members"
      footer={
        <>
          <Button variant="ghost" className="min-h-11" onClick={close} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button className="min-h-11" onClick={() => invite.mutate()} loading={invite.isPending} disabled={chosen.size === 0}>
            {chosen.size > 1 ? `Send ${chosen.size} invitations` : "Send invitation"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {group.visibility === "OPEN"
            ? "They'll find the invitation in Groups. Anyone can also join an open group from Discover."
            : "They'll find the invitation in Groups. New members see messages from when they join."}
        </p>
        <Input aria-label="Search members" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        {chosen.size > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Chosen" role="group">
            {[...chosen.values()].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m)}
                aria-label={`Remove ${m.fullName}`}
                className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary/10 px-3 text-sm text-primary hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="max-w-48 truncate">{m.fullName}</span>
                <span aria-hidden>✕</span>
              </button>
            ))}
          </div>
        )}
        {full && <p className="text-xs text-slate-500">You can invite up to {CHAT_GROUP_INVITES_PER_CALL} people at a time.</p>}
        {candidates.isLoading ? (
          <Loading label="Finding members…" />
        ) : candidates.error && list.length === 0 ? (
          <div className="space-y-2">
            <ErrorBox error={candidates.error} />
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => void candidates.refetch()}>
              Retry loading
            </Button>
          </div>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{search ? "No one to invite matches that name." : "There's no one else to invite right now."}</p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {list.map((m) => {
              const on = chosen.has(m.id);
              return (
                <li key={m.id}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                    <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(m)} className="h-4 w-4 shrink-0 accent-primary" />
                    {/* The name says who it is: initials or a photo's alt text would only repeat it in the checkbox's name. */}
                    <span aria-hidden>
                      <Avatar name={m.fullName} src={m.avatarUrl} size="sm" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{m.fullName}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {!directoryOn && (
          // The API offers nobody else with the directory off, so say why the list is short.
          <p className="text-xs text-slate-500">The member directory is switched off here, so you can invite people you already chat with or share a group with.</p>
        )}
      </div>
    </Modal>
  );
}
