import { AUDIT_ACTION_FILTERS, AUDIT_ACTION_MAX, AUDIT_LOG_INTRO, auditEmptyTitle, formatCount, parseAuditAction } from "@illuminize/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AdminListScreen } from "@/components/admin/AdminListScreen";
import { AuditRow } from "@/components/admin/AuditRow";
import { SearchField } from "@/components/admin/SearchField";
import { IconAudit } from "@/components/icons";
import { ChipSelect, EmptyState, ListEmpty, Muted, Spinner } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useMembership } from "@/hooks/useMembership";
import { usePagedList } from "@/hooks/usePagedList";
import { adminMemberHref } from "@/lib/admin";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

const PAGE_SIZE = 50;

const CHIPS = AUDIT_ACTION_FILTERS.map((f) => ({ value: f.prefix, label: f.label }));

function Divider() {
  return <View style={styles.divider} />;
}

/**
 * Every admin and member action at the institution, newest first (the web console's audit log), scrolling on through
 * the pages. A chip picks a family of actions by writing its prefix into the field below, where any other prefix can be
 * typed (which leaves no chip chosen); the filter waits until typing stops and is kept in the address as ?action=. A
 * row about a member opens their page.
 */
export default function AdminAuditScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const params = useLocalSearchParams<{ action?: string }>();
  const [action, setAction] = useState(() => parseAuditAction(params.action));
  const filter = useDebounced(action.trim());
  useEffect(() => {
    if (parseAuditAction(params.action) !== filter) router.setParams({ action: filter || undefined });
  }, [params.action, router, filter]);

  const filters = { action: filter || undefined };
  // The rows have nothing to press, so a filter's rows may stand, faded, while the next filter's load.
  const list = usePagedList(qk.admin.audit(slug, filters), (page) => api.admin.audit.list(slug, { ...filters, page, pageSize: PAGE_SIZE }), { keepPreviousWhile: () => true });

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await list.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AdminListScreen title="Audit log">
      <View style={styles.toolbar}>
        <Muted size={13}>{AUDIT_LOG_INTRO}</Muted>
        <ChipSelect options={CHIPS} value={action.trim()} onChange={setAction} allowEmpty emptyLabel="All" tall />
        <SearchField value={action} onChangeText={setAction} label="Filter by action" placeholder="Action starts with…" maxLength={AUDIT_ACTION_MAX} />
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(a) => a.id}
        style={list.isPlaceholderData ? styles.stale : undefined}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        ItemSeparatorComponent={Divider}
        renderItem={({ item }) => <AuditRow entry={item} onOpenMember={(id) => router.push(adminMemberHref(slug, id))} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            {/* An empty filter's answer, kept while the next one loads, would name the wrong filter. */}
            <ListEmpty loading={list.isLoading || list.isPlaceholderData} error={list.error} onRetry={() => void list.refetch()}>
              <EmptyState icon={<IconAudit size={32} color={colors.faint} />} title={auditEmptyTitle(filter)} />
            </ListEmpty>
          </View>
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <Spinner label="Loading more activity" />
          ) : list.items.length > 0 ? (
            <Text style={styles.showing}>
              Showing {formatCount(list.items.length)} of {formatCount(Math.max(list.total, list.items.length))}
            </Text>
          ) : undefined
        }
      />
    </AdminListScreen>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  list: { paddingBottom: 48 },
  stale: { opacity: 0.6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  empty: { padding: spacing.lg },
  showing: { textAlign: "center", fontSize: 12, color: colors.muted, padding: spacing.lg },
});
