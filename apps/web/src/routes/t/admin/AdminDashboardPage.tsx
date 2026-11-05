import { ADMIN_SECTIONS, approvalSummary, dashboardTiles, formatCount, type DashboardTile } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { IconChevronRight } from "@/components/icons";
import { Card, ErrorBox, Loading, PageHeader, Stat } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function AdminDashboardPage() {
  const { tenant } = useAdminTenant();
  const base = `/t/${tenant.slug}/admin`;
  const q = useQuery({ queryKey: qk.admin.dashboard(tenant.slug), queryFn: () => api.admin.dashboard(tenant.slug) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? "Failed"} />;
  const { needs, glance } = dashboardTiles(q.data);
  const href = (t: DashboardTile) => {
    const section = ADMIN_SECTIONS.find((s) => s.key === t.section);
    return section ? `${base}/${section.path}${t.query ? `?${new URLSearchParams(t.query)}` : ""}` : null;
  };
  const stat = (t: DashboardTile) => {
    const to = href(t);
    const figure = <Stat key={t.key} label={t.label} value={formatCount(t.value)} hint={t.hint} attention={t.attention} linked={!!to} />;
    return to ? (
      <Link key={t.key} to={to} className="block rounded-xl">
        {figure}
      </Link>
    ) : (
      figure
    );
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle={`${tenant.name} at a glance`}
        actions={
          <Link to={`${base}/analytics`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Growth and activity charts
            <IconChevronRight size={16} />
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">{needs.map(stat)}</div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{glance.map(stat)}</div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-slate-600">
        <p>
          {approvalSummary(tenant.settings).map((part, i) =>
            part.strong ? (
              <strong key={i} className="text-slate-900">
                {part.text}
              </strong>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
        <Link to={`${base}/settings`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          Settings
          <IconChevronRight size={16} />
        </Link>
      </Card>
    </div>
  );
}
