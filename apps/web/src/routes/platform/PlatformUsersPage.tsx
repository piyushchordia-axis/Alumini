import { formatPhone, keepPrevious, listUpdating, listView, onlySearchChanged } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { KeptResults } from "@/components/common/UpdatingNote";
import { IconProfile, IconSearch } from "@/components/icons";
import { Badge, Button, EmptyState, ErrorBox, Input, ListSkeleton, PageHeader, Pagination } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "@/stores/uiStore";

/**
 * Everyone who has signed in, with a search by phone digits that runs once typing pauses. While a new search's answer
 * comes, the rows on screen stay, faded under "Updating results…", and their buttons wait: they'd change someone the
 * search before found.
 */
export function PlatformUsersPage() {
  const [phone, setPhone] = useState("");
  const search = useDebounced(phone.trim());
  const searchBox = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  // A new search starts at its first page.
  const [pagedSearch, setPagedSearch] = useState(search);
  if (pagedSearch !== search) {
    setPagedSearch(search);
    setPage(1);
  }
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const query = { phone: search || undefined, page, pageSize: 25 };
  const clearSearch = () => {
    setPhone("");
    searchBox.current?.focus();
  };
  const key = qk.platform.users(query);
  const list = useQuery({ queryKey: key, queryFn: () => api.platform.users.list(query), placeholderData: keepPrevious((previous) => onlySearchChanged(previous, key, "phone")) });
  const rows = list.data?.data ?? [];
  const view = listView(list, rows.length);
  const kept = list.isPlaceholderData;
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api.platform.users.setPlatformAdmin(v.id, v.enabled),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform", "users"] });
      toast.success("Updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Users" subtitle="Every phone number that has signed in, across institutions" />
      <Input ref={searchBox} aria-label="Search by phone" placeholder="Search by phone digits" value={phone} onChange={(e) => setPhone(e.target.value)} className="max-w-xs" />
      {view === "loading" && <ListSkeleton shape="adminRow" />}
      {view === "error" && <ErrorBox error={list.error} />}
      {view === "empty" && (
        <EmptyState
          icon={search ? <IconSearch /> : <IconProfile />}
          title="No users found"
          description={search ? "Try fewer digits, or check the number." : "People show here once they've signed in."}
          live={!!search}
          action={
            search && (
              <Button variant="outline" onClick={clearSearch}>
                Clear search
              </Button>
            )
          }
        />
      )}
      {view === "rows" && (
        <KeptResults updating={listUpdating(list, rows.length)}>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {rows.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{u.displayName ?? "—"}</span>
                    <span className="text-slate-500">{formatPhone(u.phone)}</span>
                    {u.isPlatformAdmin && <Badge tone="primary">Platform admin</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {u.memberships.length === 0 ? "No memberships" : u.memberships.map((m) => `${m.tenant.shortName ?? m.tenant.name} (${m.status.toLowerCase()}${m.role === "TENANT_ADMIN" ? ", admin" : ""})`).join(" · ")}
                    {u.lastLoginAt ? ` · last login ${formatDateTime(u.lastLoginAt)}` : ""}
                  </div>
                </div>
                {u.id !== me?.id && (
                  <Button size="sm" variant={u.isPlatformAdmin ? "outline" : "ghost"} onClick={() => toggle.mutate({ id: u.id, enabled: !u.isPlatformAdmin })} loading={toggle.isPending} disabled={kept}>
                    {u.isPlatformAdmin ? "Revoke platform admin" : "Make platform admin"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </KeptResults>
      )}
      {list.data && !kept && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />}
    </div>
  );
}
