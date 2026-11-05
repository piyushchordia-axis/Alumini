import { MEMBERSHIP_STATUSES, formatPhone, memberActionsFor, type AdminMemberDto, type MembershipStatus } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { ReasonModal } from "@/components/admin/ReasonModal";
import { Avatar, Button, EmptyState, ErrorBox, Input, Loading, PageHeader, Pagination, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function useMemberActions(slug: string) {
  const qc = useQueryClient();
  const done = (msg: string) => () => {
    void invalidateTenant(qc, slug);
    toast.success(msg);
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));
  return {
    approve: useMutation({ mutationFn: (id: string) => api.admin.members.approve(slug, id), onSuccess: done("Member approved"), onError }),
    reinstate: useMutation({ mutationFn: (id: string) => api.admin.members.reinstate(slug, id), onSuccess: done("Member reinstated"), onError }),
    reject: useMutation({ mutationFn: (v: { id: string; reason: string }) => api.admin.members.reject(slug, v.id, v.reason), onSuccess: done("Request rejected"), onError }),
    suspend: useMutation({ mutationFn: (v: { id: string; reason: string }) => api.admin.members.suspend(slug, v.id, v.reason), onSuccess: done("Member suspended"), onError }),
    approveAll: useMutation({ mutationFn: () => api.admin.members.approveAllPending(slug), onSuccess: (r) => done(`Approved ${r.approved} member(s)`)(), onError }),
    setRole: useMutation({ mutationFn: (v: { id: string; role: "MEMBER" | "TENANT_ADMIN" }) => api.admin.members.setRole(slug, v.id, v.role), onSuccess: done("Role updated"), onError }),
  };
}

export function MemberActionButtons({ member, actions, compact }: { member: AdminMemberDto; actions: ReturnType<typeof useMemberActions>; compact?: boolean }) {
  const [modal, setModal] = useState<"reject" | "suspend" | null>(null);
  const size = compact ? "sm" : "md";
  const can = memberActionsFor(member.status);
  return (
    <div className="flex flex-wrap gap-2">
      {can.includes("approve") && (
        <Button size={size} onClick={() => actions.approve.mutate(member.id)} loading={actions.approve.isPending && actions.approve.variables === member.id}>
          Approve
        </Button>
      )}
      {can.includes("reject") && (
        <Button size={size} variant="outline" onClick={() => setModal("reject")}>
          Reject
        </Button>
      )}
      {can.includes("suspend") && (
        <Button size={size} variant="outline" onClick={() => setModal("suspend")}>
          Suspend
        </Button>
      )}
      {can.includes("reinstate") && (
        <Button size={size} onClick={() => actions.reinstate.mutate(member.id)} loading={actions.reinstate.isPending && actions.reinstate.variables === member.id}>
          Reinstate
        </Button>
      )}
      <ReasonModal
        open={modal === "reject"}
        title={`Reject ${member.fullName}?`}
        label="The member will see this reason and can re-apply."
        required
        tone="danger"
        confirmLabel="Reject"
        onClose={() => setModal(null)}
        onConfirm={(reason) => actions.reject.mutateAsync({ id: member.id, reason })}
      />
      <ReasonModal
        open={modal === "suspend"}
        title={`Suspend ${member.fullName}?`}
        label="They lose access until reinstated."
        required
        tone="danger"
        confirmLabel="Suspend"
        onClose={() => setModal(null)}
        onConfirm={(reason) => actions.suspend.mutateAsync({ id: member.id, reason })}
      />
    </div>
  );
}

export function AdminMembersPage() {
  const { tenant, me } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as MembershipStatus) || "PENDING";
  const page = Number(params.get("page") ?? "1");
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = { status, q: q || undefined, page, pageSize: 25 };
  const list = useQuery({ queryKey: qk.admin.members(slug, query), queryFn: () => api.admin.members.list(slug, query) });
  const dashboard = useQuery({ queryKey: qk.admin.dashboard(slug), queryFn: () => api.admin.dashboard(slug) });
  const actions = useMemberActions(slug);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next);
  };
  const counts = dashboard.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Members"
        subtitle="Approve requests, manage roles, suspend if needed"
        actions={
          status === "PENDING" && (counts?.pendingMembers ?? 0) > 0 ? (
            <Button variant="outline" onClick={() => confirm(`Approve all ${counts?.pendingMembers} pending members?`) && actions.approveAll.mutate()} loading={actions.approveAll.isPending}>
              Approve all pending
            </Button>
          ) : undefined
        }
      />
      <Tabs
        value={status}
        onChange={(v) => setParam("status", v)}
        tabs={MEMBERSHIP_STATUSES.map((s) => ({
          value: s,
          label: s.charAt(0) + s.slice(1).toLowerCase(),
          count: counts ? { PENDING: counts.pendingMembers, APPROVED: counts.approvedMembers, REJECTED: counts.rejectedMembers, SUSPENDED: counts.suspendedMembers }[s] : undefined,
        }))}
        className="w-fit"
      />
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
      {list.data && list.data.data.length === 0 && <EmptyState title={`No ${status.toLowerCase()} members`} />}
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
                <div className="mt-0.5 break-words text-xs text-slate-500">
                  Batch of {m.batchYear}
                  {m.phone ? ` · ${formatPhone(m.phone)}` : ""}
                  {[m.companyName, m.city].filter(Boolean).length ? ` · ${[m.companyName, m.city].filter(Boolean).join(", ")}` : ""}
                  {` · requested ${formatDate(m.createdAt)}`}
                </div>
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
