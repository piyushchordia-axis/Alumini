import { NEEDS_OTHER_STAFF_TEXT, type AdminChatReportDto, type AdminChatReportViewDto, type AdminChatReportsQuery, type ChatReportResolveInput, type PlatformChatReportDto } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient, Tx } from "../../db/client";
import { toAdminChatReportDto, toAdminChatReportViewDto, toPlatformChatReportDto } from "../../dto/chat.dto";
import { AppError } from "../../lib/errors";
import { buildPage, type Page } from "../../lib/pagination";
import { runInTransaction } from "../../lib/transaction";
import { limitLockWait, lockConversation, markMessageRemoved } from "../../repositories/chat.repo";
import { chatReportContext, closeChatReport, closeOpenReportsOnMessage, findChatReport, listChatReports, listEscalatedChatReports, lockChatReport, type ChatReportRow, type ChatReportScope, type FoundChatReport } from "../../repositories/chatReports.repo";
import type { AuthContext, MembershipRow, TenantContext } from "../../types/request";
import { recordAuditStrict, type AuditEntry } from "../audit.service";
import { notify } from "../notifications/notification.service";
import { publishRemoved } from "./fanout";

export interface ChatReportViewer extends AuthContext {
  membership: MembershipRow | null;
  ip?: string;
}

/**
 * requireTenantAdmin lets all Illuminize staff through, and these routes hold them to what's escalated. Being staff decides
 * that alone, whatever membership they hold here, because staff can give themselves the admin role with a single request.
 */
export const chatReportScope = (viewer: ChatReportViewer): ChatReportScope => ({ viewerUserId: viewer.userId, escalatedOnly: viewer.isPlatformAdmin });

const notFound = () => AppError.notFound("Report not found");

/**
 * A report this viewer may act on. Anyone it names gets what a report that doesn't exist gets, so an id can't confirm one.
 * A member of staff who changed the institution's admins after it was filed, which may be what made it staff's, leaves it
 * to another member of staff.
 */
async function reachableReport(db: DbClient, tenantId: string, id: string, viewer: ChatReportViewer): Promise<FoundChatReport> {
  const found = await findChatReport(db, tenantId, id, viewer.userId);
  if (!found || found.named) throw notFound();
  if (viewer.isPlatformAdmin && !found.escalated) throw AppError.forbidden("This report is for the institution's own admins");
  if (viewer.isPlatformAdmin && found.rosterChangedByViewer) throw AppError.forbidden(NEEDS_OTHER_STAFF_TEXT, "NEEDS_OTHER_STAFF");
  return found;
}

/**
 * Why this viewer could reach the report. Escalation follows who is an admin at the moment of asking, and staff can change
 * that, so this lets a staff member's action be checked against any role change made just before it.
 */
const accessBasis = (viewer: ChatReportViewer, found: FoundChatReport) => (!viewer.isPlatformAdmin ? "tenant_admin" : found.reportedIsAdmin ? "staff_reported_admin" : "staff_no_eligible_admin");

/** Carries ids and counts, never a body, a note or a reporter's details. */
function auditEntry(tenantId: string, viewer: ChatReportViewer, action: string, reportId: string, metadata: Record<string, unknown>): AuditEntry {
  return { tenantId, actorUserId: viewer.userId, actorMembershipId: viewer.membership?.id ?? null, action, targetType: "chat_report", targetId: reportId, metadata, ip: viewer.ip };
}

export async function listAdminChatReports(ctx: AppContext, tenantId: string, viewer: ChatReportViewer, query: AdminChatReportsQuery): Promise<Page<AdminChatReportDto>> {
  const { rows, total } = await listChatReports(ctx.db, tenantId, chatReportScope(viewer), query);
  return buildPage(rows.map(toAdminChatReportDto), query.page, query.pageSize, total);
}

export async function listPlatformChatReports(ctx: AppContext, viewerUserId: string, query: AdminChatReportsQuery): Promise<Page<PlatformChatReportDto>> {
  const { rows, total } = await listEscalatedChatReports(ctx.db, viewerUserId, query);
  return buildPage(rows.map(toPlatformChatReportDto), query.page, query.pageSize, total);
}

/**
 * Reads a report's messages and records that it happened in one transaction, so a view that can't be audited returns an
 * error and no text. Each call writes its own row. A POST, because a GET could be refetched by a client cache and write
 * audit rows nobody caused.
 */
export async function viewChatReport(ctx: AppContext, tenantCtx: TenantContext, viewer: ChatReportViewer, id: string): Promise<AdminChatReportViewDto> {
  const tenantId = tenantCtx.tenant.id;
  return runInTransaction(ctx, async (tx) => {
    const found = await reachableReport(tx, tenantId, id, viewer);
    const messages = await chatReportContext(tx, found.report);
    await recordAuditStrict(tx, auditEntry(tenantId, viewer, "chat_report.view", id, { access: accessBasis(viewer, found), targetKind: found.report.targetKind, conversationId: found.report.conversationId, messageIds: messages.map((m) => m.message.id), messageCount: messages.length }));
    return toAdminChatReportViewDto(found, messages);
  });
}

/**
 * Takes a report for closing, or finds it already handled. The conversation goes first, the order a send and an account
 * deletion use, which also lines up two admins closing different reports on one message so they can't deadlock.
 */
async function lockOpenReport(tx: Tx, tenantId: string, id: string, viewer: ChatReportViewer): Promise<FoundChatReport> {
  await limitLockWait(tx);
  const found = await reachableReport(tx, tenantId, id, viewer);
  if (found.report.conversationId) await lockConversation(tx, tenantId, found.report.conversationId);
  const report = await lockChatReport(tx, tenantId, id);
  if (!report) throw notFound();
  if (report.status !== "OPEN") throw AppError.invalidTransition("This report has already been handled");
  return { ...found, report };
}

/**
 * Turns the message into a tombstone for everyone in the thread, and tells its sender in fixed words. Their copy of the note
 * stays in the app, as a removed post's does, and the body stays on the row for this report's view alone. A second removal
 * finds nothing to change, so it tells nobody.
 */
async function removeReportedMessage(ctx: AppContext, tx: Tx, tenantCtx: TenantContext, viewer: ChatReportViewer, report: ChatReportRow, note: string | null): Promise<void> {
  const { id: tenantId, slug } = tenantCtx.tenant;
  const message = await markMessageRemoved(tx, tenantId, report.targetId, { removedByUserId: viewer.userId, removalNote: note });
  if (!message) return;
  await publishRemoved(ctx, tx, slug, message);
  if (message.senderMembershipId) {
    await notify(ctx, { tenantId, recipientMembershipIds: [message.senderMembershipId], type: "CHAT_MESSAGE_REMOVED", title: "A message you sent was removed", body: note, data: { conversationId: message.conversationId, messageId: message.id } }, tx);
  }
}

export async function resolveChatReport(ctx: AppContext, tenantCtx: TenantContext, viewer: ChatReportViewer, id: string, input: ChatReportResolveInput): Promise<AdminChatReportDto> {
  const tenantId = tenantCtx.tenant.id;
  const note = input.note ?? null;
  return runInTransaction(ctx, async (tx) => {
    const found = await lockOpenReport(tx, tenantId, id, viewer);
    const { report } = found;
    if (input.action === "REMOVE_MESSAGE" && report.targetKind !== "MESSAGE") throw AppError.badRequest("Only a reported message can be removed");
    const closing = { status: "RESOLVED" as const, resolutionAction: input.action, resolvedByUserId: viewer.userId, resolvedAt: new Date() };
    const closed = await closeChatReport(tx, tenantId, id, { ...closing, resolutionNote: note });
    const metadata = { access: accessBasis(viewer, found), action: input.action, targetKind: report.targetKind, targetId: report.targetId };
    await recordAuditStrict(tx, auditEntry(tenantId, viewer, "chat_report.resolve", id, metadata));
    if (input.action === "REMOVE_MESSAGE") {
      await removeReportedMessage(ctx, tx, tenantCtx, viewer, report, note);
      // Staff leave open any they must leave to another member of staff, who can close them as the message is gone.
      const others = await closeOpenReportsOnMessage(tx, tenantId, report.targetId, { ...closing, resolutionNote: "auto: message removed" }, viewer.isPlatformAdmin ? viewer.userId : undefined);
      // One row each, so that each is hidden from whoever its own report names.
      for (const other of others) {
        const entry = auditEntry(tenantId, viewer, "chat_report.resolve", other.id, { ...metadata, viaReportId: id });
        // No audit row names a report's reporter as an actor, and the admin acting may have reported this message too. viaReportId still leads to who acted.
        await recordAuditStrict(tx, other.reporterMembershipId === viewer.membership?.id ? { ...entry, actorUserId: null, actorMembershipId: null, ip: null } : entry);
      }
    }
    return toAdminChatReportDto({ ...found, report: closed });
  });
}

export async function dismissChatReport(ctx: AppContext, tenantCtx: TenantContext, viewer: ChatReportViewer, id: string, note?: string | null): Promise<AdminChatReportDto> {
  const tenantId = tenantCtx.tenant.id;
  return runInTransaction(ctx, async (tx) => {
    const found = await lockOpenReport(tx, tenantId, id, viewer);
    const closed = await closeChatReport(tx, tenantId, id, { status: "DISMISSED", resolutionAction: null, resolvedByUserId: viewer.userId, resolvedAt: new Date(), resolutionNote: note ?? null });
    await recordAuditStrict(tx, auditEntry(tenantId, viewer, "chat_report.dismiss", id, { access: accessBasis(viewer, found), targetKind: found.report.targetKind, targetId: found.report.targetId }));
    return toAdminChatReportDto({ ...found, report: closed });
  });
}
