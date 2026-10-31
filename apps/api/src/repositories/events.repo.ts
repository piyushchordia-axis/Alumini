import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import type { EventListQuery, RsvpStatus } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { eventRsvps, events, memberships } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow } from "../types/request";
import { escapeLike, type ModerationPatch } from "./content.common";

export type EventRow = typeof events.$inferSelect;
export type EventInsert = typeof events.$inferInsert;
export type RsvpRow = typeof eventRsvps.$inferSelect;
export type EventWithAuthor = { event: EventRow; author: MembershipRow; myRsvp: RsvpStatus | null };

function eventSelect(viewerMembershipId: string) {
  return {
    event: events,
    author: memberships,
    myRsvp: sql<RsvpStatus | null>`(select ${eventRsvps.status} from ${eventRsvps} where ${eventRsvps.eventId} = ${events.id} and ${eventRsvps.membershipId} = ${viewerMembershipId})`,
  };
}

export async function listEvents(db: DbClient, tenantId: string, q: EventListQuery, viewerMembershipId: string): Promise<CursorPage<EventWithAuthor>> {
  const conds: SQL[] = [eq(events.tenantId, tenantId)];
  const now = new Date();
  if (q.mine) {
    conds.push(eq(events.authorMembershipId, viewerMembershipId));
  } else {
    conds.push(eq(events.moderationStatus, "APPROVED"), ne(memberships.status, "SUSPENDED"));
  }
  const upcoming = q.scope === "upcoming";
  conds.push(upcoming ? gte(events.startAt, now) : lt(events.startAt, now));
  if (upcoming && !q.mine) conds.push(eq(events.isCancelled, false));
  if (q.kind) conds.push(eq(events.kind, q.kind));
  if (q.city) conds.push(ilike(events.city, escapeLike(q.city)));
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(events.startAt, events.id, cursor, upcoming ? "asc" : "desc");
  if (keyset) conds.push(keyset);
  const order = upcoming ? [asc(events.startAt), asc(events.id)] : [desc(events.startAt), desc(events.id)];
  const rows = await db
    .select(eventSelect(viewerMembershipId))
    .from(events)
    .innerJoin(memberships, eq(memberships.id, events.authorMembershipId))
    .where(and(...conds))
    .orderBy(...order)
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.event.startAt.toISOString(), id: r.event.id }), (r) => r);
}

export async function findEventWithAuthor(db: DbClient, tenantId: string, id: string, viewerMembershipId: string): Promise<EventWithAuthor | undefined> {
  const [row] = await db
    .select(eventSelect(viewerMembershipId))
    .from(events)
    .innerJoin(memberships, eq(memberships.id, events.authorMembershipId))
    .where(and(eq(events.tenantId, tenantId), eq(events.id, id)))
    .limit(1);
  return row;
}

export async function findEventById(db: DbClient, tenantId: string, id: string, forUpdate = false): Promise<EventRow | undefined> {
  const query = db.select().from(events).where(and(eq(events.tenantId, tenantId), eq(events.id, id))).limit(1);
  const [row] = forUpdate ? await query.for("update") : await query;
  return row;
}

export async function insertEvent(db: DbClient, values: EventInsert): Promise<EventRow> {
  const [row] = await db.insert(events).values(values).returning();
  return row!;
}

export async function updateEvent(db: DbClient, tenantId: string, id: string, values: Partial<EventInsert>): Promise<EventRow | undefined> {
  const [row] = await db
    .update(events)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(events.tenantId, tenantId), eq(events.id, id)))
    .returning();
  return row;
}

export async function deleteEvent(db: DbClient, tenantId: string, id: string): Promise<void> {
  await db.delete(events).where(and(eq(events.tenantId, tenantId), eq(events.id, id)));
}

export async function setEventModeration(db: DbClient, tenantId: string, id: string, patch: ModerationPatch): Promise<void> {
  await db
    .update(events)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(events.tenantId, tenantId), eq(events.id, id)));
}

export async function countUpcomingEvents(db: DbClient, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.moderationStatus, "APPROVED"), eq(events.isCancelled, false), gte(events.startAt, new Date())));
  return row?.count ?? 0;
}

export async function countEvents(db: DbClient, tenantId?: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(tenantId ? eq(events.tenantId, tenantId) : undefined);
  return row?.count ?? 0;
}

// ---- RSVPs ----

export async function findRsvp(db: DbClient, eventId: string, membershipId: string): Promise<RsvpRow | undefined> {
  const [row] = await db
    .select()
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.membershipId, membershipId)))
    .limit(1);
  return row;
}

export async function upsertRsvp(db: DbClient, values: { tenantId: string; eventId: string; membershipId: string; status: RsvpStatus }): Promise<void> {
  await db
    .insert(eventRsvps)
    .values(values)
    .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.membershipId], set: { status: values.status, updatedAt: new Date() } });
}

export async function deleteRsvp(db: DbClient, eventId: string, membershipId: string): Promise<boolean> {
  const rows = await db
    .delete(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.membershipId, membershipId)))
    .returning({ eventId: eventRsvps.eventId });
  return rows.length > 0;
}

export async function recountRsvps(db: DbClient, eventId: string): Promise<{ yesCount: number; maybeCount: number }> {
  const [row] = await db
    .update(events)
    .set({
      yesCount: sql`(select count(*) from ${eventRsvps} where ${eventRsvps.eventId} = ${events.id} and ${eventRsvps.status} = 'YES')`,
      maybeCount: sql`(select count(*) from ${eventRsvps} where ${eventRsvps.eventId} = ${events.id} and ${eventRsvps.status} = 'MAYBE')`,
    })
    .where(eq(events.id, eventId))
    .returning({ yesCount: events.yesCount, maybeCount: events.maybeCount });
  return row ?? { yesCount: 0, maybeCount: 0 };
}

export async function listAttendees(
  db: DbClient,
  eventId: string,
  q: { cursor?: string; limit: number; status: RsvpStatus },
): Promise<CursorPage<{ rsvp: RsvpRow; member: MembershipRow }>> {
  const conds: SQL[] = [eq(eventRsvps.eventId, eventId), eq(eventRsvps.status, q.status), eq(memberships.status, "APPROVED")];
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(eventRsvps.createdAt, eventRsvps.membershipId, cursor, "asc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ rsvp: eventRsvps, member: memberships })
    .from(eventRsvps)
    .innerJoin(memberships, eq(memberships.id, eventRsvps.membershipId))
    .where(and(...conds))
    .orderBy(asc(eventRsvps.createdAt), asc(eventRsvps.membershipId))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.rsvp.createdAt.toISOString(), id: r.rsvp.membershipId }), (r) => r);
}

export async function listRsvpMembershipIds(db: DbClient, eventId: string, statuses: RsvpStatus[]): Promise<string[]> {
  if (statuses.length === 0) return [];
  const rows = await db
    .select({ membershipId: eventRsvps.membershipId })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), inArray(eventRsvps.status, statuses)));
  return rows.map((r) => r.membershipId);
}
