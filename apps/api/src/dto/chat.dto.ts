import type {
  AdminChatAttachmentDto,
  AdminChatReportDto,
  AdminChatReportViewDto,
  ChatAttachmentDto,
  ChatAttachmentLinkDto,
  ChatAttachmentSummaryDto,
  ChatBlockDto,
  ChatLastMessageDto,
  ChatMemberDto,
  ChatMessageDto,
  ChatReportDto,
  PlatformChatReportDto,
} from "@illuminize/shared";
import type { ChatBlockRow, ChatMessageRow, ChatSender, MessageWithSender } from "../repositories/chat.repo";
import type { ChatAttachmentRow, ChatAttachmentSummary } from "../repositories/chatAttachments.repo";
import type { ChatReportQueueRow, ChatReportRow, EscalatedChatReportRow, FoundChatReport } from "../repositories/chatReports.repo";

export const toChatMemberDto = (m: ChatSender): ChatMemberDto => ({ id: m.id, fullName: m.fullName, avatarUrl: m.avatarUrl, startYear: m.startYear, batchYear: m.batchYear });

/** Field by field: never its storage keys, its uploader or its conversation, and never a link, which only the links route signs. */
export const toChatAttachmentDto = (row: ChatAttachmentRow): ChatAttachmentDto => ({
  id: row.id,
  kind: row.kind,
  name: row.kind === "FILE" ? row.fileName : null,
  contentType: row.contentType,
  size: row.byteSize,
  width: row.width,
  height: row.height,
});

/** Whose photos and files a member sees with a message: none on a removed message, or one redacted for them. */
const attachmentsShown = (row: ChatMessageRow, redacted: boolean) => !row.removedAt && !redacted;

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
 * `redacted` is for a group member who blocked its sender (see redactedSendersFor). `attachments` are its rows, in order;
 * a removed or redacted message shows none, as it shows no text.
 */
export function toChatMessageDto(row: ChatMessageRow, sender: ChatSender | null, viewerMembershipId: string | null, redacted = false, attachments: readonly ChatAttachmentRow[] = []): ChatMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    kind: row.kind,
    ...shownSenderAndBody(row, sender, redacted),
    removed: !!row.removedAt,
    redacted,
    meta: row.meta ?? null,
    attachments: attachmentsShown(row, redacted) ? attachments.map(toChatAttachmentDto) : [],
    clientKey: row.senderMembershipId === viewerMembershipId ? row.clientKey : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * An inbox row's preview. Only a group's names its sender, because in a direct thread it's one of the two of them. Its
 * photos and files are counted, never named but for a file's own name, and not at all where its text doesn't show.
 */
export function toChatLastMessageDto(
  row: ChatMessageRow,
  sender: ChatSender | null,
  viewerMembershipId: string,
  opts: { inGroup: boolean; redacted: boolean; attachments?: ChatAttachmentSummary | null },
): ChatLastMessageDto {
  const shown = shownSenderAndBody(row, sender, opts.redacted);
  return {
    seq: row.seq,
    kind: row.kind,
    body: shown.body,
    mine: row.senderMembershipId === viewerMembershipId,
    sender: opts.inGroup ? shown.sender : null,
    redacted: opts.redacted,
    attachments: opts.attachments && attachmentsShown(row, opts.redacted) ? toChatAttachmentSummaryDto(opts.attachments) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const toChatAttachmentSummaryDto = (s: ChatAttachmentSummary): ChatAttachmentSummaryDto => ({ photos: s.photos, files: s.files, fileName: s.fileName });

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

export function toPlatformChatReportDto(row: EscalatedChatReportRow): PlatformChatReportDto {
  return { ...toAdminChatReportDto(row), tenant: row.tenant, basis: row.reportedIsAdmin ? "REPORTED_ADMIN" : "NO_ELIGIBLE_ADMIN", needsOtherStaff: row.needsOtherStaff, noStaffCanTake: row.noStaffCanTake };
}

/** Signed links to one attachment's copies, which the caller has just made for this view or this member. */
export type ChatAttachmentLinks = Omit<ChatAttachmentLinkDto, "id" | "messageId">;

/** The photos and files of a report's messages, with the links the view signed and when they all stop working. */
export interface ReportViewFiles {
  byMessage: ReadonlyMap<string, readonly ChatAttachmentRow[]>;
  links: ReadonlyMap<string, ChatAttachmentLinks>;
  expiresAt: string | null;
}

const toAdminChatAttachmentDto = (row: ChatAttachmentRow, links: ChatAttachmentLinks): AdminChatAttachmentDto => ({ ...toChatAttachmentDto(row), url: links.url, thumbUrl: links.thumbUrl, downloadUrl: links.downloadUrl });

/**
 * Field by field, so the row's removal note, who removed it, its client key and whether it was withheld can't come along.
 * Nor can its seq, whose size tells an admin how long the thread is and whose gaps show messages withheld from it. The
 * order of the array is the order of the thread. A removed message keeps its photos and files here, as it keeps its text.
 */
export function toAdminChatReportViewDto(found: FoundChatReport, messages: MessageWithSender[], files: ReportViewFiles): AdminChatReportViewDto {
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
      attachments: (files.byMessage.get(message.id) ?? []).flatMap((row) => {
        const links = files.links.get(row.id);
        return links ? [toAdminChatAttachmentDto(row, links)] : [];
      }),
      createdAt: message.createdAt.toISOString(),
    })),
    filesExpireAt: files.expiresAt,
  };
}
