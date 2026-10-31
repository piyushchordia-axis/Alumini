import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, EmptyState, ErrorBox, Input, Loading, PageHeader, Pagination } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "@/stores/uiStore";

export function PlatformUsersPage() {
  const [phone, setPhone] = useState("");
  const [page, setPage] = useState(1);
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const query = { phone: phone || undefined, page, pageSize: 25 };
  const list = useQuery({ queryKey: qk.platform.users(query), queryFn: () => api.platform.users.list(query) });
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
      <Input aria-label="Search by phone" placeholder="Search by phone digits" value={phone} onChange={(e) => { setPhone(e.target.value); setPage(1); }} className="max-w-xs" />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.data.length === 0 && <EmptyState title="No users found" />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.data?.data.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{u.displayName ?? "—"}</span>
                <span className="text-slate-500">{u.phone}</span>
                {u.isPlatformAdmin && <Badge tone="primary">Platform admin</Badge>}
              </div>
              <div className="text-xs text-slate-500">
                {u.memberships.length === 0 ? "No memberships" : u.memberships.map((m) => `${m.tenant.shortName ?? m.tenant.name} (${m.status.toLowerCase()}${m.role === "TENANT_ADMIN" ? ", admin" : ""})`).join(" · ")}
                {u.lastLoginAt ? ` · last login ${formatDateTime(u.lastLoginAt)}` : ""}
              </div>
            </div>
            {u.id !== me?.id && (
              <Button size="sm" variant={u.isPlatformAdmin ? "outline" : "ghost"} onClick={() => toggle.mutate({ id: u.id, enabled: !u.isPlatformAdmin })} loading={toggle.isPending}>
                {u.isPlatformAdmin ? "Revoke platform admin" : "Make platform admin"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />}
    </div>
  );
}
