import { BILLING_MODEL_LABELS } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ErrorBox, Loading, PageHeader, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function PlatformStatsPage() {
  const q = useQuery({ queryKey: qk.platform.stats, queryFn: () => api.platform.stats() });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? "Failed"} />;
  const s = q.data;
  return (
    <div className="space-y-5">
      <PageHeader title="Platform stats" subtitle="Across all institutions" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Institutions" value={s.tenants.total} hint={`${s.tenants.byStatus.ACTIVE} active · ${s.tenants.byStatus.SUSPENDED} suspended`} />
        <Stat label="Users" value={s.users} />
        <Stat label="Approved members" value={s.memberships.APPROVED} hint={`${s.memberships.PENDING} pending`} />
        <Stat label="Active members (30d)" value={s.activeMembers30d} />
        <Stat label="Posts" value={s.content.posts} />
        <Stat label="Jobs" value={s.content.jobs} />
        <Stat label="Funding listings" value={s.content.funding} />
        <Stat label="Events" value={s.content.events} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Institution</th>
              <th className="px-3 py-2 text-right">Approved</th>
              <th className="px-3 py-2 text-right">Pending</th>
              <th className="px-3 py-2 text-right">Active 30d</th>
              <th className="px-3 py-2 text-right">New 30d</th>
              <th className="px-3 py-2">Billing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {s.perTenant.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2">
                  <Link to={`/platform/tenants/${t.id}`} className="font-medium text-slate-900 hover:underline">
                    {t.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right">{t.counts.approvedMembers}</td>
                <td className="px-3 py-2 text-right">{t.counts.pendingMembers}</td>
                <td className="px-3 py-2 text-right">{t.counts.activeMembers30d}</td>
                <td className="px-3 py-2 text-right">{t.counts.newMembers30d}</td>
                <td className="px-3 py-2 text-slate-600">{t.billingModel ? BILLING_MODEL_LABELS[t.billingModel] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
