import {
  ADMIN_REASON_PROMPTS,
  REPORTS_SUBTITLE,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  formatCount,
  itemFurtherText,
  itemGoneText,
  linkedRowStep,
  parseItemId,
  parseReportStatus,
  queueTabCounts,
  reportEmptyTitle,
  statusTabs,
  type AdminReportDto,
  type LinkedRowStep,
  type ReportStatus,
} from "@illuminize/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AdminListScreen } from "@/components/admin/AdminListScreen";
import { QueueToolbar } from "@/components/admin/QueueToolbar";
import { ReasonSheet } from "@/components/admin/ReasonSheet";
import { ReportRow, type ReportPrompt } from "@/components/admin/ReportRow";
import { IconCheck } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { EmptyState, ListEmpty, Spinner } from "@/components/ui";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { useMembership } from "@/hooks/useMembership";
import type { QueueOutcome } from "@/hooks/useModerationActions";
import { usePagedList } from "@/hooks/usePagedList";
import { useReasonSheet } from "@/hooks/useReasonSheet";
import { useScrollToRow } from "@/hooks/useScrollToRow";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

const PAGE_SIZE = 20;
const reportKey = (r: AdminReportDto) => r.id;

function Gap() {
  return <View style={styles.gap} />;
}

/**
 * The console's reports of content: a tab for each status (?status=, Open unless given) with the dashboard's count of
 * those open, and each report with the content's words. Remove content, Resolve and Dismiss each ask for a note, then
 * the report leaves the Open tab, said in the line under the tabs. A link can name a report (?item=, from a notice),
 * which is scrolled to once the list fetched for this visit holds it, page after page (linkedRowStep).
 */
export default function AdminReportsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; item?: string }>();
  const status = parseReportStatus(params.status);
  const itemId = parseItemId(params.item);
  const dashboard = useAdminDashboard(slug);
  const [said, say] = useStatus<QueueOutcome>();
  return (
    <AdminListScreen title="Reports">
      <QueueToolbar value={status} onChange={(next) => router.setParams({ status: next === "OPEN" ? undefined : next, item: undefined })} tabs={statusTabs(REPORT_STATUSES, REPORT_STATUS_LABELS, queueTabCounts(dashboard.data)?.reports)} />
      <StatusLine text={said?.text ?? null} tone={said?.tone} />
      {/* Keyed: a new tab starts with no sheet open, so nothing of one tab acts on another's rows. */}
      <ReportsQueue key={`${status}:${itemId ?? ""}`} slug={slug} status={status} itemId={itemId} say={say} refreshCounts={() => dashboard.refetch()} />
    </AdminListScreen>
  );
}

function ReportsQueue({ slug, status, itemId, say, refreshCounts }: { slug: string; status: ReportStatus; itemId: string | undefined; say: (outcome: QueueOutcome) => void; refreshCounts: () => Promise<unknown> }) {
  const qc = useQueryClient();
  // Fetched afresh for a link's report, as rows cached from a visit moments ago may be from before the notice.
  const list = usePagedList(qk.admin.reports(slug, { status }), (page) => api.admin.reports.list(slug, { status, page, pageSize: PAGE_SIZE }), { refetchOnMount: itemId ? "always" : true });
  const sheet = useReasonSheet<AdminReportDto, ReportPrompt>();
  const listRef = useRef<FlatList<AdminReportDto>>(null);
  const scroll = useScrollToRow(listRef, list.items, reportKey);
  const close = useMutation({
    mutationFn: ({ prompt, report, note }: { prompt: ReportPrompt; report: AdminReportDto; note: string }) =>
      prompt === "reportDismiss" ? api.admin.reports.dismiss(slug, report.id, note || null) : api.admin.reports.resolve(slug, report.id, { action: prompt === "reportRemove" ? "REMOVE_CONTENT" : "NONE", note: note || null }),
    onSuccess: (_r, { prompt }) => say({ text: prompt === "reportDismiss" ? "Report dismissed" : "Report resolved", tone: "info" }),
    // A refusal refreshes too: it usually means the list was out of date (another admin handled it).
    onSettled: () => void invalidateTenant(qc, slug),
  });

  // The report a link asked for, looked for in an answer fetched for this visit, page after page until it's found (or
  // the pages run out), then decided once.
  const [linked, setLinked] = useState<{ key: string | null; step: LinkedRowStep } | null>(null);
  const found = !!itemId && list.items.some((r) => r.id === itemId);
  const lookup = itemId && !linked ? linkedRowStep({ isSuccess: list.isSuccess, isFetchedAfterMount: list.isFetchedAfterMount, isFetching: list.isFetching, hasNextPage: list.hasNextPage, pages: list.data?.pages.length ?? 0 }, found) : "wait";
  if (lookup === "found" || lookup === "gone" || lookup === "further") setLinked({ key: found ? (itemId ?? null) : null, step: lookup });
  const loadMore = useEffectEvent(() => list.loadMore());
  useEffect(() => {
    if (lookup === "more") loadMore();
  }, [lookup]);
  const onLinked = useEffectEvent(({ key, step }: { key: string | null; step: LinkedRowStep }) => {
    if (key) scroll.reveal(key);
    else say({ text: step === "further" ? itemFurtherText("reports") : itemGoneText("reports"), tone: "warning" });
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

  const asking = sheet.target;
  const prompt = asking ? ADMIN_REASON_PROMPTS[asking.prompt] : null;
  return (
    <View role="tabpanel" aria-label={REPORT_STATUS_LABELS[status]} style={styles.panel}>
      <FlatList
        ref={listRef}
        data={list.items}
        keyExtractor={reportKey}
        contentContainerStyle={styles.list}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        onScrollToIndexFailed={scroll.onScrollToIndexFailed}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={<Text style={styles.subtitle}>{REPORTS_SUBTITLE}</Text>}
        renderItem={({ item }) => <ReportRow report={item} onAsk={(which) => sheet.ask({ prompt: which, rowKey: item.id, row: item })} />}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon={<IconCheck size={32} color={colors.faint} />} title={reportEmptyTitle(status)} />
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
          open={sheet.open}
          title={prompt.title}
          body={prompt.body}
          confirmLabel={prompt.confirm}
          tone={prompt.tone}
          text={sheet.text}
          onTextChange={sheet.setText}
          onConfirm={(note) => close.mutateAsync({ prompt: asking.prompt, report: asking.row, note })}
          // Already handled by another admin, or gone: the sheet closes, and the line says so over the refreshed list.
          onOutOfDate={(err) => say({ text: err.message, tone: "warning" })}
          onClose={sheet.close}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 48 },
  subtitle: { fontSize: 13, color: colors.muted, paddingBottom: spacing.sm },
  gap: { height: spacing.sm },
  showing: { textAlign: "center", fontSize: 12, color: colors.muted, padding: spacing.lg },
});
