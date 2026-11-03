import type { AdminChatReportDto, AdminChatReportViewDto, ChatBlockDto, ChatLastMessageDto, ChatMemberDto, ChatMessageDto, ChatReportDto, PlatformChatReportDto } from "@illuminize/shared";
import type { ChatBlockRow, ChatMessageRow, ChatSender, MessageWithSender } from "../repositories/chat.repo";
import type { ChatReportQueueRow, ChatReportRow, FoundChatReport } from "../repositories/chatReports.repo";

export const toChatMemberDto = (m: ChatSender): ChatMemberDto => ({ id: m.id, fullName: m.fullName, avatarUrl: m.avatarUrl });

/**
 * What a message's sender shows as, and what of its text: a sender this member blocked in a group loses their name, and
 * their own words, though a system line keeps its fixed text, which names nobody.
 */
function shownSenderAndBody(row: ChatMessageRow, sender: ChatSender | null, redacted: boolean): { sender: ChatMemberDto | null; body: string | null } {
  if (row.removedAt) return { sender: redacted || !sender ? null : toChatMemberDto(sender), body: null };
  if (redacted) return { sender: null, body: row.kind === "SYSTEM" ? row.body : null };
  return { sender: sender ? toChatMemberDto(sender) : null, body: row.body };
}

/**
 * A message as `viewerMembershipId` sees it. `withheld` is never serialized, and neither is anything else that would differ
 * for its sender. A removed message keeps its row and loses its text, which only that report's audited view can read.
 * `redacted` is for a group member who blocked its sender (see redactedSendersFor).
 */
export function toChatMessageDto(row: ChatMessageRow, sender: ChatSender | null, viewerMembershipId: string | null, redacted = false): ChatMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    kind: row.kind,
    ...shownSenderAndBody(row, sender, redacted),
    removed: !!row.removedAt,
    redacted,
    meta: row.meta ?? null,
    clientKey: row.senderMembershipId === viewerMembershipId ? row.clientKey : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** An inbox row's preview. Only a group's names its sender, because in a direct thread it's one of the two of them. */
export function toChatLastMessageDto(row: ChatMessageRow, sender: ChatSender | null, viewerMembershipId: string, opts: { inGroup: boolean; redacted: boolean }): ChatLastMessageDto {
  const shown = shownSenderAndBody(row, sender, opts.redacted);
  return {
    seq: row.seq,
    kind: row.kind,
    body: shown.body,
    mine: row.senderMembershipId === viewerMembershipId,
    sender: opts.inGroup ? shown.sender : null,
    redacted: opts.redacted,
    createdAt: row.createdAt.toISOString(),
  };
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
