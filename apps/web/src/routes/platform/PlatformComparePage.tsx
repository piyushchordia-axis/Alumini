import { BILLING_MODEL_LABELS, type PlatformComparisonRowDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChartCard, HBarChart, plural, type Unit } from "@/components/charts";
import { Avatar, Button, ErrorBox, FormField, Input, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { formatDate, formatMoneyMinor } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

type SortKey = "name" | "approvedMembers" | "newMembers" | "activeMembers" | "activityRate" | "posts" | "messages" | "estimatedAmountMinor";

const totalMessages = (r: PlatformComparisonRowDto) => r.messages.WHATSAPP + r.messages.SMS + r.messages.EMAIL;
const value = (r: PlatformComparisonRowDto, key: SortKey): number | string =>
  key === "name" ? r.tenant.name.toLowerCase() : key === "posts" ? r.content.posts : key === "messages" ? totalMessages(r) : r[key];
const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

const METRICS: Partial<Record<SortKey, { title: string; unit: Unit; format?: (n: number) => string }>> = {
  approvedMembers: { title: "Approved members", unit: plural("approved member", "approved members") },
  newMembers: { title: "New members in the period", unit: plural("new member", "new members") },
  activeMembers: { title: "Active members in the period", unit: plural("active member", "active members") },
  activityRate: { title: "Share of members active", unit: "of members active", format: (n) => `${n}%` },
  posts: { title: "Posts in the period", unit: plural("post", "posts") },
  messages: { title: "Messages delivered", unit: plural("message", "messages") },
};
const CHART_ROWS = 15;
const CHANNELS = [
  { key: "WHATSAPP", label: "WhatsApp" },
  { key: "SMS", label: "SMS" },
  { key: "EMAIL", label: "Email" },
] as const;

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "name", label: "Institution" },
  { key: "approvedMembers", label: "Approved", numeric: true },
  { key: "newMembers", label: "New", numeric: true },
  { key: "activeMembers", label: "Active", numeric: true },
  { key: "activityRate", label: "Active %", numeric: true },
  { key: "posts", label: "Posts·jobs·events", numeric: true },
  { key: "messages", label: "Messages", numeric: true },
  { key: "estimatedAmountMinor", label: "Estimate", numeric: true },
];

/** Every institution side by side for a billing period: size, activity, messaging and the chargeback estimate. */
export function PlatformComparePage() {
  const [period, setPeriod] = useState<{ from?: string; to?: string }>({});
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "activeMembers", desc: true });
  const valid = !period.from || !period.to || period.from <= period.to;
  const q = useQuery({ queryKey: qk.platform.comparison(period), queryFn: () => api.platform.comparison(period), enabled: valid, placeholderData: (prev) => prev });
  const csv = useMutation({
    mutationFn: () => api.platform.comparisonCsv(period),
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename ?? "institutions.csv"),
    onError: (e) => toast.error(errorMessage(e, "The export failed. Try again.")),
  });

  const d = q.data;
  const rows = [...(d?.rows ?? [])].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return sort.desc ? -c : c;
  });
  const metricKey: SortKey = METRICS[sort.key] ? sort.key : "activeMembers";
  const metric = METRICS[metricKey]!;
  const chartValue = (r: PlatformComparisonRowDto) => (metricKey === "activityRate" ? Math.round(r.activityRate * 1000) / 10 : (value(r, metricKey) as number));
  const chartRows = [...(d?.rows ?? [])]
    .sort((a, b) => chartValue(b) - chartValue(a))
    .slice(0, CHART_ROWS)
    .map((r) => ({ label: r.tenant.name, count: chartValue(r) }));
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Compare institutions"
        subtitle={d ? `${formatDate(d.periodStart)} – ${formatDate(d.periodEnd)} · days in ${d.timeZone} (the billing time zone)` : "Size, activity and estimated charges per institution"}
        actions={
          <Button variant="outline" size="sm" loading={csv.isPending} disabled={!d} onClick={() => csv.mutate()}>
            ⬇ Download CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="From">
          <Input type="date" value={period.from ?? d?.periodStart ?? ""} onChange={(e) => setPeriod((p) => ({ from: e.target.value || undefined, to: p.to ?? d?.periodEnd }))} />
        </FormField>
        <FormField label="To" error={valid ? undefined : "Must be on or after the start"}>
          <Input type="date" value={period.to ?? d?.periodEnd ?? ""} onChange={(e) => setPeriod((p) => ({ from: p.from ?? d?.periodStart, to: e.target.value || undefined }))} />
        </FormField>
        {(period.from || period.to) && (
          <Button variant="ghost" size="sm" onClick={() => setPeriod({})}>
            This month
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.error || !d ? (
        <ErrorBox error={q.error ?? "Failed"} />
      ) : (
        <>
          <ChartCard
            title={metric.title}
            subtitle={d.rows.length > CHART_ROWS ? `Top ${CHART_ROWS} of ${d.rows.length} institutions; sort the table to change the measure` : "Sort the table to change the measure"}
            empty={chartRows.every((r) => r.count === 0)}
            table={{ columns: ["Institution", metric.title], rows: chartRows.map((r) => [r.label, metric.format ? metric.format(r.count) : r.count]) }}
          >
            <HBarChart rows={chartRows} unit={metric.unit} format={metric.format} ariaLabel={`${metric.title} by institution`} />
          </ChartCard>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"} className={clsx("px-3 py-2", c.numeric && "text-right")}>
                      <button type="button" onClick={() => toggle(c.key)} className={clsx("inline-flex items-center gap-1 uppercase hover:text-slate-900", sort.key === c.key && "text-slate-900")}>
                        {c.label}
                        <span aria-hidden className="w-2">{sort.key === c.key ? (sort.desc ? "↓" : "↑") : ""}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.tenant.id} className="whitespace-nowrap tabular-nums">
                    <td className="min-w-[13rem] whitespace-normal px-3 py-2">
                      <Link to={`/platform/tenants/${r.tenant.id}`} className="flex items-center gap-2 font-medium text-slate-900 hover:underline">
                        <Avatar name={r.tenant.shortName ?? r.tenant.name} src={r.tenant.logoUrl} size="sm" />
                        <span className="min-w-0 max-w-[14rem]">
                          <span className="block">{r.tenant.name}</span>
                          <span className="block text-xs font-normal text-slate-500">
                            {r.tenant.status === "ACTIVE" ? "" : `${r.tenant.status.toLowerCase()} · `}
                            {r.plan ? BILLING_MODEL_LABELS[r.plan.billingModel] : "No plan"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right">{r.approvedMembers.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{r.newMembers.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{r.activeMembers.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{pct(r.activityRate)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {r.content.posts} · {r.content.jobs} · {r.content.events}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {totalMessages(r).toLocaleString()}
                      {CHANNELS.filter((c) => r.messages[c.key] > 0).map((c) => (
                        <span key={c.key} className="block text-xs text-slate-500">
                          {c.label} {r.messages[c.key].toLocaleString()}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">{r.plan ? formatMoneyMinor(r.estimatedAmountMinor, r.currency, 2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
