import type { DashboardDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { countUpcomingEvents } from "../repositories/events.repo";
import { countActiveMembersSince, countMembersByStatus, countNewMembersSince } from "../repositories/memberships.repo";
import { countPendingContent } from "../repositories/moderation.repo";
import { countPostsSince } from "../repositories/posts.repo";
import { countOpenReports } from "../repositories/reports.repo";

const DAY = 24 * 60 * 60 * 1000;

export async function getTenantDashboard(ctx: AppContext, tenantId: string): Promise<DashboardDto> {
  const now = Date.now();
  const [byStatus, newMembers30d, active30d, pendingContent, openReports, upcomingEvents, postsLast7d] = await Promise.all([
    countMembersByStatus(ctx.db, tenantId),
    countNewMembersSince(ctx.db, tenantId, new Date(now - 30 * DAY)),
    countActiveMembersSince(ctx.db, tenantId, new Date(now - 30 * DAY)),
    countPendingContent(ctx.db, tenantId),
    countOpenReports(ctx.db, tenantId),
    countUpcomingEvents(ctx.db, tenantId),
    countPostsSince(ctx.db, tenantId, new Date(now - 7 * DAY)),
  ]);
  return {
    pendingMembers: byStatus.PENDING,
    approvedMembers: byStatus.APPROVED,
    rejectedMembers: byStatus.REJECTED,
    suspendedMembers: byStatus.SUSPENDED,
    newMembersLast30d: newMembers30d,
    activeMembersLast30d: active30d,
    pendingContent,
    openReports,
    upcomingEvents,
    postsLast7d,
  };
}
