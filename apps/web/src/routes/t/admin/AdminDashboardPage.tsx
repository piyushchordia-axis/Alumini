import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
  const d = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle={`${tenant.name} at a glance`}
        actions={
          <Link to={`${base}/analytics`} className="text-sm font-medium text-primary hover:underline">
            Growth and activity charts →
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link to={`${base}/members?status=PENDING`}>
          <Stat label="Pending members" value={d.pendingMembers} hint="Awaiting your approval" />
        </Link>
        <Link to={`${base}/moderation`}>
          <Stat label="Content to review" value={d.pendingContent} hint="Posts, jobs, funding, events, businesses" />
        </Link>
        <Link to={`${base}/reports`}>
          <Stat label="Open reports" value={d.openReports} hint="Flagged by members" />
        </Link>
        <Stat label="Approved members" value={d.approvedMembers} hint={`${d.activeMembersLast30d} active in the last 30 days`} />
        <Stat label="New members (30d)" value={d.newMembersLast30d} />
        <Stat label="Posts (7d)" value={d.postsLast7d} />
        <Stat label="Upcoming events" value={d.upcomingEvents} />
        <Stat label="Suspended / rejected" value={`${d.suspendedMembers} / ${d.rejectedMembers}`} />
      </div>
      <Card className="p-5 text-sm text-slate-600">
        <h2 className="mb-2 font-semibold text-slate-900">How approvals work here</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            New members are <strong>{tenant.settings.memberApprovalMode === "ADMIN_APPROVAL" ? "held until you approve them" : "approved automatically"}</strong>.
          </li>
          <li>
            Posts, jobs, funding, events and businesses are <strong>{/* moderation mode is not public; the settings page shows it */ "moderated per your settings"}</strong>. Your own posts are always published immediately.
          </li>
          <li>
            Change either behaviour under <Link to={`${base}/settings`} className="text-primary underline">Settings</Link>.
          </li>
        </ul>
      </Card>
    </div>
  );
}
