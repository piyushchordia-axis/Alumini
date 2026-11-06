import {
  CHAT_REPORTS_SUBTITLE,
  CHAT_REPORT_LINK_MISSING_TEXT,
  CHAT_REPORT_PRIVACY_TEXT,
  REPORT_STATUS_LABELS,
  chatReportCloseRequest,
  chatReportDoneText,
  chatReportEmptyTitle,
  chatReportLinkStep,
  chatReportNotDoneText,
  chatReportPrompt,
  chatReportTabs,
  formatCount,
  parseChatReportItem,
  parseChatReportStatus,
  type AdminChatReportDto,
  type ChatReportCloseAction,
  type ReportStatus,
} from "@illuminize/shared";
import { errorMessage, isOutOfDate, type ApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AdminListScreen } from "@/components/admin/AdminListScreen";
import { ChatReportRow } from "@/components/admin/ChatReportRow";
import { ReasonSheet } from "@/components/admin/ReasonSheet";
import { IconCheck } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { EmptyState, ListEmpty, Spinner, Tabs } from "@/components/ui";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { useChatReportView } from "@/hooks/useChatReportView";
import { useMembership } from "@/hooks/useMembership";
import { usePagedList } from "@/hooks/usePagedList";
import { useStatus } from "@/hooks/useStatus";
import { adminMemberHref } from "@/lib/admin";
import { api } from "@/lib/api";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

const PAGE_SIZE = 20;
const SCROLL_RETRIES = 5;

interface Said {
  text: string;
  tone: "info" | "warning";
}

/** The note sheet: which way of closing which report, and whether it shows (Cancel hides it, keeping the note). */
interface Asking {
  action: ChatReportCloseAction;
  report: AdminChatReportDto;
  open: boolean;
}

function Gap() {
  return <View style={styles.gap} />;
}

/**
 * The console's chat reports: a tab for each status (?status=, Open unless given) with the dashboard's count of those
 * open, and each report with who reported whom and why, never the words until the admin opens it (useChatReportView).
 * A link can name a report (?item=, from a notice or a push), which is scrolled to and never opened, as opening writes
 * an audit row. No feature gate: an admin may have switched Messages off over the very incident they're handling.
 */
export default function AdminChatReportsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; item?: string }>();
  const status = parseChatReportStatus(params.status);
  const itemId = parseChatReportItem(params.item);
  const dashboard = useAdminDashboard(slug);
  const [said, say] = useStatus<Said>();
  return (
    <AdminListScreen title="Chat reports">
      <View style={styles.toolbar}>
        <Tabs tall value={status} onChange={(next) => router.setParams({ status: next === "OPEN" ? undefined : next, item: undefined })} tabs={chatReportTabs(dashboard.data)} />
      </View>
      <StatusLine text={said?.text ?? null} tone={said?.tone} />
      {/* Keyed: a new tab is a new list, so what one tab opened (its words, a sheet and its note) goes with it. */}
      <ChatReportsQueue key={`${status}:${itemId ?? ""}`} slug={slug} status={status} itemId={itemId} say={say} refreshCounts={() => dashboard.refetch()} />
    </AdminListScreen>
  );
}

function ChatReportsQueue({ slug, status, itemId, say, refreshCounts }: { slug: string; status: ReportStatus; itemId: string | undefined; say: (said: Said) => void; refreshCounts: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const router = useRouter();
  // The rows carry nobody's words, so the list may be cached like any other.
  const list = usePagedList(qk.admin.chatReports(slug, { status }), (page) => api.admin.chatReports.list(slug, { status, page, pageSize: PAGE_SIZE }));
  const listed = useMemo(() => (list.isSuccess ? new Set(list.items.map((r) => r.id)) : undefined), [list.isSuccess, list.items]);
  // Handled by another admin, gone, or no longer this admin's: the list is out of date, so it's fetched again.
  const outOfDate = (err: ApiClientError) => {
    say({ text: err.message, tone: "warning" });
    void invalidateTenant(qc, slug);
  };
  const viewer = useChatReportView(slug, { listed, onOutOfDate: outOfDate });

  // The screen's one note sheet, for the open report. It goes when that report closes, and the note typed in it with
  // it, as a note may quote the message; while the report stays open, Cancel keeps the note for the next try.
  const [asking, setAsking] = useState<Asking | null>(null);
  if (asking && viewer.shown?.reportId !== asking.report.id) setAsking(null);
  // The sheet that is mounted, for a call that ends after its sheet went: none once this list is gone (a tab change).
  const mounted = useRef<Asking | null>(null);
  useEffect(() => {
    mounted.current = asking;
    return () => {
      mounted.current = null;
    };
  }, [asking]);
  // Called straight, not through useMutation, which would keep the note in its cache. The sheet says why a call failed,
  // but if it went meanwhile (the report closed, as when the app went to the background), the screen says it instead, so
  // the admin doesn't take the report as closed. An out-of-date answer is said either way, through the sheet's onOutOfDate.
  const closeReport = async (from: Asking, note: string) => {
    const { action, report } = from;
    const request = chatReportCloseRequest(action, note);
    try {
      await (request.call === "resolve" ? api.admin.chatReports.resolve(slug, report.id, request.input) : api.admin.chatReports.dismiss(slug, report.id, request.note));
    } catch (err) {
      if (!isOutOfDate(err) && mounted.current !== from) say({ text: chatReportNotDoneText(action, errorMessage(err)), tone: "warning" });
      throw err;
    }
    viewer.close();
    say({ text: chatReportDoneText(action), tone: "info" });
    void invalidateTenant(qc, slug);
  };

  const listRef = useRef<FlatList<AdminChatReportDto>>(null);
  const retries = useRef(0);
  const reveal = (id: string) => {
    const index = list.items.findIndex((r) => r.id === id);
    if (index < 0) return;
    retries.current = 0;
    listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
  };
  // A row that hasn't been drawn and measured can't be scrolled to: go to where the rows' average height puts it, which
  // draws the rows there, and try again once they have been measured, a few times at most.
  const onScrollToIndexFailed = ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
    listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
    if (retries.current >= SCROLL_RETRIES) return;
    retries.current += 1;
    setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true }), 150);
  };

  // A report's words open below its headline and can reach past the foot of the screen, so once they arrive the row's
  // top is scrolled up into view.
  const shownId = viewer.shown?.reportId;
  const onShown = useEffectEvent((id: string) => reveal(id));
  useEffect(() => {
    if (shownId) onShown(shownId);
  }, [shownId]);

  // The report a link named, looked for page after page in answers that aren't being fetched again, then decided once.
  const [linked, setLinked] = useState<"found" | "missing" | null>(null);
  const found = !!itemId && list.items.some((r) => r.id === itemId);
  const lookup = itemId && !linked ? chatReportLinkStep({ isSuccess: list.isSuccess, isFetching: list.isFetching, hasNextPage: list.hasNextPage, pages: list.data?.pages.length ?? 0 }, found) : "wait";
  if (lookup === "found" || lookup === "missing") setLinked(lookup);
  const loadMore = useEffectEvent(() => list.loadMore());
  useEffect(() => {
    if (lookup === "more") loadMore();
  }, [lookup]);
  const onLinked = useEffectEvent((step: "found" | "missing") => {
    if (step === "found" && itemId) reveal(itemId);
    else say({ text: CHAT_REPORT_LINK_MISSING_TEXT, tone: "warning" });
  });
  useEffect(() => {
    if (linked) onLinked(linked);
  }, [linked]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([list.refetch(), refreshCounts()]);
    } finally {
      setRefreshing(false);
    }
  };

  const prompt = asking ? chatReportPrompt(asking.action, asking.report.targetKind) : null;
  return (
    <View role="tabpanel" aria-label={REPORT_STATUS_LABELS[status]} style={styles.panel}>
      <FlatList
        ref={listRef}
        data={list.items}
        extraData={viewer}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        onScrollToIndexFailed={onScrollToIndexFailed}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.subtitle}>{CHAT_REPORTS_SUBTITLE}</Text>
            <Text style={styles.privacy}>{CHAT_REPORT_PRIVACY_TEXT}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ChatReportRow
            report={item}
            view={viewer.shown?.reportId === item.id ? viewer.shown.view : null}
            opening={viewer.openingId === item.id}
            problem={viewer.problem?.reportId === item.id ? viewer.problem.text : null}
            onView={() => void viewer.open(item.id)}
            onHide={viewer.close}
            onAsk={(action) => setAsking({ action, report: item, open: true })}
            // A push within the console, whose Back returns here, the words already gone (the screen lost focus).
            onOpenMember={(membershipId) => router.push(adminMemberHref(slug, membershipId))}
          />
        )}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon={<IconCheck size={32} color={colors.faint} />} title={chatReportEmptyTitle(status)} />
          </ListEmpty>
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <Spinner label="Loading more" />
          ) : list.items.length > 0 ? (
            <Text style={styles.showing}>
              Showing {formatCount(list.items.length)} of {formatCount(Math.max(list.total, list.items.length))}
            </Text>
          ) : undefined
        }
      />
      {asking && prompt && (
        <ReasonSheet
          // A sheet of its own for each report and action, so a note typed for one never shows on another.
          key={`${asking.action}:${asking.report.id}`}
          open={asking.open}
          title={prompt.title}
          body={prompt.body}
          confirmLabel={prompt.confirm}
          tone={prompt.tone}
          onConfirm={(note) => closeReport(asking, note)}
          onOutOfDate={(err) => {
            viewer.close();
            outOfDate(err);
          }}
          onClose={() => setAsking((a) => (a ? { ...a, open: false } : a))}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  panel: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 48 },
  header: { gap: 4, paddingBottom: spacing.sm },
  subtitle: { fontSize: 13, color: colors.muted },
  privacy: { fontSize: 12, color: colors.muted },
  gap: { height: spacing.sm },
  showing: { textAlign: "center", fontSize: 12, color: colors.muted, padding: spacing.lg },
});
