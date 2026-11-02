import type { ChatBlockDto, ChatLastMessageDto, ChatMemberDto, ChatMessageDto, ChatReportDto } from "@illuminize/shared";
import type { ChatBlockRow, ChatMessageRow, ChatSender } from "../repositories/chat.repo";
import type { ChatReportRow } from "../repositories/chatReports.repo";

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
