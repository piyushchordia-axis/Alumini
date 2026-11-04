import type { CountRow, TenantAnalyticsDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ChartCard, ColumnChart, formatWeek, HBarChart, LineChart, plural, SERIES, type LineSeries } from "@/components/charts";

const MEMBERS = plural("member", "members");
import { Button, Card, ErrorBox, Loading, PageHeader, Select } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

const RANGES = [
  { weeks: 12, label: "Last 12 weeks" },
  { weeks: 26, label: "Last 6 months" },
  { weeks: 52, label: "Last 12 months" },
];

const percent = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const weekTitle = (w: string) => `Week of ${formatWeek(w, true)}`;

/** "+12% vs the previous 12 weeks" — neutral text with an arrow, so the change is never shown by colour alone. */
function Delta({ now, prev, weeks }: { now: number; prev: number; weeks: number }) {
  const span = weeks === 52 ? "12 months" : weeks === 26 ? "6 months" : `${weeks} weeks`;
  if (!prev) return <span>{now ? `None in the previous ${span}` : `None in this or the previous ${span}`}</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
  return (
    <span>
      <span aria-hidden>{arrow} </span>
      {pct > 0 ? "+" : ""}
      {pct}% vs the previous {span} ({prev.toLocaleString()})
    </span>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number; hint: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value.toLocaleString()}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </Card>
  );
}

function DistributionCard({ title, subtitle, rows, total }: { title: string; subtitle?: string; rows: CountRow[]; total?: number }) {
  return (
    <ChartCard title={title} subtitle={subtitle} empty={rows.length === 0} emptyText="No answers yet." table={{ columns: [title, "Members"], rows: rows.map((r) => [r.label, r.count]) }}>
      <HBarChart rows={rows} unit={MEMBERS} max={total} ariaLabel={`${title}: ${rows.map((r) => `${r.label} ${r.count}`).join(", ")}`} />
    </ChartCard>
  );
}

function ExportButton({ label, run }: { label: string; run: () => Promise<{ blob: Blob; filename: string | null }> }) {
  const m = useMutation({
    mutationFn: run,
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename ?? "export.csv"),
    onError: (e) => toast.error(errorMessage(e, "The export failed. Try again.")),
  });
  return (
    <Button variant="outline" size="sm" loading={m.isPending} onClick={() => m.mutate()}>
      ⬇ {label}
    </Button>
  );
}

function Charts({ d, weeks }: { d: TenantAnalyticsDto; weeks: number }) {
  const { tenant } = useAdminTenant();
  const features = tenant.settings.features;
  const content: LineSeries[] = [
    features.feed && { name: "Posts", values: d.series.posts },
    features.feed && { name: "Comments", values: d.series.comments },
    features.jobs && { name: "Jobs", values: d.series.jobs },
    features.events && { name: "Events", values: d.series.events },
  ]
    .filter((s): s is { name: string; values: number[] } => !!s)
    .map((s, i) => ({ ...s, color: SERIES[i]! }));
  const weekRows = (cols: number[][]) => d.weeks.map((w, i) => [formatWeek(w, true), ...cols.map((c) => c[i] ?? 0)]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const c = d.coverage.completeness;
  const completeness: CountRow[] = [
    { label: "Photo", count: c.photo },
    { label: "Headline", count: c.headline },
    { label: "City", count: c.city },
    { label: "Company", count: c.company },
    { label: "Industry", count: c.industry },
    { label: "Skills", count: c.skills },
    { label: "Past roles", count: c.pastRoles },
    { label: "Education", count: c.education },
    { label: "Birthday", count: c.birthday },
    { label: "LinkedIn", count: c.linkedin },
    { label: "Any link", count: c.anyLink },
    { label: "Confirmed email", count: c.email },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Approved members" value={d.kpis.members} hint={`${d.kpis.newMembers.toLocaleString()} joined in this period`} />
        <Kpi label="New members" value={d.kpis.newMembers} hint={<Delta now={d.kpis.newMembers} prev={d.kpis.newMembersPrev} weeks={weeks} />} />
        <Kpi label="Active members" value={d.kpis.activeMembers} hint={<Delta now={d.kpis.activeMembers} prev={d.kpis.activeMembersPrev} weeks={weeks} />} />
        <Kpi label="Posts" value={d.kpis.posts} hint={<Delta now={d.kpis.posts} prev={d.kpis.postsPrev} weeks={weeks} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="New members per week"
          subtitle="Approvals, by the week they joined"
          empty={sum(d.series.joined) === 0 && sum(d.series.registered) === 0}
          table={{ columns: ["Week", "Approved", "Signed up"], rows: weekRows([d.series.joined, d.series.registered]) }}
        >
          <ColumnChart labels={d.weeks} values={d.series.joined} formatLabel={(w) => formatWeek(w)} describe={weekTitle} unit="approved" ariaLabel={`New members per week, ${sum(d.series.joined)} in total`} />
        </ChartCard>
        <ChartCard
          title="Active members per week"
          subtitle="Members who used the app at least once that week (the definition billing uses)"
          empty={sum(d.series.active) === 0}
          table={{ columns: ["Week", "Active members"], rows: weekRows([d.series.active]) }}
        >
          <LineChart labels={d.weeks} series={[{ name: "Active members", values: d.series.active, color: SERIES[0] }]} formatLabel={(w) => formatWeek(w)} describe={weekTitle} ariaLabel="Active members per week" />
        </ChartCard>
      </div>

      {content.length > 0 && (
        <ChartCard
          title="Activity per week"
          subtitle="Published or awaiting review; rejected content isn't counted"
          legend={content.map((s) => ({ label: s.name, color: s.color, kind: "line" as const }))}
          empty={content.every((s) => sum(s.values) === 0)}
          table={{ columns: ["Week", ...content.map((s) => s.name)], rows: weekRows(content.map((s) => s.values)) }}
        >
          <LineChart labels={d.weeks} series={content} formatLabel={(w) => formatWeek(w)} describe={weekTitle} ariaLabel={`Activity per week: ${content.map((s) => `${s.name} ${sum(s.values)}`).join(", ")}`} />
        </ChartCard>
      )}

      <h2 className="pt-2 text-base font-semibold text-slate-900">Who your members are</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Members by batch"
          subtitle="Approved members by graduating year"
          empty={d.coverage.batches.length === 0}
          table={{ columns: ["Batch", "Members"], rows: d.coverage.batches.map((b) => [b.label, b.count]) }}
        >
          <ColumnChart labels={d.coverage.batches.map((b) => b.label)} values={d.coverage.batches.map((b) => b.count)} describe={(l) => `Batch of ${l}`} unit={MEMBERS} ariaLabel="Members by batch" />
        </ChartCard>
        <ChartCard
          title="Profile completeness"
          subtitle={`Share of ${c.total.toLocaleString()} approved members who added each detail`}
          empty={c.total === 0}
          table={{ columns: ["Detail", "Members", "Share"], rows: completeness.map((r) => [r.label, r.count, `${percent(r.count, c.total)}%`]) }}
        >
          <HBarChart
            rows={completeness.map((r) => ({ label: r.label, count: percent(r.count, c.total) }))}
            format={(n) => `${n}%`}
            max={100}
            unit="of members"
            ariaLabel={`Profile completeness: ${completeness.map((r) => `${r.label} ${percent(r.count, c.total)}%`).join(", ")}`}
          />
        </ChartCard>
        <DistributionCard title="Top cities" subtitle="Approved members by city (top 10)" rows={d.coverage.cities} />
        <DistributionCard title="Countries" rows={d.coverage.countries} />
        <DistributionCard title="Professions" rows={d.coverage.professions} />
        {d.coverage.fields.map((f) => (
          <DistributionCard key={f.key} title={f.label} subtitle="Answers to your profile question" rows={f.options} />
        ))}
        <ChartCard
          title="Invitations"
          subtitle="All invitations you've imported"
          empty={d.invites.total === 0}
          emptyText="No invitations yet. Import a list from the Invitations page."
          table={{ columns: ["Stage", "Invitations"], rows: [["Imported", d.invites.total], ["Sent", d.invites.sent], ["Joined", d.invites.accepted]] }}
        >
          <HBarChart
            rows={[
              { label: "Imported", count: d.invites.total },
              { label: "Sent", count: d.invites.sent },
              { label: "Joined", count: d.invites.accepted },
            ]}
            unit={plural("invitation", "invitations")}
            ariaLabel={`Invitations: ${d.invites.total} imported, ${d.invites.sent} sent, ${d.invites.accepted} joined`}
          />
        </ChartCard>
      </div>
    </div>
  );
}

export function AdminAnalyticsPage() {
  const { tenant } = useAdminTenant();
  const [weeks, setWeeks] = useState(12);
  const q = useQuery({ queryKey: qk.admin.analytics(tenant.slug, weeks), queryFn: () => api.admin.analytics(tenant.slug, weeks), placeholderData: (prev) => prev });
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
                {RANGES.map((r) => (
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
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorBox error={q.error ?? "Failed"} /> : <Charts d={q.data} weeks={weeks} />}
    </div>
  );
}
