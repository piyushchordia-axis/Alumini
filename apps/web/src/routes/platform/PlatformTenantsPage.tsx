import { BILLING_MODEL_LABELS, TENANT_TYPE_LABELS, type TenantStatus, countryName } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, Badge, Button, EmptyState, ErrorBox, Input, LinkButton, Loading, PageHeader, Pagination, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

const statusTone = { ACTIVE: "success", SUSPENDED: "warning", ARCHIVED: "neutral" } as const;

export function PlatformTenantsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<TenantStatus | "">("");
  const [page, setPage] = useState(1);
  const query = { q: q || undefined, status: status || undefined, page, pageSize: 25 };
  const list = useQuery({ queryKey: qk.platform.tenants(query), queryFn: () => api.platform.tenants.list(query) });
  return (
    <div className="space-y-4">
      <PageHeader title="Institutions" subtitle="Every university, college and school on Illuminize" actions={<LinkButton to="/platform/tenants/new">+ Onboard institution</LinkButton>} />
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Search institutions" placeholder="Search name, slug or city" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as TenantStatus | ""); setPage(1); }} className="w-40">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
      </div>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.data.length === 0 && <EmptyState title="No institutions yet" action={<Button onClick={() => (window.location.href = "/platform/tenants/new")}>Onboard the first one</Button>} />}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Institution</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Approved</th>
              <th className="px-3 py-2 text-right">Pending</th>
              <th className="px-3 py-2 text-right">Active 30d</th>
              <th className="px-3 py-2">Billing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data?.data.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link to={`/platform/tenants/${t.id}`} className="flex items-center gap-2">
                    <Avatar name={t.shortName ?? t.name} src={t.logoUrl} size="sm" />
                    <span>
                      <span className="block font-medium text-slate-900">{t.name}</span>
                      <span className="block text-xs text-slate-500">
                        /{t.slug} · {TENANT_TYPE_LABELS[t.type]} · {[t.city, countryName(t.country)].filter(Boolean).join(", ")}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={statusTone[t.status]}>{t.status}</Badge>
                </td>
                <td className="px-3 py-2 text-right">{t.counts.approvedMembers}</td>
                <td className="px-3 py-2 text-right">{t.counts.pendingMembers}</td>
                <td className="px-3 py-2 text-right">{t.counts.activeMembers30d}</td>
                <td className="px-3 py-2 text-slate-600">{t.billingModel ? BILLING_MODEL_LABELS[t.billingModel] : <span className="text-amber-700">No plan</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />}
    </div>
  );
}
