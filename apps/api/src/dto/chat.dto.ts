import type { AdminChatReportDto, AdminChatReportViewDto, ChatBlockDto, ChatLastMessageDto, ChatMemberDto, ChatMessageDto, ChatReportDto, PlatformChatReportDto } from "@illuminize/shared";
import type { ChatBlockRow, ChatMessageRow, ChatSender, MessageWithSender } from "../repositories/chat.repo";
import type { ChatReportQueueRow, ChatReportRow, FoundChatReport } from "../repositories/chatReports.repo";

export const toChatMemberDto = (m: ChatSender): ChatMemberDto => ({ id: m.id, fullName: m.fullName, avatarUrl: m.avatarUrl });

/**
 * A message as `viewerMembershipId` sees it. `withheld` is never serialized, and neither is anything else that would differ
 * for its sender. A removed message keeps its row and loses its text, which only that report's audited view can read.
 */
export function toChatMessageDto(row: ChatMessageRow, sender: ChatSender | null, viewerMembershipId: string | null): ChatMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    kind: row.kind,
    sender: sender ? toChatMemberDto(sender) : null,
    body: row.removedAt ? null : row.body,
    removed: !!row.removedAt,
    meta: row.meta ?? null,
    clientKey: row.senderMembershipId === viewerMembershipId ? row.clientKey : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toChatLastMessageDto(row: ChatMessageRow, viewerMembershipId: string): ChatLastMessageDto {
  return { seq: row.seq, body: row.removedAt ? null : row.body, mine: row.senderMembershipId === viewerMembershipId, createdAt: row.createdAt.toISOString() };
}

export function toChatBlockDto(block: ChatBlockRow, member: ChatSender): ChatBlockDto {
  return { member: toChatMemberDto(member), createdAt: block.createdAt.toISOString() };
}

export function toChatReportDto(r: ChatReportRow): ChatReportDto {
  return { id: r.id, targetKind: r.targetKind, targetId: r.targetId, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() };
}

export function toAdminChatReportDto({ report, reporter, reported }: ChatReportQueueRow): AdminChatReportDto {
  return {
    id: report.id,
    targetKind: report.targetKind,
    reason: report.reason,
    status: report.status,
    reporter: reporter && toChatMemberDto(reporter),
    reported: reported && toChatMemberDto(reported),
    resolutionAction: report.resolutionAction,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
  };
}

export function toPlatformChatReportDto(row: ChatReportQueueRow & { tenant: { slug: string; name: string } }): PlatformChatReportDto {
  return { ...toAdminChatReportDto(row), tenant: row.tenant };
}

/**
 * Field by field, so the row's removal note, who removed it, its client key and whether it was withheld can't come along.
 * Nor can its seq, whose size tells an admin how long the thread is and whose gaps show messages withheld from it. The
 * order of the array is the order of the thread.
 */
export function toAdminChatReportViewDto(found: FoundChatReport, messages: MessageWithSender[]): AdminChatReportViewDto {
  const { report } = found;
  return {
    ...toAdminChatReportDto(found),
    details: report.details,
    noteSnapshot: report.noteSnapshot,
    resolutionNote: report.resolutionNote,
    messages: messages.map(({ message, sender }) => ({
      id: message.id,
      kind: message.kind,
      sender: sender && toChatMemberDto(sender),
      body: message.body,
      removed: !!message.removedAt,
      isTarget: message.id === report.targetId,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}
