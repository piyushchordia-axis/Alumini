import { MEMBERSHIP_STATUSES, MEMBER_SEARCH_HINT, MEMBER_STATUS_TAB_LABELS, approveAllCopy, memberEmptyTitle, memberListMeta, memberTabCounts, parseMemberStatus, statusTabs } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MemberActionButtons, useMemberActions } from "@/components/admin/MemberActions";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Avatar, Button, EmptyState, ErrorBox, Input, Loading, PageHeader, Pagination, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";

export function AdminMembersPage() {
  const { tenant, me } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const status = parseMemberStatus(params.get("status"));
  const page = Number(params.get("page") ?? "1");
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = { status, q: q || undefined, page, pageSize: 25 };
  const list = useQuery({ queryKey: qk.admin.members(slug, query), queryFn: () => api.admin.members.list(slug, query) });
  const dashboard = useQuery({ queryKey: qk.admin.dashboard(slug), queryFn: () => api.admin.dashboard(slug) });
  const actions = useMemberActions(slug);
  const [approvingAll, setApprovingAll] = useState(false);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next);
  };
  const pending = dashboard.data?.pendingMembers ?? 0;
  const approveAll = approveAllCopy(pending);
  const closeApproveAll = () => {
    setApprovingAll(false);
    actions.approveAll.reset();
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Members"
        subtitle="Approve requests, manage roles, suspend if needed"
        actions={
          status === "PENDING" && pending > 0 ? (
            <Button variant="outline" onClick={() => setApprovingAll(true)}>
              Approve all pending
            </Button>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={approvingAll}
        title={approveAll.title}
        body={approveAll.body}
        confirmLabel={approveAll.confirm}
        busy={actions.approveAll.isPending}
        error={actions.approveAll.error}
        onConfirm={() => actions.approveAll.mutate(undefined, { onSuccess: closeApproveAll })}
        onCancel={closeApproveAll}
      />
      <Tabs value={status} onChange={(v) => setParam("status", v)} tabs={statusTabs(MEMBERSHIP_STATUSES, MEMBER_STATUS_TAB_LABELS, memberTabCounts(dashboard.data))} className="w-fit" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParam("q", q);
        }}
        className="flex gap-2"
      >
        <Input aria-label="Search members" placeholder="Search name, company or phone" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.data.length === 0 && <EmptyState title={memberEmptyTitle(status, q)} description={q.trim() ? MEMBER_SEARCH_HINT : undefined} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.data?.data.map((m) => (
          <li key={m.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Avatar name={m.fullName} src={m.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/t/${slug}/admin/members/${m.id}`} className="font-medium text-slate-900 hover:underline">
                    {m.fullName}
                  </Link>
                  {m.role === "TENANT_ADMIN" && <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">Admin</span>}
                  <MemberStatusBadge status={m.status} />
                </div>
                <div className="mt-0.5 break-words text-xs text-slate-500">{memberListMeta(m, formatDate)}</div>
                {m.statusReason && <div className="text-xs text-slate-400">Reason: {m.statusReason}</div>}
              </div>
            </div>
            <div className="shrink-0 sm:ml-2">{m.id === me?.id ? <span className="text-xs text-slate-400">You</span> : <MemberActionButtons member={m} actions={actions} compact />}</div>
          </li>
        ))}
      </ul>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
