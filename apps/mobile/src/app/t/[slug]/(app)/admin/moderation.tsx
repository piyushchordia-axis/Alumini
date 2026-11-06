import {
  ADMIN_REASON_PROMPTS,
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  MODERATION_EMPTY_TITLE,
  MODERATION_STATUSES,
  MODERATION_STATUS_LABELS,
  MODERATION_SUBTITLE,
  formatCount,
  itemFurtherText,
  itemGoneText,
  linkedRowStep,
  moderationEmptyText,
  moderationItemKey,
  parseContentType,
  parseItemId,
  parseModerationStatus,
  queueTabCounts,
  statusTabs,
  type ContentType,
  type LinkedRowStep,
  type ModerationItemDto,
  type ModerationStatus,
  type TenantFeatures,
} from "@illuminize/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AdminListScreen } from "@/components/admin/AdminListScreen";
import { ModerationRow } from "@/components/admin/ModerationRow";
import { QueueToolbar } from "@/components/admin/QueueToolbar";
import { ReasonSheet } from "@/components/admin/ReasonSheet";
import { IconCheck } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { ChipSelect, EmptyState, ListEmpty, Spinner } from "@/components/ui";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { useMembership } from "@/hooks/useMembership";
import { useModerationActions, type QueueOutcome } from "@/hooks/useModerationActions";
import { usePagedList } from "@/hooks/usePagedList";
import { useReasonSheet } from "@/hooks/useReasonSheet";
import { useScrollToRow } from "@/hooks/useScrollToRow";
import { useStatus, type RowStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

const PAGE_SIZE = 20;
const TYPE_OPTIONS = CONTENT_TYPES.map((t) => ({ value: t, label: CONTENT_TYPE_LABELS[t] }));

function Gap() {
  return <View style={styles.gap} />;
}

/**
 * The console's moderation queue: a tab for each status (?status=, Awaiting approval unless given) with the dashboard's
 * count of what waits, a type filter (?type=), and each item with its preview and actions. It scrolls on through the
 * pages where the web console has Previous and Next. A link can name an item (?item=, from a notice), which opens
 * once the list fetched for this visit holds it, page after page (linkedRowStep). Outcomes that take a row off its tab
 * are said in the line under the filters.
 */
export default function AdminModerationScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; type?: string; item?: string }>();
  const status = parseModerationStatus(params.status);
  const contentType = parseContentType(params.type);
  const itemId = parseItemId(params.item);
  const dashboard = useAdminDashboard(slug);
  const [said, say] = useStatus<QueueOutcome>();
  return (
    <AdminListScreen title="Moderation">
      {/* A filter changes the address in place (setParams), so Back leaves the queue rather than stepping through filters. */}
      <QueueToolbar
        value={status}
        onChange={(next) => router.setParams({ status: next === "PENDING" ? undefined : next, item: undefined })}
        tabs={statusTabs(MODERATION_STATUSES, MODERATION_STATUS_LABELS, queueTabCounts(dashboard.data)?.moderation)}
      >
        <ChipSelect label="Content type" options={TYPE_OPTIONS} value={contentType ?? ""} onChange={(next) => router.setParams({ type: next || undefined, item: undefined })} allowEmpty emptyLabel="All types" tall />
      </QueueToolbar>
      <StatusLine text={said?.text ?? null} tone={said?.tone} />
      {/* Keyed: a new tab or filter starts with nothing open, no row's line and no sheet, so nothing of one tab acts on another's rows. */}
      <ModerationQueue
        key={`${status}:${contentType ?? ""}:${itemId ?? ""}`}
        slug={slug}
        status={status}
        contentType={contentType}
        itemId={itemId}
        features={tenant.settings.features}
        say={say}
        refreshCounts={() => dashboard.refetch()}
      />
    </AdminListScreen>
  );
}

function ModerationQueue({
  slug,
  status,
  contentType,
  itemId,
  features,
  say,
  refreshCounts,
}: {
  slug: string;
  status: ModerationStatus;
  contentType: ContentType | undefined;
  itemId: string | undefined;
  features: TenantFeatures;
  say: (outcome: QueueOutcome) => void;
  refreshCounts: () => Promise<unknown>;
}) {
  const filters = { status, contentType };
  // No rows kept from another key: a row's buttons act for the tab it was listed under. Fetched afresh for a link's item,
  // as rows cached from a visit moments ago may be from before the notice.
  const list = usePagedList(qk.admin.moderation(slug, filters), (page) => api.admin.moderation.list(slug, { ...filters, page, pageSize: PAGE_SIZE }), { refetchOnMount: itemId ? "always" : true });
  const [rowSaid, sayRow] = useStatus<RowStatus>();
  const actions = useModerationActions(slug, { say, sayRow });
  const sheet = useReasonSheet<ModerationItemDto, "reject" | "remove">();
  const listRef = useRef<FlatList<ModerationItemDto>>(null);
  const scroll = useScrollToRow(listRef, list.items, moderationItemKey);

  // Open or closed by the admin's own taps, by row: the screen's, as the list drops rows scrolled far away.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  // The row a link asked for, looked for in an answer fetched for this visit, page after page until it's found (or the
  // pages run out), then decided once: acting on it later doesn't say it went.
  const [linked, setLinked] = useState<{ key: string | null; step: LinkedRowStep } | null>(null);
  const linkedRow = itemId ? list.items.find((i) => i.id === itemId) : undefined;
  const lookup = itemId && !linked ? linkedRowStep({ isSuccess: list.isSuccess, isFetchedAfterMount: list.isFetchedAfterMount, isFetching: list.isFetching, hasNextPage: list.hasNextPage, pages: list.data?.pages.length ?? 0 }, !!linkedRow) : "wait";
  if (lookup === "found" || lookup === "gone" || lookup === "further") setLinked({ key: linkedRow ? moderationItemKey(linkedRow) : null, step: lookup });
  const loadMore = useEffectEvent(() => list.loadMore());
  useEffect(() => {
    if (lookup === "more") loadMore();
  }, [lookup]);
  const onLinked = useEffectEvent(({ key, step }: { key: string | null; step: LinkedRowStep }) => {
    if (key) scroll.reveal(key);
    else say({ text: step === "further" ? itemFurtherText("moderation") : itemGoneText("moderation"), tone: "warning" });
  });
  useEffect(() => {
    if (linked) onLinked(linked);
  }, [linked]);
  const isExpanded = (key: string) => toggled.get(key) ?? key === linked?.key;
  const setExpanded = (key: string, open: boolean) => setToggled((prev) => new Map(prev).set(key, open));

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
    <View role="tabpanel" aria-label={MODERATION_STATUS_LABELS[status]} style={styles.panel}>
      <FlatList
        ref={listRef}
        data={list.items}
        keyExtractor={moderationItemKey}
        contentContainerStyle={styles.list}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        onScrollToIndexFailed={scroll.onScrollToIndexFailed}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={<Text style={styles.subtitle}>{MODERATION_SUBTITLE}</Text>}
        renderItem={({ item }) => {
          const key = moderationItemKey(item);
          return (
            <ModerationRow
              slug={slug}
              item={item}
              features={features}
              expanded={isExpanded(key)}
              status={rowSaid?.id === key ? rowSaid : null}
              actions={actions}
              onToggle={(open) => setExpanded(key, open)}
              onAsk={(which) => sheet.ask({ prompt: which, rowKey: key, row: item })}
              onReveal={() => scroll.reveal(key)}
            />
          );
        }}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon={<IconCheck size={32} color={colors.faint} />} title={MODERATION_EMPTY_TITLE} description={moderationEmptyText(status)} />
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
          onConfirm={(note) => actions.run(asking.prompt, asking.row, note)}
          // Another admin acted first, or it's gone: the sheet closes, and the line says so over the refreshed list.
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
