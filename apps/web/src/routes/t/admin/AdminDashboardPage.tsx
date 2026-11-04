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
  const memberMode = tenant.settings.memberApprovalMode === "ADMIN_APPROVAL" ? "held for approval" : "auto-approved";
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

      <div className="grid gap-3 sm:grid-cols-2">
        <Link to={`${base}/members?status=PENDING`} className="block">
          <Stat label="Pending members" value={d.pendingMembers} hint="Needs your decision" />
        </Link>
        <Link to={`${base}/moderation`} className="block">
          <Stat label="Content to review" value={d.pendingContent} hint="Posts, jobs, funding, events, businesses" />
        </Link>
      </div>

      {(d.openReports > 0 || d.openChatReports > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Link to={`${base}/reports`} className="block">
            <Stat label="Open reports" value={d.openReports} hint="Flagged by members" />
          </Link>
          <Link to={`${base}/chat-reports`} className="block">
            <Stat label="Open chat reports" value={d.openChatReports} hint="Private messages members reported" />
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Approved members" value={d.approvedMembers} hint={`${d.activeMembersLast30d} active in 30 days`} />
        <Stat label="New members (30d)" value={d.newMembersLast30d} />
        <Stat label="Posts (7d)" value={d.postsLast7d} />
        <Stat label="Upcoming events" value={d.upcomingEvents} />
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-slate-600">
        <p>
          New members are <strong className="text-slate-900">{memberMode}</strong>. Content follows your moderation settings.
        </p>
        <Link to={`${base}/settings`} className="font-medium text-primary hover:underline">
          Settings →
        </Link>
      </Card>
    </div>
  );
}
