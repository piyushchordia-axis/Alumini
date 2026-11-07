import {
  MEMBERSHIP_STATUSES,
  MEMBER_EMPTY_INVITE,
  MEMBER_STATUS_TAB_LABELS,
  approveAllCopy,
  keepPrevious,
  listUpdating,
  listView,
  memberEmptyInvites,
  memberEmptyText,
  memberEmptyTitle,
  memberListMeta,
  memberTabCounts,
  onlySearchChanged,
  parseMemberStatus,
  statusTabs,
} from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MemberActionButtons, useMemberActions } from "@/components/admin/MemberActions";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { KeptResults } from "@/components/common/UpdatingNote";
import { IconDirectory, IconSearch } from "@/components/icons";
import { Avatar, Badge, Button, EmptyState, ErrorBox, Input, LinkButton, ListSkeleton, PageHeader, Pagination, Tabs } from "@/components/ui";
import { useAddressRestarts } from "@/hooks/useAddressRestarts";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { useDebounced } from "@/hooks/useDebounced";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";

/**
 * The console's members, a tab for each status (?status=, Pending unless given) with the dashboard's counts, and a search
 * that runs once typing pauses, as the phone's does, kept in the address as ?q= so a reload or a shared link keeps it.
 * When the address's search changes from anywhere else while the page stays open (the console's own Members link), the
 * list starts again from it rather than writing its own search back over it.
 */
export function AdminMembersPage() {
  const [params] = useSearchParams();
  const { restarts, onWrite } = useAddressRestarts(params.get("q") ?? "");
  return <MembersList key={restarts} onWrite={onWrite} />;
}

/**
 * The list itself. A new search keeps the rows on screen, faded under "Updating results…", until its answer comes, but
 * never across tabs or pages, and their buttons wait meanwhile, as they'd act on someone the search before found; their
 * names still open each member's page. `onWrite` hears each search just before it goes into the address.
 */
function MembersList({ onWrite }: { onWrite: (q: string) => void }) {
  const { tenant, me } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const status = parseMemberStatus(params.get("status"));
  const inAddress = params.get("q") ?? "";
  const [q, setQ] = useState(inAddress);
  const search = useDebounced(q.trim());
  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (search === inAddress) return;
    const next = new URLSearchParams(params);
    if (search) next.set("q", search);
    else next.delete("q");
    next.delete("page");
    onWrite(search);
    setParams(next, { replace: true });
  }, [search, inAddress, params, setParams, onWrite]);
  // Until a new search is in the address, the page there is the search before's: the new one starts at its first.
  const page = search === inAddress ? Number(params.get("page") ?? "1") : 1;
  const query = { status, q: search || undefined, page, pageSize: 25 };
  const key = qk.admin.members(slug, query);
  const list = useQuery({ queryKey: key, queryFn: () => api.admin.members.list(slug, query), placeholderData: keepPrevious((previous) => onlySearchChanged(previous, key)) });
  const rows = list.data?.data ?? [];
  const view = listView(list, rows.length);
  const kept = list.isPlaceholderData;
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
  const clearSearch = () => {
    setQ("");
    searchBox.current?.focus();
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
      <div role="search">
        <Input ref={searchBox} aria-label="Search members" placeholder="Search name, company or phone" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      </div>
      {view === "loading" && <ListSkeleton shape="adminRow" />}
      {view === "error" && <ErrorBox error={list.error} />}
      {view === "empty" && (
        <EmptyState
          icon={search ? <IconSearch /> : <IconDirectory />}
          title={memberEmptyTitle(status, search)}
          description={memberEmptyText(status, search, tenant.settings.memberApprovalMode)}
          live={!!search}
          action={
            search ? (
              // The phone's search box has its own Clear search, so only the web offers one here.
              <Button variant="outline" onClick={clearSearch}>
                Clear search
              </Button>
            ) : memberEmptyInvites(status, search) ? (
              <LinkButton to={`/t/${slug}/admin/invitations`}>{MEMBER_EMPTY_INVITE}</LinkButton>
            ) : undefined
          }
        />
      )}
      {view === "rows" && (
        <KeptResults updating={listUpdating(list, rows.length)}>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {rows.map((m) => (
              <li key={m.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Avatar name={m.fullName} src={m.avatarUrl} toneKey={m.id} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/t/${slug}/admin/members/${m.id}`} className="font-medium text-slate-900 hover:underline">
                        {m.fullName}
                      </Link>
                      {m.role === "TENANT_ADMIN" && <Badge tone="primary">Admin</Badge>}
                      <MemberStatusBadge status={m.status} />
                    </div>
                    <div className="mt-0.5 break-words text-xs text-slate-500">{memberListMeta(m, formatDate)}</div>
                    {m.statusReason && <div className="text-xs text-slate-400">Reason: {m.statusReason}</div>}
                  </div>
                </div>
                <div className="shrink-0 sm:ml-2">{m.id === me?.id ? <span className="text-xs text-slate-400">You</span> : <MemberActionButtons member={m} actions={actions} compact disabled={kept} />}</div>
              </li>
            ))}
          </ul>
        </KeptResults>
      )}
      {/* Hidden only while the rows are kept: a page emptied past the last (its rows approved) still offers Previous. */}
      {list.data && !kept && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
