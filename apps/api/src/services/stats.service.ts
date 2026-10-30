import type { DashboardDto, PlatformStatsDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toPlatformTenantRowDto } from "../dto/platform.dto";
import { countEvents, countUpcomingEvents } from "../repositories/events.repo";
import { countFunding } from "../repositories/funding.repo";
import { countJobs } from "../repositories/jobs.repo";
import { countActiveMembersGlobal, countActiveMembersSince, countAllMembershipsByStatus, countMembersByStatus, countNewMembersSince } from "../repositories/memberships.repo";
import { countPendingContent } from "../repositories/moderation.repo";
import { countPosts, countPostsSince } from "../repositories/posts.repo";
import { countOpenReports } from "../repositories/reports.repo";
import { countTenantsByStatus, listTenantsForPlatform } from "../repositories/tenants.repo";
import { countUsers } from "../repositories/users.repo";

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


export async function getPlatformStats(ctx: AppContext): Promise<PlatformStatsDto> {
  const [tenantsByStatus, users, membershipsByStatus, posts, jobs, funding, events, active30d, perTenant] = await Promise.all([
    countTenantsByStatus(ctx.db),
    countUsers(ctx.db),
    countAllMembershipsByStatus(ctx.db),
    countPosts(ctx.db),
    countJobs(ctx.db),
    countFunding(ctx.db),
    countEvents(ctx.db),
    countActiveMembersGlobal(ctx.db, new Date(Date.now() - 30 * DAY)),
    listTenantsForPlatform(ctx.db, { page: 1, pageSize: 100 }),
  ]);
  return {
    tenants: { total: Object.values(tenantsByStatus).reduce((a, b) => a + b, 0), byStatus: tenantsByStatus },
    users,
    memberships: membershipsByStatus,
    content: { posts, jobs, funding, events },
    activeMembers30d: active30d,
    perTenant: perTenant.rows.map((r) => toPlatformTenantRowDto(r.tenant, r)),
  };
}
