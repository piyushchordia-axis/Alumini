import { AUDIT_SHOW_ALL, auditEmptyTitle } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AuditTable } from "@/components/admin/AuditTable";
import { IconAudit, IconSearch } from "@/components/icons";
import { Button, EmptyState, ErrorBox, Input, Loading, PageHeader, Pagination } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function PlatformAuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const filter = action.trim();
  const filterBox = useRef<HTMLInputElement>(null);
  const query = { page, pageSize: 50, action: filter || undefined };
  const q = useQuery({ queryKey: qk.platform.audit(query), queryFn: () => api.platform.audit.list(query) });
  const showAll = () => {
    setAction("");
    setPage(1);
    filterBox.current?.focus();
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Platform-wide, newest first" />
      <Input ref={filterBox} aria-label="Filter by action" placeholder="Filter by action prefix, e.g. platform." value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="max-w-sm" />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data &&
        (q.data.data.length === 0 ? (
          // Its own box rather than AuditTable's, as on the institution's log: this is the whole page's list.
          <EmptyState
            icon={filter ? <IconSearch /> : <IconAudit />}
            title={auditEmptyTitle(filter)}
            description={filter ? "Try a shorter start." : "Actions at every institution, and what Illuminize staff do, are recorded here."}
            live={!!filter}
            action={filter && <Button onClick={showAll}>{AUDIT_SHOW_ALL}</Button>}
          />
        ) : (
          <AuditTable rows={q.data.data} />
        ))}
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />}
    </div>
  );
}
