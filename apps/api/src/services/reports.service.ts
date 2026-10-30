import type { AdminReportDto, AdminReportsQuery, CursorPage, ReportCreateInput, ReportDto, ReportResolveInput } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toAdminReportDto, toReportDto } from "../dto/content.dto";
import { AppError } from "../lib/errors";
import { buildPage, type Page } from "../lib/pagination";
import { findModerationItem } from "../repositories/moderation.repo";
import { findReportById, insertReport, listReportsForAdmin, listReportsForReporter, resolveOpenReportsForContent, updateReport } from "../repositories/reports.repo";
import type { AuthContext, TenantContext } from "../types/request";
import { recordAudit } from "./audit.service";
import { contentLabel, type ContentActor } from "./content.common";
import { canViewContent } from "./moderation";
import { moderateContent } from "./moderation.service";
import { notifyTenantAdmins } from "./notifications/notification.service";

export async function createReport(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: ReportCreateInput): Promise<ReportDto> {
  const tenantId = tenantCtx.tenant.id;
  const item = await findModerationItem(ctx.db, tenantId, input.contentType, input.contentId);
  if (!item || !canViewContent(item.moderationStatus, { isAuthor: item.authorMembershipId === actor.membership.id, isAdmin: false })) {
    throw AppError.notFound(`${contentLabel(input.contentType)} not found`);
  }
  if (item.authorMembershipId === actor.membership.id) throw AppError.badRequest("You cannot report your own content");
  const row = await insertReport(ctx.db, {
    tenantId,
    reporterMembershipId: actor.membership.id,
    contentType: input.contentType,
    contentId: input.contentId,
    reason: input.reason,
    details: input.details ?? null,
  });
  if (!row) throw AppError.conflict("You have already reported this content");
  await recordAudit(ctx, {
    tenantId,
    actorUserId: actor.userId,
    actorMembershipId: actor.membership.id,
    action: "report.create",
    targetType: input.contentType.toLowerCase(),
    targetId: input.contentId,
    metadata: { reason: input.reason, reportId: row.id },
    ip: actor.ip,
  });
  await notifyTenantAdmins(ctx, {
    tenantId,
    type: "REPORT_FILED",
    title: `${contentLabel(input.contentType)} reported: ${input.reason.toLowerCase()}`,
    body: item.title ?? undefined,
    data: { reportId: row.id, contentType: input.contentType, contentId: input.contentId },
  });
  return toReportDto(row);
}

export async function listMyReports(ctx: AppContext, tenantId: string, actor: ContentActor, query: { cursor?: string; limit: number }): Promise<CursorPage<ReportDto>> {
  const page = await listReportsForReporter(ctx.db, tenantId, actor.membership.id, query);
  return { data: page.data.map(toReportDto), nextCursor: page.nextCursor };
}

export async function listAdminReports(ctx: AppContext, tenantId: string, query: AdminReportsQuery): Promise<Page<AdminReportDto>> {
  const { rows, total } = await listReportsForAdmin(ctx.db, tenantId, query);
  return buildPage(
    rows.map((r) => toAdminReportDto(r.report, r.reporter, r.content)),
    query.page,
    query.pageSize,
    total,
  );
}

interface AdminActor extends AuthContext {
  membershipId?: string | null;
  ip?: string;
}

async function loadOpenReport(ctx: AppContext, tenantId: string, id: string) {
  const report = await findReportById(ctx.db, tenantId, id);
  if (!report) throw AppError.notFound("Report not found");
  if (report.status !== "OPEN") throw AppError.invalidTransition("This report has already been handled");
  return report;
}

export async function resolveReport(ctx: AppContext, tenantCtx: TenantContext, actor: AdminActor, id: string, input: ReportResolveInput): Promise<ReportDto> {
  const tenantId = tenantCtx.tenant.id;
  const report = await loadOpenReport(ctx, tenantId, id);
  if (input.action === "REMOVE_CONTENT") {
    const item = await findModerationItem(ctx.db, tenantId, report.contentType, report.contentId);
    if (item?.moderationStatus === "APPROVED") {
      await moderateContent(ctx, tenantCtx, actor, report.contentType, report.contentId, "remove", input.note ?? "Removed after a member report", { skipReportResolution: true });
    } else if (item?.moderationStatus === "PENDING") {
      await moderateContent(ctx, tenantCtx, actor, report.contentType, report.contentId, "reject", input.note ?? "Rejected after a member report", { skipReportResolution: true });
    }
    await resolveOpenReportsForContent(ctx.db, tenantId, report.contentType, report.contentId, {
      resolvedByUserId: actor.userId,
      resolutionNote: input.note ?? "Content removed",
    });
  } else {
    await updateReport(ctx.db, tenantId, id, { status: "RESOLVED", resolvedAt: new Date(), resolvedByUserId: actor.userId, resolutionNote: input.note ?? null });
  }
  await recordAudit(ctx, {
    tenantId,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId ?? null,
    action: "report.resolve",
    targetType: "report",
    targetId: id,
    metadata: { action: input.action, contentType: report.contentType, contentId: report.contentId },
    ip: actor.ip,
  });
  return toReportDto((await findReportById(ctx.db, tenantId, id))!);
}

export async function dismissReport(ctx: AppContext, tenantCtx: TenantContext, actor: AdminActor, id: string, note?: string | null): Promise<ReportDto> {
  const tenantId = tenantCtx.tenant.id;
  await loadOpenReport(ctx, tenantId, id);
  const row = (await updateReport(ctx.db, tenantId, id, { status: "DISMISSED", resolvedAt: new Date(), resolvedByUserId: actor.userId, resolutionNote: note ?? null }))!;
  await recordAudit(ctx, {
    tenantId,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId ?? null,
    action: "report.dismiss",
    targetType: "report",
    targetId: id,
    ip: actor.ip,
  });
  return toReportDto(row);
}
