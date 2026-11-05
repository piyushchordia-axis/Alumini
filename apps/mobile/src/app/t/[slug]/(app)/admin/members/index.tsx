import { MEMBERSHIP_STATUSES, MEMBER_SEARCH_HINT, MEMBER_STATUS_TAB_LABELS, approveAllCopy, formatCount, memberEmptyTitle, memberTabCounts, onlySearchChanged, parseMemberStatus, statusTabs } from "@illuminize/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AdminListScreen } from "@/components/admin/AdminListScreen";
import { AdminMemberRow } from "@/components/admin/AdminMemberRow";
import { SearchField } from "@/components/admin/SearchField";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { IconDirectory, IconSearch } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { Button, EmptyState, ListEmpty, Spinner, Tabs } from "@/components/ui";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { useDebounced } from "@/hooks/useDebounced";
import { useMemberActions, type MemberActionOutcome } from "@/hooks/useMemberActions";
import { useMembership } from "@/hooks/useMembership";
import { usePagedList } from "@/hooks/usePagedList";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

const PAGE_SIZE = 25;

function Divider() {
  return <View style={styles.divider} />;
}

/**
 * The console's members, a tab for each status (?status=, Pending unless given) with the dashboard's counts, a search
 * (?q=), and each member's actions. It scrolls on through the pages where the web console has Previous and Next. Outcomes
 * are said in the line under the toolbar, as the row usually leaves its tab once the list refetches.
 */
export default function AdminMembersScreen() {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; q?: string }>();
  const status = parseMemberStatus(params.status);
  const [q, setQ] = useState(() => (typeof params.q === "string" ? params.q : ""));
  const search = useDebounced(q.trim());
  // In the address too, as the tab is, so a reload on the web build keeps the search.
  useEffect(() => {
    if ((params.q ?? "") !== search) router.setParams({ q: search || undefined });
  }, [params.q, router, search]);

  const dashboard = useAdminDashboard(slug);
  const pending = dashboard.data?.pendingMembers ?? 0;
  const filters = { status, q: search || undefined };
  const key = qk.admin.members(slug, filters);
  // The rows stay while a search is refined, never across tabs: a Pending row's Approve must not show under Rejected.
  const list = usePagedList(key, (page) => api.admin.members.list(slug, { ...filters, page, pageSize: PAGE_SIZE }), { keepPreviousWhile: (previous) => onlySearchChanged(previous, key) });
  const [said, say] = useStatus<MemberActionOutcome>();
  const actions = useMemberActions(slug, say);

  const [approvingAll, setApprovingAll] = useState(false);
  const allCopy = approveAllCopy(pending);
  const closeApproveAll = () => {
    setApprovingAll(false);
    actions.approveAll.reset();
  };

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([list.refetch(), dashboard.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AdminListScreen title="Members">
      <View style={styles.toolbar}>
        <Tabs tall value={status} onChange={(next) => router.setParams({ status: next === "PENDING" ? undefined : next })} tabs={statusTabs(MEMBERSHIP_STATUSES, MEMBER_STATUS_TAB_LABELS, memberTabCounts(dashboard.data))} />
        <SearchField value={q} onChangeText={setQ} label="Search members" placeholder="Search name, company or phone" />
        {status === "PENDING" && pending > 0 && (
          <View style={styles.approveAll}>
            <Text style={styles.waiting}>{formatCount(pending)} waiting</Text>
            <Button
              size="compact"
              variant="outline"
              title="Approve all"
              accessibilityLabel="Approve all pending members"
              onPress={() => {
                actions.approveAll.reset();
                setApprovingAll(true);
              }}
            />
          </View>
        )}
      </View>
      <StatusLine text={said?.text ?? null} tone={said?.tone} />
      <View role="tabpanel" aria-label={MEMBER_STATUS_TAB_LABELS[status]} style={styles.panel}>
        <FlatList
          // A new tab starts at its top.
          key={status}
          data={list.items}
          keyExtractor={(m) => m.id}
          style={list.isPlaceholderData ? styles.stale : undefined}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.5}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          ItemSeparatorComponent={Divider}
          renderItem={({ item }) => <AdminMemberRow member={item} actions={actions} you={item.id === membership.id} disabled={list.isPlaceholderData} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              {/* An empty search's answer, kept while the next search loads, would name the wrong search. */}
              <ListEmpty loading={list.isLoading || list.isPlaceholderData} error={list.error} onRetry={() => void list.refetch()}>
                <EmptyState icon={search ? <IconSearch size={32} color={colors.faint} /> : <IconDirectory size={32} color={colors.faint} />} title={memberEmptyTitle(status, search)} description={search ? MEMBER_SEARCH_HINT : undefined} />
              </ListEmpty>
            </View>
          }
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <Spinner label="Loading more members" />
            ) : list.items.length > 0 ? (
              <Text style={styles.showing}>
                Showing {formatCount(list.items.length)} of {formatCount(Math.max(list.total, list.items.length))}
              </Text>
            ) : undefined
          }
        />
      </View>
      <ConfirmSheet
        open={approvingAll}
        title={allCopy.title}
        body={allCopy.body}
        confirmLabel={allCopy.confirm}
        busy={actions.approveAll.isPending}
        error={actions.approveAll.error}
        onConfirm={() => actions.approveAll.mutate(undefined, { onSuccess: closeApproveAll })}
        onCancel={closeApproveAll}
      />
    </AdminListScreen>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  approveAll: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  waiting: { flex: 1, fontSize: 13, color: colors.muted },
  panel: { flex: 1 },
  list: { paddingBottom: 48 },
  stale: { opacity: 0.6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  empty: { padding: spacing.lg },
  showing: { textAlign: "center", fontSize: 12, color: colors.muted, padding: spacing.lg },
});
