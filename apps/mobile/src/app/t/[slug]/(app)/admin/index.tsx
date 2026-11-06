import { ADMIN_SECTIONS, approvalSummary, dashboardTiles, type DashboardTile } from "@illuminize/shared";
import { fatalQueryError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { StatGrid, StatTile } from "@/components/admin/StatTile";
import { HubRow } from "@/components/HubRow";
import { IconChevronRight } from "@/components/icons";
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
    const section = t.section;
    return <StatTile key={t.key} label={t.label} value={t.value} hint={t.hint} attention={t.attention} onPress={section ? () => router.push(adminSectionHref(slug, section, t.query)) : undefined} />;
  };
  // The Dashboard is this screen.
  const sections = ADMIN_SECTIONS.filter((s) => s.key !== "dashboard");
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
          {/* The figures over time, as the web Dashboard links to them. */}
          <ConsoleLink label="Growth and activity charts" onPress={() => router.push(adminSectionHref(slug, "analytics"))} />
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
        {/* Where the approval modes change, as the web Dashboard's card links. */}
        <ConsoleLink label="Settings" onPress={() => router.push(adminSectionHref(slug, "settings"))} />
      </Card>
      <Text {...headingRole(2)} style={styles.heading}>
        Sections
      </Text>
      <Card>
        <View role="navigation" aria-label="Admin sections">
          {sections.map((s) => {
            const count = s.countKey ? (dashboard.data?.[s.countKey] ?? 0) : 0;
            return <HubRow key={s.key} icon={s.icon} label={s.label} dense count={count} countTone="warning" countLabel={`${s.label}, ${count} waiting`} onPress={() => router.push(adminSectionHref(slug, s.key))} />;
          })}
        </View>
      </Card>
    </AdminScreen>
  );
}

/** A 44-point text link to another part of the console, in the institution's colour. */
function ConsoleLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={label} style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={[styles.linkText, { color: theme.primaryInk }]}>{label}</Text>
      <IconChevronRight size={16} color={theme.primaryInk} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: spacing.xs },
  sentence: { fontSize: 14, lineHeight: 20, color: colors.muted },
  strong: { fontWeight: "700", color: colors.text },
  link: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, minHeight: 44 },
  linkText: { fontSize: 14, fontWeight: "600" },
});
