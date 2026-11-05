import { DELETED_MEMBER_NAME, MENTORSHIP_BOX_LABELS, MENTORSHIP_CONFIRM, mentorshipKeys, mentorshipReportHelp, type MentorshipBox, type MentorshipDto, type MentorshipPageDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChatReportDialog } from "@/components/chat/ReportMessageDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ListBody } from "@/components/common/ListBody";
import { IconMail, IconMentors } from "@/components/icons";
import { MentorshipRow } from "@/components/mentors/MentorshipRow";
import { Button, EmptyState, LinkButton, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { useRowFocus } from "@/hooks/useRowFocus";
import { api } from "@/lib/api";
import { mentorsPath, refreshMentorship, refreshMentorshipAndChat } from "@/lib/mentors";
import { toast } from "@/stores/uiStore";

const PAGE = 20;

/** One side's requests and mentorships. Received and sent share this, so the count on Requests reads the list itself. */
export function useMentorshipList(slug: string, box: MentorshipBox, enabled = true) {
  return useInfiniteList<MentorshipPageDto>(mentorshipKeys.requests(slug, box), (cursor) => api.mentorship.requests(slug, { box, cursor, limit: PAGE }), enabled);
}

type Confirm = { kind: "withdraw" | "decline" | "end"; m: MentorshipDto };
const DONE: Record<Confirm["kind"], string> = { withdraw: "Request withdrawn", decline: "Request declined", end: "Mentorship ended" };
const nameOf = (m: MentorshipDto) => m.member?.fullName ?? DELETED_MEMBER_NAME;
/** Each row's element, for focus to land on once an action has run. */
const rowId = (id: string) => `mentorship-${id}`;

/**
 * Requests: what others asked this member, and what they asked others, with each one's note and where it stands. `limited`
 * is for a member who can't use mentorship now (it's switched off, or they're a current pupil): only the ways out are
 * offered, which the API keeps open to them, so nobody is stuck in a request or a mentorship.
 */
export function MentorshipRequests({ slug, box, onBoxChange, limited = false }: { slug: string; box: MentorshipBox; onBoxChange: (box: MentorshipBox) => void; limited?: boolean }) {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useMentorshipList(slug, box);
  // The count on Received comes from that list, whichever is open, as the Requests tab's does.
  const waiting = useMentorshipList(slug, "received").first?.waiting ?? 0;
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reporting, setReporting] = useState<MentorshipDto | null>(null);
  const focus = useRowFocus(!!confirm || !!reporting);
  // A chat a mentorship opened is a direct one, which needs messaging; the thread itself says if it can't be opened now.
  const chatOn = tenant.settings.features.messaging && membership.chatEligible;
  const directoryOn = tenant.settings.features.directory;

  // Whatever went wrong, the list may be out of date: someone else may have acted first, so the question asked no longer
  // stands. The dialog closes and the list refetches behind it.
  const failed = (err: unknown, m: MentorshipDto) => {
    toast.error(errorMessage(err));
    focus.afterDialog(rowId(m.id));
    setConfirm(null);
    void refreshMentorship(qc, slug);
  };
  const accept = useMutation({
    mutationFn: (m: MentorshipDto) => api.mentorship.accept(slug, m.id),
    onSuccess: (m) => {
      void refreshMentorshipAndChat(qc, slug);
      toast.success("Mentorship accepted");
      // Into the chat it opened, where their note is already the first message.
      if (m.conversationId) navigate(`/t/${slug}/app/messages/${m.conversationId}`);
    },
    onError: (err, m) => {
      failed(err, m);
      // No dialog to close first: Accept had focus, and the refetch may take it away.
      focus.now(rowId(m.id));
    },
  });
  const act = useMutation({
    mutationFn: ({ kind, m }: Confirm) => api.mentorship[kind](slug, m.id),
    onSuccess: (_, { kind, m }) => {
      focus.afterDialog(rowId(m.id));
      setConfirm(null);
      void (kind === "end" ? refreshMentorshipAndChat(qc, slug) : refreshMentorship(qc, slug));
      toast.success(DONE[kind]);
    },
    onError: (err, { m }) => failed(err, m),
  });

  const actionsFor = (m: MentorshipDto) => {
    const busy = accept.isPending && accept.variables?.id === m.id;
    const chatHref = m.conversationId && m.acceptedAt && chatOn ? `/t/${slug}/app/messages/${m.conversationId}` : null;
    const actions = [
      m.canAccept && !limited && (
        <Button key="accept" className="min-h-11" onClick={() => accept.mutate(m)} loading={busy}>
          Accept request
        </Button>
      ),
      m.canDecline && !limited && (
        <Button key="decline" variant="outline" className="min-h-11" onClick={() => setConfirm({ kind: "decline", m })} disabled={busy}>
          Decline request
        </Button>
      ),
      m.canReport && (
        <Button key="report" variant="ghost" className="min-h-11" onClick={() => setReporting(m)} disabled={busy}>
          Report request
        </Button>
      ),
      m.canWithdraw && (
        <Button key="withdraw" variant="outline" className="min-h-11" onClick={() => setConfirm({ kind: "withdraw", m })}>
          Withdraw request
        </Button>
      ),
      chatHref && (
        <LinkButton key="chat" to={chatHref} variant={m.status === "ACCEPTED" ? "primary" : "outline"} className="min-h-11">
          Open chat
        </LinkButton>
      ),
      m.canEnd && (
        <Button key="end" variant="ghost" className="min-h-11" onClick={() => setConfirm({ kind: "end", m })}>
          End mentorship
        </Button>
      ),
    ].filter(Boolean);
    return actions.length ? actions : undefined;
  };

  const empty =
    box === "received" ? (
      <EmptyState icon={<IconMail size={32} className="text-slate-400" />} title="No requests yet" description="When members ask you to be their mentor, their requests wait here for your answer." />
    ) : (
      <EmptyState
        icon={<IconMentors size={32} className="text-slate-400" />}
        title="You haven't asked anyone yet"
        description="When you ask a mentor, your request and their answer show here."
        action={limited ? undefined : <LinkButton to={mentorsPath(slug)} className="min-h-11">Find mentors</LinkButton>}
      />
    );

  const confirmText = confirm ? MENTORSHIP_CONFIRM[confirm.kind] : null;
  return (
    <div className="space-y-3">
      <Tabs
        className="w-full [&>button]:min-h-11 [&>button]:flex-1"
        value={box}
        onChange={onBoxChange}
        tabs={[
          { value: "received", label: MENTORSHIP_BOX_LABELS.received, ...(waiting > 0 ? { count: waiting } : {}) },
          { value: "sent", label: MENTORSHIP_BOX_LABELS.sent },
        ]}
      />
      <div role="tabpanel" aria-label={MENTORSHIP_BOX_LABELS[box]}>
        <ListBody list={{ ...list, hasNextPage: !!list.hasNextPage }} empty={empty}>
          {(items) =>
            items.map((m) => (
              <MentorshipRow key={m.id} id={rowId(m.id)} m={m} profileHref={m.member && directoryOn ? `/t/${slug}/app/directory/${m.member.id}` : null} actions={actionsFor(m)} />
            ))
          }
        </ListBody>
      </div>
      <ConfirmDialog
        open={!!confirm}
        title={confirmText?.title ?? ""}
        body={confirm && confirmText ? confirmText.body(nameOf(confirm.m)) : undefined}
        confirmLabel={confirmText?.confirm ?? ""}
        destructive
        busy={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ChatReportDialog
        open={!!reporting}
        title="Report request"
        intro={reporting ? mentorshipReportHelp(nameOf(reporting), reporting.status === "REQUESTED") : ""}
        submit={(input) => api.mentorship.report(slug, reporting!.id, input)}
        onDone={() => {
          if (reporting) focus.afterDialog(rowId(reporting.id));
          void refreshMentorship(qc, slug);
        }}
        onClose={() => setReporting(null)}
      />
    </div>
  );
}
