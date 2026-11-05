import { ADMIN_SECTIONS, MOBILE_ADMIN_SECTIONS, approvalSummary, dashboardTiles, type DashboardTile } from "@illuminize/shared";
import { fatalQueryError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { StatGrid, StatTile } from "@/components/admin/StatTile";
import { HubRow } from "@/components/HubRow";
import { NavIcon } from "@/components/icons";
import { Button, Card, ErrorText, Muted, Spinner, headingRole } from "@/components/ui";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { useMembership } from "@/hooks/useMembership";
import { adminSectionHref } from "@/lib/admin";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

/** The admin console's home: the web console's Dashboard, and its sections. Its counts are polled by the console's layout. */
export default function AdminHomeScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const qc = useQueryClient();
  const theme = useTheme();
  const dashboard = useAdminDashboard(slug);
  const error = fatalQueryError(dashboard);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      // The institution holds the approval mode, and the membership whether this is still an admin.
      await Promise.all([dashboard.refetch(), qc.invalidateQueries({ queryKey: qk.tenant(slug) }), qc.invalidateQueries({ queryKey: qk.membership(slug), exact: true })]);
    } finally {
      setRefreshing(false);
    }
  };
  const tiles = dashboard.data ? dashboardTiles(dashboard.data) : null;
  const tile = (t: DashboardTile) => {
    const href = t.section ? adminSectionHref(slug, t.section, t.query) : null;
    return <StatTile key={t.key} label={t.label} value={t.value} hint={t.hint} attention={t.attention} onPress={href ? () => router.push(href) : undefined} />;
  };
  // The Dashboard is this screen.
  const sections = ADMIN_SECTIONS.filter((s) => s.key !== "dashboard");
  const onPhone = sections.filter((s) => MOBILE_ADMIN_SECTIONS.includes(s.key));
  const onWeb = sections.filter((s) => !MOBILE_ADMIN_SECTIONS.includes(s.key));
  return (
    <AdminScreen title={tenant.shortName ?? tenant.name} home refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primary} colors={[theme.primary]} />}>
      <Muted size={13}>Admin console for {tenant.name}</Muted>
      {tiles ? (
        <>
          <Text {...headingRole(2)} style={styles.heading}>
            Needs you
          </Text>
          <StatGrid>{tiles.needs.map(tile)}</StatGrid>
          <Text {...headingRole(2)} style={styles.heading}>
            At a glance
          </Text>
          <StatGrid>{tiles.glance.map(tile)}</StatGrid>
        </>
      ) : error ? (
        <>
          <ErrorText error={error} />
          <Button title="Try again" variant="outline" onPress={() => void dashboard.refetch()} />
        </>
      ) : (
        <Spinner label="Loading the dashboard" />
      )}
      <Card>
        <Text style={styles.sentence}>
          {approvalSummary(tenant.settings).map((part, i) => (
            <Text key={i} style={part.strong ? styles.strong : undefined}>
              {part.text}
            </Text>
          ))}
        </Text>
      </Card>
      <Text {...headingRole(2)} style={styles.heading}>
        Sections
      </Text>
      <Card>
        {onPhone.length > 0 && (
          <View role="navigation" aria-label="Admin sections">
            {onPhone.map((s) => {
              const href = adminSectionHref(slug, s.key);
              const count = s.countKey ? (dashboard.data?.[s.countKey] ?? 0) : 0;
              return href && <HubRow key={s.key} icon={s.icon} label={s.label} dense count={count} countTone="warning" countLabel={`${s.label}, ${count} waiting`} onPress={() => router.push(href)} />;
            })}
          </View>
        )}
        {onWeb.length > 0 && (
          <View style={{ gap: spacing.xs }}>
            <Muted size={13}>On the web console for now:</Muted>
            <View role="list">
              {onWeb.map((s) => (
                <View key={s.key} role="listitem" style={styles.webRow}>
                  <NavIcon name={s.icon} size={18} color={colors.muted} />
                  <Text style={styles.webLabel}>{s.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </Card>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: spacing.xs },
  sentence: { fontSize: 14, lineHeight: 20, color: colors.muted },
  strong: { fontWeight: "700", color: colors.text },
  webRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 32 },
  webLabel: { fontSize: 14, color: colors.muted },
});
