import { BILLING_MODEL_LABELS, TENANT_TYPE_LABELS, type TenantStatus, countryName, keepPrevious, listUpdating, listView, onlySearchChanged } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { KeptResults } from "@/components/common/UpdatingNote";
import { IconBuilding, IconSearch } from "@/components/icons";
import { Avatar, Badge, Button, EmptyState, ErrorBox, Input, LinkButton, ListSkeleton, PageHeader, Pagination, Select } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

const statusTone = { ACTIVE: "success", SUSPENDED: "warning", ARCHIVED: "neutral" } as const;

/**
 * Every institution, with a search that runs once typing pauses. While a new search's answer comes, the rows on screen
 * stay, faded under "Updating results…": they only open an institution's page.
 */
export function PlatformTenantsPage() {
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const searchBox = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<TenantStatus | "">("");
  const [page, setPage] = useState(1);
  // A new search starts at its first page.
  const [pagedSearch, setPagedSearch] = useState(search);
  if (pagedSearch !== search) {
    setPagedSearch(search);
    setPage(1);
  }
  const query = { q: search || undefined, status: status || undefined, page, pageSize: 25 };
  const key = qk.platform.tenants(query);
  const list = useQuery({ queryKey: key, queryFn: () => api.platform.tenants.list(query), placeholderData: keepPrevious((previous) => onlySearchChanged(previous, key)) });
  const rows = list.data?.data ?? [];
  const view = listView(list, rows.length);
  const filtered = !!(query.q || query.status);
  const showAll = () => {
    setQ("");
    setStatus("");
    setPage(1);
    searchBox.current?.focus();
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Institutions" subtitle="Every university, college and school on Illuminize" actions={<LinkButton to="/platform/tenants/new">+ Onboard institution</LinkButton>} />
      <div className="flex flex-wrap gap-2">
        <Input ref={searchBox} aria-label="Search institutions" placeholder="Search name, slug or city" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as TenantStatus | ""); setPage(1); }} className="w-40">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
      </div>
      {view === "loading" && <ListSkeleton shape="table" />}
      {view === "error" && <ErrorBox error={list.error} />}
      {view === "empty" &&
        (filtered ? (
          <EmptyState
            icon={<IconSearch />}
            title="No institutions match"
            description="Try another name, slug or city, or another status."
            live
            action={<Button onClick={showAll}>Show all institutions</Button>}
          />
        ) : (
          <EmptyState
            icon={<IconBuilding />}
            title="No institutions yet"
            description="Onboard a university, college, school or community to get started."
            action={<LinkButton to="/platform/tenants/new">Onboard the first one</LinkButton>}
          />
        ))}
      {view === "rows" && (
        <KeptResults updating={listUpdating(list, rows.length)} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link to={`/platform/tenants/${t.id}`} className="flex items-center gap-2">
                      <Avatar name={t.shortName ?? t.name} src={t.logoUrl} size="sm" brandColor={t.primaryColor} />
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
        </KeptResults>
      )}
      {list.data && !list.isPlaceholderData && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />}
    </div>
  );
}
