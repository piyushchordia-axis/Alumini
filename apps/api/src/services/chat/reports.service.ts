import type { ChatReportCreateInput, ChatReportDto } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient } from "../../db/client";
import { toChatReportDto } from "../../dto/chat.dto";
import { AppError } from "../../lib/errors";
import { runInTransaction } from "../../lib/transaction";
import { findBlockedByMember, findMessageInTenant, findParticipant, reportContextIds, type ConversationRow } from "../../repositories/chat.repo";
import { findGroupById } from "../../repositories/chatGroups.repo";
import { insertChatReport } from "../../repositories/chatReports.repo";
import type { TenantContext } from "../../types/request";
import { recordAuditStrict } from "../audit.service";
import { notifyTenantAdmins } from "../notifications/notification.service";
import type { ChatActor } from "./chat.service";
import { isGroupLive } from "./common";

const notFound = () => AppError.notFound("Message not found");

/** Senders whose messages this member sees redacted. Blocking someone hides what they say in a shared group, never in a 1:1, where the history stays. */
async function redactedSenderIds(db: DbClient, conversation: Pick<ConversationRow, "kind">, membershipId: string): Promise<string[]> {
  return conversation.kind === "GROUP" ? findBlockedByMember(db, membershipId) : [];
}

/**
 * Files a report on a message the member can see. A withheld message answers like one that doesn't exist, for everyone but
 * its sender, who gets the refusal for their own message, so filing can't reveal that anything was withheld. Freezes what an
 * admin may be shown. Admins hear that a report exists and nothing it says, and the reporter stays out of the audit log.
 */
export async function reportMessage(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, messageId: string, input: ChatReportCreateInput): Promise<ChatReportDto> {
  const tenantId = tenantCtx.tenant.id;
  const me = actor.membership.id;
  const row = await runInTransaction(ctx, async (tx) => {
    const found = await findMessageInTenant(tx, tenantId, messageId);
    if (!found) throw notFound();
    const { message, conversation } = found;
    const participant = await findParticipant(tx, conversation.id, me);
    if (participant?.state !== "ACTIVE" || message.seq <= participant.joinedSeq) throw notFound();
    // A group moderation has hidden can't be read by its members, so there's nothing there for them to report.
    if (conversation.kind === "GROUP") {
      const group = await findGroupById(tx, tenantId, conversation.id);
      if (!group || (!isGroupLive(group) && group.ownerMembershipId !== me)) throw notFound();
    }
    if (message.senderMembershipId === me) throw AppError.badRequest("You can't report your own message");
    if (message.withheld) throw notFound();
    const redacted = await redactedSenderIds(tx, conversation, me);
    if (message.senderMembershipId && redacted.includes(message.senderMembershipId)) throw notFound();
    if (message.kind === "SYSTEM") throw AppError.badRequest("This message can't be reported");
    if (message.removedAt) throw AppError.conflict("This message has already been removed");

    const report = await insertChatReport(tx, {
      tenantId,
      targetKind: "MESSAGE",
      targetId: message.id,
      conversationId: conversation.id,
      reporterMembershipId: me,
      reportedMembershipId: message.senderMembershipId,
      reason: input.reason,
      details: input.details ?? null,
      contextMessageIds: await reportContextIds(tx, message, participant, redacted),
    });
    if (!report) throw AppError.conflict("You have already reported this message");

    await recordAuditStrict(tx, { tenantId, action: "chat_report.file", targetType: "chat_report", targetId: report.id, metadata: { reason: report.reason, targetKind: report.targetKind } });
    await notifyTenantAdmins(ctx, { tenantId, type: "CHAT_REPORT_FILED", title: "A chat message was reported", data: { chatReportId: report.id }, excludeMembershipIds: [me, message.senderMembershipId] }, tx);
    return report;
  });
  return toChatReportDto(row);
}
