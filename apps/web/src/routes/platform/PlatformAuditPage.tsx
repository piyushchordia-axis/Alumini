import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AuditTable } from "@/components/admin/AuditTable";
import { ErrorBox, Input, Loading, PageHeader, Pagination } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function PlatformAuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const query = { page, pageSize: 50, action: action || undefined };
  const q = useQuery({ queryKey: qk.platform.audit(query), queryFn: () => api.platform.audit.list(query) });
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Platform-wide, newest first" />
      <Input placeholder="Filter by action prefix, e.g. platform." value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="max-w-sm" />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && <AuditTable rows={q.data.data} />}
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />}
    </div>
  );
}
