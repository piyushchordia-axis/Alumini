import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AuditTable } from "@/components/admin/AuditTable";
import { ErrorBox, Input, Loading, PageHeader, Pagination } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function AdminAuditPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const query = { page, pageSize: 50, action: action || undefined };
  const q = useQuery({ queryKey: qk.admin.audit(slug, query), queryFn: () => api.admin.audit.list(slug, query) });
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Every admin and member action, newest first" />
      <Input placeholder="Filter by action prefix, e.g. membership. or content." value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="max-w-sm" />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && <AuditTable rows={q.data.data} />}
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />}
    </div>
  );
}
