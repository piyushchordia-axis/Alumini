import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
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
 * The storage keys of what these members uploaded that nobody else ever received: uploads they never sent, and the
 * attachments of their withheld messages. Account deletion removes those files; sent ones stay with their messages.
 */
export async function withheldAndUnsentChatAttachmentKeysOf(db: DbClient, membershipIds: string[]): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const rows = await db
    .select({ storageKey: chatAttachments.storageKey, thumbKey: chatAttachments.thumbKey })
    .from(chatAttachments)
    .leftJoin(chatMessages, eq(chatMessages.id, chatAttachments.messageId))
    .where(and(inArray(chatAttachments.uploaderMembershipId, membershipIds), or(isNull(chatAttachments.messageId), eq(chatMessages.withheld, true))));
  return rows.flatMap(chatAttachmentKeys);
}

/** Deletes these members' unsent uploads. A withheld message's attachments go with the message (on delete cascade). */
export async function deleteUnsentChatAttachmentsOf(tx: Tx, membershipIds: string[]): Promise<void> {
  if (membershipIds.length === 0) return;
  await tx.delete(chatAttachments).where(and(inArray(chatAttachments.uploaderMembershipId, membershipIds), isNull(chatAttachments.messageId)));
}
