import {
  INVITATION_REVOKED_TEXT,
  INVITATION_TABS,
  channelsSentence,
  formatCount,
  invitationStatusFilter,
  inviteShareText,
  onlySearchChanged,
  parseInvitationTab,
  revokeInvitationCopy,
  sendPendingCopy,
  sendPendingDoneText,
  sentText,
  whatsappUrl,
  type InvitationDto,
} from "@illuminize/shared";
import { errorMessage, isApiClientError, isOutOfDate } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { AdminListScreen } from "@/components/admin/AdminListScreen";
import { InvitationRow } from "@/components/admin/InvitationRow";
import { SearchField } from "@/components/admin/SearchField";
import { StatGrid, StatTile } from "@/components/admin/StatTile";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { IconChevronRight, IconMail, IconSearch, IconUpload } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { Button, EmptyState, ErrorText, ListEmpty, Muted, Spinner, Tabs } from "@/components/ui";
import { refreshInvitations, useInvitationSummary } from "@/hooks/useAdminInvitations";
import { useDebounced } from "@/hooks/useDebounced";
import { useMembership } from "@/hooks/useMembership";
import { usePagedList } from "@/hooks/usePagedList";
import { useStatus, type RowStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { useGroupNotice } from "@/lib/groups";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

const PAGE_SIZE = 25;
/** The API's longest search, as the box takes. */
const SEARCH_MAX = 80;

type Said = { text: string; tone: "info" | "warning" };

function Divider() {
  return <View style={styles.divider} />;
}

/**
 * The console's invitations, as the web console's: the figures and what the plan sends by, Send pending (asked first:
 * each message is billed), the way to the import, a tab for each status (?status=, All unless given) and a search
 * (?q=). Each row's link is copied or shared on WhatsApp from the admin's own phone, sent or resent on a plan that
 * sends, and revoked after asking. Nothing tells the app when a message is delivered: the list refetches when it comes
 * back into view, and on a pull.
 */
export default function AdminInvitationsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  // This screen's own route: router.setParams sets the focused one's, which is the import's once that is open above.
  const navigation = useNavigation<{ setParams(params: { status?: string; q?: string }): void }>();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ status?: string; q?: string }>();
  const tab = parseInvitationTab(params.status);
  // An address may carry a longer search than the box takes, which the API would refuse.
  const [q, setQ] = useState(() => (typeof params.q === "string" ? params.q.slice(0, SEARCH_MAX) : ""));
  const search = useDebounced(q.trim());
  // In the address too, as the tab is, so a reload on the web build keeps the search.
  useEffect(() => {
    if ((params.q ?? "") !== search) navigation.setParams({ q: search || undefined });
  }, [navigation, params.q, search]);

  const summary = useInvitationSummary(slug);
  const s = summary.data;
  const channels = s?.channels ?? [];
  const filters = { status: invitationStatusFilter(tab), q: search || undefined };
  const key = qk.admin.invitations(slug, filters);
  // The rows stay while a search is refined, never across tabs: a Not sent row's Send must not show under Revoked.
  const list = usePagedList(key, (page) => api.admin.invitations.list(slug, { ...filters, page, pageSize: PAGE_SIZE }), { keepPreviousWhile: (previous) => onlySearchChanged(previous, key) });

  const [rowSaid, sayInRow] = useStatus<RowStatus>();
  const [said, say] = useStatus<Said>();
  // What the import left on its way back: "2 invited, 0 updated".
  const showNotice = useCallback((text: string) => say({ text, tone: "info" }), [say]);
  useGroupNotice("admin:invitations", showNotice);

  const send = useMutation({
    mutationFn: (inv: InvitationDto) => api.admin.invitations.send(slug, [inv.id]),
    onSuccess: (r, inv) => sayInRow({ id: inv.id, text: sentText(r.queued, inv.sendCount > 0), tone: "info" }),
    onError: (err, inv) => sayInRow({ id: inv.id, text: errorMessage(err), tone: "warning" }),
    onSettled: () => refreshInvitations(qc, slug),
  });

  const [revoking, setRevoking] = useState<InvitationDto | null>(null);
  const revoke = useMutation({
    mutationFn: (inv: InvitationDto) => api.admin.invitations.revoke(slug, inv.id),
    onSuccess: (_, inv) => {
      setRevoking(null);
      sayInRow({ id: inv.id, text: INVITATION_REVOKED_TEXT, tone: "info" });
    },
    // Accepted since the list was loaded: the question no longer stands, so the sheet closes and the row says why.
    onError: (err, inv) => {
      if (isApiClientError(err) && err.status === 409) {
        setRevoking(null);
        sayInRow({ id: inv.id, text: errorMessage(err), tone: "warning" });
      }
    },
    onSettled: () => refreshInvitations(qc, slug),
  });
  const askRevoke = (inv: InvitationDto) => {
    revoke.reset();
    sayInRow(null);
    setRevoking(inv);
  };

  const [sendingPending, setSendingPending] = useState(false);
  const sendPending = useMutation({
    mutationFn: () => api.admin.invitations.sendPending(slug),
    onSuccess: (r) => {
      setSendingPending(false);
      say({ text: sendPendingDoneText(r.queued), tone: "info" });
    },
    // The plan stopped sending since the list was loaded (a 409): the question no longer stands, so the sheet closes and
    // the list says why. Anything else stays in the sheet, to try again.
    onError: (err) => {
      if (isOutOfDate(err)) {
        setSendingPending(false);
        say({ text: errorMessage(err), tone: "warning" });
      }
    },
    onSettled: () => refreshInvitations(qc, slug),
  });
  const pendingCopy = s ? sendPendingCopy(s.pending, channels, s.sendableToday) : null;

  const copy = async (inv: InvitationDto) => {
    let copied = false;
    try {
      copied = await Clipboard.setStringAsync(inv.link!);
    } catch {
      // Said below.
    }
    sayInRow({ id: inv.id, text: copied ? "Link copied" : "Couldn't copy the link", tone: copied ? "info" : "warning" });
  };
  const shareOnWhatsApp = (inv: InvitationDto) => {
    Linking.openURL(whatsappUrl(inv.phone, inviteShareText(tenant.name, inv.link!))).catch(() => sayInRow({ id: inv.id, text: "Couldn't open WhatsApp", tone: "warning" }));
  };

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([list.refetch(), summary.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  // A row a refetch took away (revoked under Not sent) has its line at the top instead.
  const inRow = !!rowSaid && list.items.some((inv) => inv.id === rowSaid.id);
  const topLine = said ?? (rowSaid && !inRow ? rowSaid : null);

  const header = (
    <View style={styles.header}>
      {s ? (
        <>
          <StatGrid dense>
            <StatTile dense label="Not sent" value={s.pending} />
            <StatTile dense label="Sent" value={s.sent} />
            <StatTile dense label="Joined" value={s.accepted} />
            <StatTile dense label="Expired" value={s.expired} />
            <StatTile dense label="Can send today" value={channels.length > 0 ? s.sendableToday : null} />
          </StatGrid>
          <Muted size={13}>{channelsSentence(channels)}</Muted>
          {channels.length > 0 && s.pending > 0 && pendingCopy && (
            <Button
              title={pendingCopy.label}
              onPress={() => {
                sendPending.reset();
                setSendingPending(true);
              }}
            />
          )}
        </>
      ) : summary.error ? (
        <>
          <ErrorText error={errorMessage(summary.error)} />
          <Button title="Try again" variant="outline" onPress={() => void summary.refetch()} />
        </>
      ) : (
        <Spinner label="Loading the figures" />
      )}
      <Pressable
        onPress={() => router.push(`/t/${slug}/admin/invitations/import`)}
        accessibilityRole="link"
        accessibilityLabel="Import a list"
        accessibilityHint="A CSV with a phone column"
        style={({ pressed }) => [styles.importRow, pressed ? { opacity: 0.6 } : null]}
      >
        <IconUpload size={18} color={colors.text} />
        <View style={styles.importText}>
          <Text style={styles.importLabel}>Import a list</Text>
          <Text style={styles.importHint}>A CSV with a phone column</Text>
        </View>
        <IconChevronRight size={16} color={colors.faint} />
      </Pressable>
      <StatusLine flush text={topLine?.text ?? null} tone={topLine?.tone} />
      <Tabs tall value={tab} onChange={(next) => navigation.setParams({ status: next === "ALL" ? undefined : next })} tabs={[...INVITATION_TABS]} />
      <SearchField value={q} onChangeText={setQ} label="Search invitations" placeholder="Name, phone or email" maxLength={SEARCH_MAX} />
    </View>
  );

  return (
    <AdminListScreen title="Invitations">
      <FlatList
        data={list.items}
        keyExtractor={(inv) => inv.id}
        // The rows' Send and line follow these as well as the rows.
        extraData={[rowSaid, send.isPending, send.variables?.id, channels.length, list.isPlaceholderData]}
        style={list.isPlaceholderData ? styles.stale : undefined}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        ListHeaderComponent={header}
        ItemSeparatorComponent={Divider}
        renderItem={({ item }) => (
          <InvitationRow
            inv={item}
            channels={channels}
            sending={send.isPending && send.variables?.id === item.id}
            disabled={list.isPlaceholderData}
            notice={inRow && rowSaid.id === item.id ? <StatusLine flush text={rowSaid.text} tone={rowSaid.tone} /> : undefined}
            onCopy={() => void copy(item)}
            onWhatsApp={() => shareOnWhatsApp(item)}
            onSend={() => {
              sayInRow(null);
              send.mutate(item);
            }}
            onRevoke={() => askRevoke(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            {/* An empty search's answer, kept while the next search loads, would name the wrong search. */}
            <ListEmpty loading={list.isLoading || list.isPlaceholderData} error={list.error} onRetry={() => void list.refetch()}>
              {search ? (
                <EmptyState icon={<IconSearch size={32} color={colors.faint} />} title={`No invitations match “${search}”`} description="Search looks at names, phone numbers and email addresses." />
              ) : (
                <EmptyState icon={<IconMail size={32} color={colors.faint} />} title="No invitations here" description="Import a CSV of alumni phone numbers to invite them." />
              )}
            </ListEmpty>
          </View>
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <Spinner label="Loading more invitations" />
          ) : list.items.length > 0 ? (
            <Text style={styles.showing}>
              Showing {formatCount(list.items.length)} of {formatCount(Math.max(list.total, list.items.length))}
            </Text>
          ) : undefined
        }
      />
      {pendingCopy && (
        <ConfirmSheet
          open={sendingPending}
          title={pendingCopy.title}
          body={pendingCopy.body}
          confirmLabel={pendingCopy.confirm}
          busy={sendPending.isPending}
          error={sendPending.error ? errorMessage(sendPending.error) : null}
          onConfirm={() => sendPending.mutate()}
          onCancel={() => setSendingPending(false)}
        />
      )}
      {revoking && (
        <ConfirmSheet
          open
          {...confirmProps(revokeInvitationCopy(revoking))}
          destructive
          busy={revoke.isPending}
          error={revoke.error ? errorMessage(revoke.error) : null}
          onConfirm={() => revoke.mutate(revoking)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </AdminListScreen>
  );
}

const confirmProps = (copy: { title: string; body: string; confirm: string }) => ({ title: copy.title, body: copy.body, confirmLabel: copy.confirm });

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  importRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  importText: { flex: 1, gap: 2 },
  importLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  importHint: { fontSize: 12, color: colors.muted },
  list: { paddingBottom: 48 },
  stale: { opacity: 0.6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  empty: { padding: spacing.lg },
  showing: { textAlign: "center", fontSize: 12, color: colors.muted, padding: spacing.lg },
});
