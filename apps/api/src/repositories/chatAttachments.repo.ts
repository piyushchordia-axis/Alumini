import { and, asc, eq, getTableColumns, gt, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { DbClient, Tx } from "../db/client";
import { chatAttachments, chatMessages } from "../db/schema";

export type ChatAttachmentRow = typeof chatAttachments.$inferSelect;
export type ChatAttachmentInsert = typeof chatAttachments.$inferInsert;

/** What a conversation list says about a message's attachments, without their rows. */
export interface ChatAttachmentSummary {
  photos: number;
  files: number;
  /** The first file's name, by position, for "File: {name}". */
  fileName: string | null;
}

/** The private storage keys a row holds: the file, and a photo's thumbnail. */
export function chatAttachmentKeys(row: Pick<ChatAttachmentRow, "storageKey" | "thumbKey">): string[] {
  return row.thumbKey ? [row.storageKey, row.thumbKey] : [row.storageKey];
}

/** An upload, unsent (no message) until a send claims it. */
export async function insertChatAttachment(db: DbClient, values: ChatAttachmentInsert): Promise<ChatAttachmentRow> {
  const [row] = await db.insert(chatAttachments).values({ ...values, messageId: null }).returning();
  return row!;
}

export async function findChatAttachmentById(db: DbClient, id: string): Promise<ChatAttachmentRow | undefined> {
  const [row] = await db.select().from(chatAttachments).where(eq(chatAttachments.id, id));
  return row;
}

/**
 * Locks the unsent uploads among `ids` that this member made in this conversation, in id order, for a send to claim. The
 * send compares what comes back with what it was given: anything missing was sent already, swept, or someone else's.
 * Called inside the send's transaction, after the conversation's lock, so a sweep (which skips locked rows) can't take
 * them from under it.
 */
export async function lockChatAttachmentsForClaim(tx: Tx, input: { ids: string[]; conversationId: string; uploaderMembershipId: string }): Promise<ChatAttachmentRow[]> {
  if (input.ids.length === 0) return [];
  return tx
    .select()
    .from(chatAttachments)
    .where(
      and(
        inArray(chatAttachments.id, input.ids),
        eq(chatAttachments.conversationId, input.conversationId),
        eq(chatAttachments.uploaderMembershipId, input.uploaderMembershipId),
        isNull(chatAttachments.messageId),
      ),
    )
    .orderBy(asc(chatAttachments.id))
    .for("update");
}

/** Puts the locked uploads in the message, each at its place in `ids`. */
export async function claimChatAttachments(tx: Tx, input: { ids: string[]; messageId: string }): Promise<ChatAttachmentRow[]> {
  if (input.ids.length === 0) return [];
  // The positions are array indexes, written as literals so Postgres reads them as integers.
  const position = sql`case ${sql.join(
    input.ids.map((id, i) => sql`when ${chatAttachments.id} = ${id} then ${sql.raw(String(i))}`),
    sql` `,
  )} end`;
  return tx
    .update(chatAttachments)
    .set({ messageId: input.messageId, position })
    .where(and(inArray(chatAttachments.id, input.ids), isNull(chatAttachments.messageId)))
    .returning();
}

/** The attachments of these messages, each message's in order. */
export async function findChatAttachmentsByMessageIds(db: DbClient, messageIds: string[]): Promise<ChatAttachmentRow[]> {
  if (messageIds.length === 0) return [];
  return db
    .select()
    .from(chatAttachments)
    .where(inArray(chatAttachments.messageId, messageIds))
    .orderBy(asc(chatAttachments.messageId), asc(chatAttachments.position));
}

/**
 * The attachments of those of `messageIds` in this conversation that the viewer may still open: after they joined, not
 * withheld from them (their own withheld messages they see), not removed, and not from a sender whose messages they see
 * redacted (`redactedSenderIds`, in a group). The rest are left out, never told apart. Each message's in order.
 */
export async function findOpenableChatAttachments(
  db: DbClient,
  input: { conversationId: string; messageIds: string[]; viewerMembershipId: string; joinedSeq: number; redactedSenderIds: string[] },
): Promise<ChatAttachmentRow[]> {
  if (input.messageIds.length === 0) return [];
  const notRedacted = input.redactedSenderIds.length === 0 ? undefined : or(isNull(chatMessages.senderMembershipId), notInArray(chatMessages.senderMembershipId, input.redactedSenderIds));
  return db
    .select(getTableColumns(chatAttachments))
    .from(chatAttachments)
    .innerJoin(chatMessages, eq(chatMessages.id, chatAttachments.messageId))
    .where(
      and(
        eq(chatAttachments.conversationId, input.conversationId),
        eq(chatMessages.conversationId, input.conversationId),
        inArray(chatAttachments.messageId, input.messageIds),
        gt(chatMessages.seq, input.joinedSeq),
        or(eq(chatMessages.withheld, false), eq(chatMessages.senderMembershipId, input.viewerMembershipId)),
        isNull(chatMessages.removedAt),
        notRedacted,
      ),
    )
    .orderBy(asc(chatMessages.seq), asc(chatAttachments.position));
}

/** Counts per message, for the last message of each conversation in a list. Messages with none are left out. */
export async function summarizeChatAttachments(db: DbClient, messageIds: string[]): Promise<Map<string, ChatAttachmentSummary>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({
      messageId: chatAttachments.messageId,
      photos: sql<number>`(count(*) filter (where ${chatAttachments.kind} = 'PHOTO'))::int`,
      files: sql<number>`(count(*) filter (where ${chatAttachments.kind} = 'FILE'))::int`,
      fileName: sql<string | null>`(array_agg(${chatAttachments.fileName} order by ${chatAttachments.position}) filter (where ${chatAttachments.kind} = 'FILE'))[1]`,
    })
    .from(chatAttachments)
    .where(inArray(chatAttachments.messageId, messageIds))
    .groupBy(chatAttachments.messageId);
  return new Map(rows.map((r) => [r.messageId!, { photos: r.photos, files: r.files, fileName: r.fileName }]));
}

/**
 * Unsent uploads from before `before`, oldest first, locked for the sweep that deletes them. Skips rows a send is
 * claiming (it holds them locked), so the sweep never waits on a send or makes one fail halfway.
 */
export async function lockUnsentChatAttachmentsBefore(tx: Tx, before: Date, limit: number): Promise<ChatAttachmentRow[]> {
  return tx
    .select()
    .from(chatAttachments)
    .where(and(isNull(chatAttachments.messageId), lt(chatAttachments.createdAt, before)))
    .orderBy(asc(chatAttachments.createdAt))
    .limit(limit)
    .for("update", { skipLocked: true });
}

/** Deletes rows the caller holds locked; their files go after the commit. */
export async function deleteChatAttachmentsByIds(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.delete(chatAttachments).where(inArray(chatAttachments.id, ids));
}

/**
 * The storage keys of the attachments of these members' withheld messages, which nobody else ever received. Account
 * deletion removes those files, and the rows go with the messages (on delete cascade); sent ones stay with theirs. Read
 * with every conversation of the members locked, so no send can add to them meanwhile.
 */
export async function withheldChatAttachmentKeysOf(db: DbClient, membershipIds: string[]): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const rows = await db
    .select({ storageKey: chatAttachments.storageKey, thumbKey: chatAttachments.thumbKey })
    .from(chatAttachments)
    .innerJoin(chatMessages, eq(chatMessages.id, chatAttachments.messageId))
    .where(and(inArray(chatAttachments.uploaderMembershipId, membershipIds), eq(chatMessages.withheld, true)));
  return rows.flatMap(chatAttachmentKeys);
}

/**
 * Deletes these members' unsent uploads and returns the storage keys of exactly the rows it deleted, for their files to go
 * after the commit. An upload takes no conversation lock, so one saved meanwhile is either deleted here with its keys or
 * left for the sweep, never deleted without them, as it could be if the keys were read in a statement of their own.
 */
export async function deleteUnsentChatAttachmentsOf(tx: Tx, membershipIds: string[]): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const rows = await tx
    .delete(chatAttachments)
    .where(and(inArray(chatAttachments.uploaderMembershipId, membershipIds), isNull(chatAttachments.messageId)))
    .returning({ storageKey: chatAttachments.storageKey, thumbKey: chatAttachments.thumbKey });
  return rows.flatMap(chatAttachmentKeys);
}
