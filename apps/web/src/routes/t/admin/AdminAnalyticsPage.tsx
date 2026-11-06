import { ANALYTICS_RANGES, analyticsView, DEFAULT_ANALYTICS_WEEKS, kpiTiles, type AnalyticsChart, type DeltaDirection, type DeltaView, type KpiTile, type TenantAnalyticsDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useState, type ComponentType } from "react";
import { ChartCard, ColumnChart, HBarChart, LineChart } from "@/components/charts";
import { IconDownload, IconTrendDown, IconTrendFlat, IconTrendUp, type IconProps } from "@/components/icons";
import { Button, Card, ErrorBox, Loading, PageHeader, Select } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

const TREND_ICONS: Record<Exclude<DeltaDirection, "none">, ComponentType<IconProps>> = { up: IconTrendUp, down: IconTrendDown, flat: IconTrendFlat };

/** "+12% vs the previous 12 weeks (10)": neutral text, which says the direction, with an arrow beside it. */
function Delta({ delta }: { delta: DeltaView }) {
  const Trend = delta.direction === "none" ? null : TREND_ICONS[delta.direction];
  return (
    <span className="inline-flex items-start gap-1">
      {Trend && <Trend size={14} className="mt-px" />}
      <span>{delta.text}</span>
    </span>
  );
}

function Kpi({ tile }: { tile: KpiTile }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{tile.label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{tile.valueText}</div>
      <div className="mt-1 text-xs text-slate-500">{tile.delta ? <Delta delta={tile.delta} /> : tile.hint}</div>
    </Card>
  );
}

function Chart({ chart }: { chart: AnalyticsChart }) {
  switch (chart.kind) {
    case "column":
      return <ColumnChart labels={chart.labels} titles={chart.titles} values={chart.values} unit={chart.unit} ariaLabel={chart.ariaLabel} />;
    case "line":
      return <LineChart labels={chart.labels} titles={chart.titles} series={chart.series} ariaLabel={chart.ariaLabel} />;
    case "hbar":
      return <HBarChart rows={chart.rows} unit={chart.unit} max={chart.max} format={chart.format} ariaLabel={chart.ariaLabel} />;
  }
}

function ExportButton({ label, run }: { label: string; run: () => Promise<{ blob: Blob; filename: string | null }> }) {
  const m = useMutation({
    mutationFn: run,
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename ?? "export.csv"),
    onError: (e) => toast.error(errorMessage(e, "The export failed. Try again.")),
  });
  return (
    <Button variant="outline" size="sm" className="gap-1.5" loading={m.isPending} onClick={() => m.mutate()}>
      <IconDownload size={16} />
      {label}
    </Button>
  );
}

function Charts({ d }: { d: TenantAnalyticsDto }) {
  const { tenant } = useAdminTenant();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpiTiles(d).map((t) => (
          <Kpi key={t.key} tile={t} />
        ))}
      </div>
      {analyticsView(d, tenant.settings.features).map((section, i) => (
        <div key={i} className="space-y-4">
          {section.heading && <h2 className="pt-2 text-base font-semibold text-slate-900">{section.heading}</h2>}
          <div className="grid gap-4 lg:grid-cols-2">
            {section.charts.map((c) => (
              <ChartCard key={c.id} title={c.title} subtitle={c.subtitle} legend={c.legend} table={c.table} empty={c.empty} emptyText={c.emptyText} className={clsx(c.wide && "lg:col-span-2")}>
                <Chart chart={c} />
              </ChartCard>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminAnalyticsPage() {
  const { tenant } = useAdminTenant();
  const [weeks, setWeeks] = useState<number>(DEFAULT_ANALYTICS_WEEKS);
  const q = useQuery({ queryKey: qk.admin.analytics(tenant.slug, weeks), queryFn: () => api.admin.analytics(tenant.slug, weeks), placeholderData: (prev) => prev });
  // The charts of the range before stay up while the new one loads, which this says.
  const updating = q.isPlaceholderData && q.isFetching;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle={q.data ? `Weeks start on Monday, ${q.data.timeZone} time` : "How your community is growing"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="analytics-range">
              Period
            </label>
            <div className="w-40">
              <Select id="analytics-range" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} style={{ height: 32, paddingTop: 0, paddingBottom: 0 }}>
                {ANALYTICS_RANGES.map((r) => (
                  <option key={r.weeks} value={r.weeks}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <ExportButton label="Members CSV" run={() => api.admin.exports.members(tenant.slug)} />
            <ExportButton label="Activity CSV" run={() => api.admin.exports.activity(tenant.slug, weeks)} />
          </div>
        }
      />
      <p role="status" className={clsx("text-xs text-slate-500", !updating && "sr-only")}>
        {updating ? "Updating…" : ""}
      </p>
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorBox error={q.error ?? "Failed"} /> : <Charts d={q.data} />}
    </div>
  );
}
