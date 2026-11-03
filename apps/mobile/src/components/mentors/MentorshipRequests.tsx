import { DELETED_MEMBER_NAME, MENTORSHIP_BOX_LABELS, MENTORSHIP_CONFIRM, mentorshipKeys, mentorshipReportHelp, type MentorshipBox, type MentorshipDto, type MentorshipPageDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState, type ReactElement } from "react";
import { FlatList, View } from "react-native";
import { StatusLine } from "@/components/chat/ChatFrame";
import { ChatReportSheet } from "@/components/chat/ChatSheets";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { MentorshipRow } from "@/components/mentors/MentorCards";
import { Button, EmptyState, ListEmpty, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { useStatus, type RowStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { chatHref, refreshMentorship, refreshMentorshipAndChat } from "@/lib/mentors";
import { spacing } from "@/theme";

const PAGE = 20;

/** One side's requests and mentorships. Received and sent share this, so the count on Requests reads the list itself. */
export function useMentorshipList(slug: string, box: MentorshipBox, enabled = true) {
  return useInfiniteList<MentorshipPageDto>(mentorshipKeys.requests(slug, box), (cursor) => api.mentorship.requests(slug, { box, cursor, limit: PAGE }), enabled);
}

type Confirm = { kind: "withdraw" | "decline" | "end"; m: MentorshipDto };
const DONE: Record<Confirm["kind"], string> = { withdraw: "Request withdrawn", decline: "Request declined", end: "Mentorship ended" };
const nameOf = (m: MentorshipDto) => m.member?.fullName ?? DELETED_MEMBER_NAME;

/**
 * Requests: what others asked this member, and what they asked others, with each one's note and where it stands. `limited`
 * is for a member who can't use mentorship now (it's switched off, or they're a current pupil): only the ways out are
 * offered, which the API keeps open to them, so nobody is stuck in a request or a mentorship. `header` scrolls with the list.
 */
export function MentorshipRequests({
  slug,
  box,
  onBoxChange,
  onFind,
  limited = false,
  header,
}: {
  slug: string;
  box: MentorshipBox;
  onBoxChange: (box: MentorshipBox) => void;
  /** Over to Find mentors, offered when nothing has been asked yet. */
  onFind?: () => void;
  limited?: boolean;
  header?: ReactElement;
}) {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const router = useRouter();
  const list = useMentorshipList(slug, box);
  // The count on Received comes from that list, whichever is open, as the Requests tab's does.
  const waiting = useMentorshipList(slug, "received").first?.waiting ?? 0;
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reporting, setReporting] = useState<MentorshipDto | null>(null);
  const [said, say] = useStatus<RowStatus>();
  // A chat a mentorship opened is a direct one, which needs messaging; the thread itself says if it can't be opened now.
  const chatOn = tenant.settings.features.messaging && membership.chatEligible;
  const directoryOn = tenant.settings.features.directory;

  const accept = useMutation({
    mutationFn: (m: MentorshipDto) => api.mentorship.accept(slug, m.id),
    onSuccess: (m) => {
      void refreshMentorshipAndChat(qc, slug);
      say({ id: m.id, text: "Mentorship accepted", tone: "info" });
      // Into the chat it opened, where their note is already the first message.
      if (m.conversationId) router.push(chatHref(slug, m.conversationId));
    },
    // Whatever went wrong, the list may be out of date: someone else may have acted first.
    onError: (err, m) => {
      say({ id: m.id, text: errorMessage(err), tone: "warning" });
      void refreshMentorship(qc, slug);
    },
  });
  const act = useMutation({
    mutationFn: ({ kind, m }: Confirm) => api.mentorship[kind](slug, m.id),
    onSuccess: (_, { kind, m }) => {
      setConfirm(null);
      void (kind === "end" ? refreshMentorshipAndChat(qc, slug) : refreshMentorship(qc, slug));
      say({ id: m.id, text: DONE[kind], tone: "info" });
    },
    // The question asked may no longer stand (someone acted first), so the sheet closes, the row says what went wrong, as the
    // web app's toast does, and the list refetches behind it.
    onError: (err, { m }) => {
      setConfirm(null);
      say({ id: m.id, text: errorMessage(err), tone: "warning" });
      void refreshMentorship(qc, slug);
    },
  });
  const ask = (next: Confirm) => {
    act.reset();
    say(null);
    setConfirm(next);
  };
  // A row a refetch took away, such as a request hidden since, has its line at the top instead.
  const inRow = !!said && list.items.some((m) => m.id === said.id);

  const actionsFor = (m: MentorshipDto) => {
    const busy = accept.isPending && accept.variables?.id === m.id;
    const grow = { flexGrow: 1 };
    const actions = [
      m.canAccept && !limited && (
        <Button
          key="accept"
          title="Accept request"
          loading={busy}
          style={grow}
          onPress={() => {
            say(null);
            accept.mutate(m);
          }}
        />
      ),
      m.canDecline && !limited && <Button key="decline" title="Decline request" variant="outline" disabled={busy} style={grow} onPress={() => ask({ kind: "decline", m })} />,
      m.canReport && (
        <Button
          key="report"
          title="Report request"
          variant="ghost"
          disabled={busy}
          style={grow}
          onPress={() => {
            say(null);
            setReporting(m);
          }}
        />
      ),
      m.canWithdraw && <Button key="withdraw" title="Withdraw request" variant="outline" style={grow} onPress={() => ask({ kind: "withdraw", m })} />,
      m.conversationId && m.acceptedAt && chatOn && (
        <Button
          key="chat"
          title="Open chat"
          variant={m.status === "ACCEPTED" ? "primary" : "outline"}
          accessibilityRole="link"
          style={grow}
          onPress={() => router.push(chatHref(slug, m.conversationId!))}
        />
      ),
      m.canEnd && <Button key="end" title="End mentorship" variant="ghost" style={grow} onPress={() => ask({ kind: "end", m })} />,
    ].filter(Boolean);
    return actions.length ? actions : undefined;
  };

  const empty =
    box === "received" ? (
      <EmptyState icon="📨" title="No requests yet" description="When members ask you to be their mentor, their requests wait here for your answer." />
    ) : (
      <View style={{ gap: spacing.md }}>
        <EmptyState icon="🧭" title="You haven't asked anyone yet" description="When you ask a mentor, your request and their answer show here." />
        {onFind && <Button title="Find mentors" variant="outline" onPress={onFind} />}
      </View>
    );

  const confirmText = confirm ? MENTORSHIP_CONFIRM[confirm.kind] : null;
  return (
    <>
      <FlatList
        data={list.items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 48 }}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {header}
            <Tabs
              tall
              value={box}
              onChange={onBoxChange}
              tabs={[
                { value: "received", label: MENTORSHIP_BOX_LABELS.received, ...(waiting > 0 ? { count: waiting } : {}) },
                { value: "sent", label: MENTORSHIP_BOX_LABELS.sent },
              ]}
            />
            {!inRow && said ? <StatusLine text={said.text} tone={said.tone} /> : null}
          </View>
        }
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            {empty}
          </ListEmpty>
        }
        renderItem={({ item }) => (
          <View role="article">
            <MentorshipRow
              m={item}
              onOpenProfile={item.member && directoryOn ? () => router.push(`/t/${slug}/directory/${item.member!.id}`) : undefined}
              actions={actionsFor(item)}
              notice={inRow && said.id === item.id ? <StatusLine flush text={said.text} tone={said.tone} /> : undefined}
            />
          </View>
        )}
      />
      <ConfirmSheet
        open={!!confirm}
        title={confirmText?.title ?? ""}
        body={confirm && confirmText ? confirmText.body(nameOf(confirm.m)) : undefined}
        confirmLabel={confirmText?.confirm ?? ""}
        destructive
        busy={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ChatReportSheet
        open={!!reporting}
        title="Report request"
        intro={reporting ? mentorshipReportHelp(nameOf(reporting), reporting.status === "REQUESTED") : ""}
        submit={(input) => api.mentorship.report(slug, reporting!.id, input)}
        onClose={() => setReporting(null)}
        onDone={(text) => {
          if (reporting) say({ id: reporting.id, text, tone: "info" });
          setReporting(null);
          void refreshMentorship(qc, slug);
        }}
      />
    </>
  );
}
