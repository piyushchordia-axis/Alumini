import type { DashboardDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { countActiveMembersSince, countMembersByStatus, countNewMembersSince } from "../repositories/memberships.repo";

const DAY = 24 * 60 * 60 * 1000;

export async function getTenantDashboard(ctx: AppContext, tenantId: string): Promise<DashboardDto> {
  const now = Date.now();
  const [byStatus, newMembers30d, active30d] = await Promise.all([
    countMembersByStatus(ctx.db, tenantId),
    countNewMembersSince(ctx.db, tenantId, new Date(now - 30 * DAY)),
    countActiveMembersSince(ctx.db, tenantId, new Date(now - 30 * DAY)),
  ]);
  return {
    pendingMembers: byStatus.PENDING,
    approvedMembers: byStatus.APPROVED,
    rejectedMembers: byStatus.REJECTED,
    suspendedMembers: byStatus.SUSPENDED,
    newMembersLast30d: newMembers30d,
    activeMembersLast30d: active30d,
    pendingContent: 0,
    openReports: 0,
    upcomingEvents: 0,
    postsLast7d: 0,
  };
}
