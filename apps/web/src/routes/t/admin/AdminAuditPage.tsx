import { AUDIT_ACTION_FILTERS, AUDIT_ACTION_MAX, AUDIT_LOG_INTRO, auditEmptyTitle, parseAuditAction } from "@illuminize/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AuditTable } from "@/components/admin/AuditTable";
import { EmptyState, ErrorBox, Input, Loading, PageHeader, Pagination } from "@/components/ui";
import { IconAudit } from "@/components/icons";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { useDebounced } from "@/hooks/useDebounced";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/**
 * Every admin and member action at the institution, newest first, filtered by a family of actions (a chip) or by any
 * prefix typed, kept in the address as ?action= so a reload or a shared link keeps it. The log writes the address as
 * the filter changes; when the address changes from anywhere else while the page stays open (the console's own Audit
 * log link, Back to a filter left behind), the log starts again from it, as the phone app's fresh screen does, rather
 * than writing its own filter back over it.
 */
export function AdminAuditPage() {
  const [params] = useSearchParams();
  const inAddress = parseAuditAction(params.get("action"));
  // What the log itself last wrote to the address (or started from), and the address as last seen, with a count of the
  // times it changed from elsewhere, which starts the log again.
  const [written, setWritten] = useState(inAddress);
  const [seen, setSeen] = useState({ action: inAddress, restarts: 0 });
  if (seen.action !== inAddress) {
    const fromElsewhere = inAddress !== written;
    setSeen({ action: inAddress, restarts: fromElsewhere ? seen.restarts + 1 : seen.restarts });
    if (fromElsewhere) setWritten(inAddress);
  }
  return <AuditLog key={seen.restarts} initialAction={inAddress} onWrite={setWritten} />;
}

/**
 * The log itself. Typing waits until it stops before asking the API, and the rows on screen stay while the next filter
 * loads: they have no actions to go stale. `onWrite` hears each filter just before it goes into the address.
 */
function AuditLog({ initialAction, onWrite }: { initialAction: string; onWrite: (action: string) => void }) {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const [action, setAction] = useState(initialAction);
  const filter = useDebounced(action.trim());
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (parseAuditAction(params.get("action")) === filter) return;
    const next = new URLSearchParams(params);
    if (filter) next.set("action", filter);
    else next.delete("action");
    onWrite(filter);
    setParams(next, { replace: true });
  }, [filter, params, setParams, onWrite]);
  // A new filter starts at its first page.
  const [shownFilter, setShownFilter] = useState(filter);
  if (shownFilter !== filter) {
    setShownFilter(filter);
    setPage(1);
  }
  const query = { page, pageSize: 50, action: filter || undefined };
  const q = useQuery({ queryKey: qk.admin.audit(slug, query), queryFn: () => api.admin.audit.list(slug, query), placeholderData: keepPreviousData });
  const chosen = action.trim();
  const chip = (value: string, label: string) => (
    <button
      key={value || "all"}
      type="button"
      aria-pressed={chosen === value}
      onClick={() => setAction(value)}
      className={clsx(
        "min-h-11 rounded-full border px-3 text-sm transition sm:min-h-9",
        chosen === value ? "border-primary bg-primary text-on-primary" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
      )}
    >
      {label}
    </button>
  );
  // An empty answer kept while the next filter's loads would name the wrong filter, as on the phone app.
  const emptyNow = !!q.data && q.data.data.length === 0;
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle={AUDIT_LOG_INTRO} />
      <div role="group" aria-label="Show actions" className="flex flex-wrap gap-2">
        {chip("", "All")}
        {AUDIT_ACTION_FILTERS.map((f) => chip(f.prefix, f.label))}
      </div>
      <Input
        aria-label="Filter by action"
        placeholder="Action starts with…, e.g. membership. or content."
        value={action}
        maxLength={AUDIT_ACTION_MAX}
        autoComplete="off"
        onChange={(e) => setAction(e.target.value)}
        className="max-w-sm"
      />
      {(q.isLoading || (emptyNow && q.isPlaceholderData)) && <Loading />}
      {q.error && !q.data && <ErrorBox error={q.error} />}
      {emptyNow ? (
        !q.isPlaceholderData && <EmptyState icon={<IconAudit size={32} />} title={auditEmptyTitle(filter)} />
      ) : q.data ? (
        <div className={clsx(q.isPlaceholderData && "opacity-60")}>
          <AuditTable rows={q.data.data} memberHref={(id) => `/t/${slug}/admin/members/${id}`} />
        </div>
      ) : null}
      {q.data && !(emptyNow && q.isPlaceholderData) && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />}
    </div>
  );
}
