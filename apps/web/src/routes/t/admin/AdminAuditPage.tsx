import { AUDIT_ACTION_FILTERS, AUDIT_ACTION_MAX, AUDIT_LOG_INTRO, AUDIT_SHOW_ALL, auditEmptyText, auditEmptyTitle, listUpdating, listView, parseAuditAction } from "@illuminize/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AuditTable } from "@/components/admin/AuditTable";
import { KeptResults } from "@/components/common/UpdatingNote";
import { Button, EmptyState, ErrorBox, Input, ListSkeleton, PageHeader, Pagination } from "@/components/ui";
import { IconAudit, IconSearch } from "@/components/icons";
import { useAddressRestarts } from "@/hooks/useAddressRestarts";
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
  const { restarts, onWrite } = useAddressRestarts(inAddress);
  return <AuditLog key={restarts} initialAction={inAddress} onWrite={onWrite} />;
}

/**
 * The log itself. Typing waits until it stops before asking the API, and the rows on screen stay, faded under "Updating
 * results…", while the next filter or page loads: they have no actions to go stale. `onWrite` hears each filter just
 * before it goes into the address.
 */
function AuditLog({ initialAction, onWrite }: { initialAction: string; onWrite: (action: string) => void }) {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const [action, setAction] = useState(initialAction);
  const filter = useDebounced(action.trim());
  const filterBox = useRef<HTMLInputElement>(null);
  const showAll = () => {
    setAction("");
    filterBox.current?.focus();
  };
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
  // An empty answer kept while the next filter's loads would name the wrong filter, so the outline shows (listView).
  const rows = q.data?.data ?? [];
  const view = listView(q, rows.length);
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle={AUDIT_LOG_INTRO} />
      <div role="group" aria-label="Show actions" className="flex flex-wrap gap-2">
        {chip("", "All")}
        {AUDIT_ACTION_FILTERS.map((f) => chip(f.prefix, f.label))}
      </div>
      <Input
        ref={filterBox}
        aria-label="Filter by action"
        placeholder="Action starts with…, e.g. membership. or content."
        value={action}
        maxLength={AUDIT_ACTION_MAX}
        autoComplete="off"
        onChange={(e) => setAction(e.target.value)}
        className="max-w-sm"
      />
      {view === "loading" && <ListSkeleton shape="table" />}
      {view === "error" && <ErrorBox error={q.error} />}
      {view === "empty" && (
        <EmptyState
          icon={filter ? <IconSearch /> : <IconAudit />}
          title={auditEmptyTitle(filter)}
          description={auditEmptyText(filter)}
          live={!!filter}
          action={
            // The phone's filter box has its own Clear search, so only the web offers this here.
            filter && <Button onClick={showAll}>{AUDIT_SHOW_ALL}</Button>
          }
        />
      )}
      {view === "rows" && (
        <KeptResults updating={listUpdating(q, rows.length)}>
          <AuditTable rows={rows} memberHref={(id) => `/t/${slug}/admin/members/${id}`} />
        </KeptResults>
      )}
      {/* Not under the outline of a kept empty answer, but still on an empty page past the last, to offer Previous. */}
      {q.data && view !== "loading" && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />}
    </div>
  );
}
