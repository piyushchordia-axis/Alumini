import type { InvitationsQuery } from "@illuminize/shared";
import { and, count, desc, eq, gt, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { invitations } from "../db/schema";
import { escapeLike } from "./content.common";

export type InvitationRow = typeof invitations.$inferSelect;
export type InvitationInsert = typeof invitations.$inferInsert;

const OPEN = ["PENDING", "SENT"] as const;

export async function findInvitationById(db: DbClient, id: string): Promise<InvitationRow | undefined> {
  const [row] = await db.select().from(invitations).where(eq(invitations.id, id));
  return row;
}

export async function findInvitationByToken(db: DbClient, token: string): Promise<InvitationRow | undefined> {
  const [row] = await db.select().from(invitations).where(eq(invitations.token, token));
  return row;
}

export async function findInvitationsByPhones(db: DbClient, tenantId: string, phones: string[]): Promise<InvitationRow[]> {
  if (phones.length === 0) return [];
  return db
    .select()
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), inArray(invitations.phoneE164, phones)));
}

/** The open (pending or sent, unexpired) invitation for a phone in one institution. */
export async function findOpenInvitationByPhone(db: DbClient, tenantId: string, phoneE164: string, now = new Date()): Promise<InvitationRow | undefined> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.phoneE164, phoneE164), inArray(invitations.status, [...OPEN]), gt(invitations.expiresAt, now)));
  return row;
}

export async function insertInvitation(db: DbClient, values: InvitationInsert): Promise<InvitationRow> {
  const [row] = await db.insert(invitations).values(values).returning();
  return row!;
}

export async function updateInvitation(db: DbClient, tenantId: string, id: string, values: Partial<InvitationInsert>): Promise<InvitationRow | undefined> {
  const [row] = await db
    .update(invitations)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.id, id)))
    .returning();
  return row;
}

/** Marks an open invitation accepted, only if it is still open (so two sign-ups can't both claim it). */
export async function claimInvitation(db: DbClient, id: string, membershipId: string, now = new Date()): Promise<InvitationRow | undefined> {
  const [row] = await db
    .update(invitations)
    .set({ status: "ACCEPTED", acceptedAt: now, acceptedMembershipId: membershipId, updatedAt: now })
    .where(and(eq(invitations.id, id), inArray(invitations.status, [...OPEN]), gt(invitations.expiresAt, now)))
    .returning();
  return row;
}

/** Records one more send for each open invitation; returns the rows that were open (with their new send count). */
export async function markInvitationsSent(db: DbClient, tenantId: string, ids: string[], now = new Date()): Promise<InvitationRow[]> {
  if (ids.length === 0) return [];
  return db
    .update(invitations)
    .set({ status: "SENT", sendCount: sql`${invitations.sendCount} + 1`, lastSentAt: now, updatedAt: now })
    .where(and(eq(invitations.tenantId, tenantId), inArray(invitations.id, ids), inArray(invitations.status, [...OPEN]), gt(invitations.expiresAt, now)))
    .returning();
}

function listConditions(tenantId: string, q: Pick<InvitationsQuery, "status" | "q">, now: Date): SQL[] {
  const conds: SQL[] = [eq(invitations.tenantId, tenantId)];
  if (q.status === "EXPIRED") conds.push(inArray(invitations.status, [...OPEN]), lte(invitations.expiresAt, now));
  else if (q.status === "PENDING" || q.status === "SENT") conds.push(eq(invitations.status, q.status), gt(invitations.expiresAt, now));
  else if (q.status) conds.push(eq(invitations.status, q.status));
  if (q.q) {
    const p = `%${escapeLike(q.q)}%`;
    conds.push(or(ilike(invitations.fullName, p), ilike(invitations.phoneE164, p), ilike(invitations.email, p))!);
  }
  return conds;
}

export async function listInvitations(db: DbClient, tenantId: string, q: InvitationsQuery, now = new Date()): Promise<{ rows: InvitationRow[]; total: number }> {
  const conds = listConditions(tenantId, q, now);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(invitations)
      .where(and(...conds))
      .orderBy(desc(invitations.createdAt), desc(invitations.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(invitations).where(and(...conds)),
  ]);
  return { rows, total: totalRow?.n ?? 0 };
}

/** Ids of open, never-sent invitations (for "send all pending"). */
export async function listPendingInvitationIds(db: DbClient, tenantId: string, limit: number, now = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.status, "PENDING"), gt(invitations.expiresAt, now)))
    .orderBy(invitations.createdAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function invitationCounts(db: DbClient, tenantId: string, now = new Date()): Promise<Record<"pending" | "sent" | "accepted" | "revoked" | "expired", number>> {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${invitations.status} = 'PENDING' and ${invitations.expiresAt} > ${now})::int`,
      sent: sql<number>`count(*) filter (where ${invitations.status} = 'SENT' and ${invitations.expiresAt} > ${now})::int`,
      accepted: sql<number>`count(*) filter (where ${invitations.status} = 'ACCEPTED')::int`,
      revoked: sql<number>`count(*) filter (where ${invitations.status} = 'REVOKED')::int`,
      expired: sql<number>`count(*) filter (where ${invitations.status} in ('PENDING', 'SENT') and ${invitations.expiresAt} <= ${now})::int`,
    })
    .from(invitations)
    .where(eq(invitations.tenantId, tenantId));
  return row ?? { pending: 0, sent: 0, accepted: 0, revoked: 0, expired: 0 };
}
