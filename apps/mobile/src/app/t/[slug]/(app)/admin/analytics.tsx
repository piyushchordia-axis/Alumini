import { ANALYTICS_RANGES, analyticsView, analyticsWeeks, kpiTiles, type AnalyticsChart, type TenantAnalyticsDto, type TenantFeatures } from "@illuminize/shared";
import { fatalQueryError } from "@illuminize/shared/client";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, RefreshControl, StyleSheet, Text, View } from "react-native";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { ExportButtons } from "@/components/admin/ExportButton";
import { StatGrid } from "@/components/admin/StatTile";
import { ChartCard, ColumnChart, HBarChart, Kpi, LineChart } from "@/components/charts";
import { Button, ChipSelect, ErrorText, Muted, Spinner, headingRole } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

const RANGE_OPTIONS = ANALYTICS_RANGES.map((r) => ({ value: String(r.weeks), label: r.label }));

const UPDATING = "Updating…";

function Chart({ chart }: { chart: AnalyticsChart }) {
  switch (chart.kind) {
    case "column":
      return <ColumnChart labels={chart.labels} titles={chart.titles} values={chart.values} unit={chart.unit} ariaLabel={chart.ariaLabel} />;
    case "line":
      return <LineChart labels={chart.labels} titles={chart.titles} series={chart.series} ariaLabel={chart.ariaLabel} />;
    case "hbar":
      return <HBarChart rows={chart.rows} unit={chart.unit} max={chart.max} format={chart.format} />;
  }
}

/** The headline figures, then a card for each chart, in the web page's order, one to a row. */
function Charts({ d, features }: { d: TenantAnalyticsDto; features: TenantFeatures }) {
  return (
    <>
      <StatGrid>
        {kpiTiles(d).map((t) => (
          <Kpi key={t.key} tile={t} />
        ))}
      </StatGrid>
      {analyticsView(d, features).map((section, i) => (
        <View key={i} style={styles.section}>
          {section.heading ? (
            <Text {...headingRole(2)} style={styles.heading}>
              {section.heading}
            </Text>
          ) : null}
          {section.charts.map((c) => (
            <ChartCard key={c.id} title={c.title} subtitle={c.subtitle} legend={c.legend} table={c.table} empty={c.empty} emptyText={c.emptyText}>
              <Chart chart={c} />
            </ChartCard>
          ))}
        </View>
      ))}
    </>
  );
}

/**
 * The console's analytics, as the web console's: a period (?weeks=, 12 unless given, so a reload or a link keeps it),
 * the two CSV exports through the share sheet, the headline figures compared with the period before, and every chart,
 * each with its table. The charts of the period before stay up while a new one loads, which a line says. The activity
 * lines follow the institution's switches as they are now.
 */
export default function AdminAnalyticsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ weeks?: string }>();
  const weeks = analyticsWeeks(params.weeks);
  const q = useQuery({ queryKey: qk.admin.analytics(slug, weeks), queryFn: () => api.admin.analytics(slug, weeks), placeholderData: (previous) => previous });
  const updating = q.isPlaceholderData && q.isFetching;
  // Android reads the line below as a live region, and the web build as a status; iOS has no live regions, so it is told.
  useEffect(() => {
    if (updating && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(UPDATING);
  }, [updating]);
  const error = fatalQueryError(q);
  const [exportError, setExportError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <AdminScreen title="Analytics" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primary} colors={[theme.primary]} />}>
      <Muted size={13}>{q.data ? `Weeks start on Monday, ${q.data.timeZone} time` : "How your community is growing"}</Muted>
      <ChipSelect label="Period" options={RANGE_OPTIONS} value={String(weeks)} onChange={(v) => router.setParams({ weeks: v || undefined })} tall />
      <ExportButtons
        exports={[
          { label: "Members CSV", run: () => api.admin.exports.members(slug, { as: "text" }) },
          { label: "Activity CSV", run: () => api.admin.exports.activity(slug, weeks, { as: "text" }) },
        ]}
        onError={setExportError}
      />
      <ErrorText error={exportError} />
      {/* Always there, so Android's live region and the web build's status read the line out when it appears. */}
      <View role="status" accessibilityLiveRegion={Platform.OS === "android" ? "polite" : undefined}>
        {updating ? <Muted size={13}>{UPDATING}</Muted> : null}
      </View>
      {error ? (
        <>
          <ErrorText error={error} />
          <Button title="Try again" variant="outline" onPress={() => void q.refetch()} />
        </>
      ) : null}
      {q.data ? <Charts d={q.data} features={tenant.settings.features} /> : !error ? <Spinner label="Loading the charts" /> : null}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  heading: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: spacing.sm },
});
