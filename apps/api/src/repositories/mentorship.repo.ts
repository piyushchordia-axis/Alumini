import type { MentorArea, MentorAvailability, MentorshipBox } from "@illuminize/shared";
import { and, arrayContains, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { DbClient, Tx } from "../db/client";
import { chatBlocks, chatReports, memberships, mentorProfiles, mentorships } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow, TenantRow } from "../types/request";
import { escapeLike } from "./content.common";
import { notCurrentPupil } from "./memberships.repo";

export type MentorProfileRow = typeof mentorProfiles.$inferSelect;
export type MentorshipRow = typeof mentorships.$inferSelect;
export type MentorshipInsert = typeof mentorships.$inferInsert;

type Tenant = Pick<TenantRow, "id" | "type" | "timezone">;

// --- Mentor profiles ---

export async function findMentorProfile(db: DbClient, tenantId: string, membershipId: string): Promise<MentorProfileRow | undefined> {
  const [row] = await db
    .select()
    .from(mentorProfiles)
    .where(and(eq(mentorProfiles.tenantId, tenantId), eq(mentorProfiles.membershipId, membershipId)))
    .limit(1);
  return row;
}

/**
 * The profile, held against change until the transaction ends. A request reads it this way, so stopping or being removed
 * either waits for the request to commit and then declines it with the rest, or goes first and the request sees it.
 */
export async function lockMentorProfileForShare(tx: Tx, tenantId: string, membershipId: string): Promise<MentorProfileRow | undefined> {
  const [row] = await tx
    .select()
    .from(mentorProfiles)
    .where(and(eq(mentorProfiles.tenantId, tenantId), eq(mentorProfiles.membershipId, membershipId)))
    .for("share");
  return row;
}

export async function upsertMentorProfile(
  db: DbClient,
  values: { tenantId: string; membershipId: string; areas: MentorArea[]; availability: MentorAvailability; availabilityNote: string | null; note: string | null },
): Promise<MentorProfileRow> {
  const [row] = await db
    .insert(mentorProfiles)
    .values({ ...values, isActive: true })
    .onConflictDoUpdate({
      target: [mentorProfiles.tenantId, mentorProfiles.membershipId],
      set: { areas: values.areas, availability: values.availability, availabilityNote: values.availabilityNote, note: values.note, isActive: true, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

/** Takes the profile out of the list. Undefined if there was none. */
export async function deactivateMentorProfile(db: DbClient, tenantId: string, membershipId: string): Promise<MentorProfileRow | undefined> {
  const [row] = await db
    .update(mentorProfiles)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(mentorProfiles.tenantId, tenantId), eq(mentorProfiles.membershipId, membershipId)))
    .returning();
  return row;
}

/**
 * Who appears among Mentors: an active profile, its member approved and not a current pupil. The checks on the member read
 * the `memberships` table of the query, which is the mentor here.
 */
const listedMentor = (tenant: Tenant, now: Date): SQL => and(eq(mentorProfiles.tenantId, tenant.id), eq(mentorProfiles.isActive, true), eq(memberships.status, "APPROVED"), notCurrentPupil(tenant, now))!;

/** Not someone the viewer has blocked. Never filtered the other way, because leaving those out would tell the viewer they were blocked. */
const notBlockedBy = (viewerMembershipId: string): SQL =>
  sql`not exists (select 1 from ${chatBlocks} where ${chatBlocks.blockerMembershipId} = ${viewerMembershipId} and ${chatBlocks.blockedMembershipId} = ${memberships.id})`;

export interface MentorRow {
  profile: MentorProfileRow;
  member: MembershipRow;
}

export async function listMentors(
  db: DbClient,
  tenant: Tenant,
  viewerMembershipId: string,
  q: { q?: string; area?: MentorArea; availability?: MentorAvailability; cursor?: string; limit: number; now: Date },
): Promise<CursorPage<MentorRow>> {
  const conds: Array<SQL | undefined> = [
    listedMentor(tenant, q.now),
    ne(memberships.id, viewerMembershipId),
    notBlockedBy(viewerMembershipId),
    q.q ? ilike(memberships.fullName, `%${escapeLike(q.q)}%`) : undefined,
    q.area ? arrayContains(mentorProfiles.areas, [q.area]) : undefined,
    q.availability ? eq(mentorProfiles.availability, q.availability) : undefined,
    keysetCondition(memberships.fullName, memberships.id, decodeCursor(q.cursor), "asc", (v) => v),
  ];
  const rows = await db
    .select({ profile: mentorProfiles, member: memberships })
    .from(mentorProfiles)
    .innerJoin(memberships, eq(memberships.id, mentorProfiles.membershipId))
    .where(and(...conds))
    .orderBy(asc(memberships.fullName), asc(memberships.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.member.fullName, id: r.member.id }), (r) => r);
}

/** One mentor as the Mentors list would show them, or undefined if it wouldn't. The viewer themself isn't left out here. */
export async function findListedMentor(db: DbClient, tenant: Tenant, viewerMembershipId: string, membershipId: string, now: Date): Promise<MentorRow | undefined> {
  const [row] = await db
    .select({ profile: mentorProfiles, member: memberships })
    .from(mentorProfiles)
    .innerJoin(memberships, eq(memberships.id, mentorProfiles.membershipId))
    .where(and(listedMentor(tenant, now), eq(memberships.id, membershipId), notBlockedBy(viewerMembershipId)))
    .limit(1);
  return row;
}

/** Of these members, those the Mentors list would show this viewer. */
export async function listedMentorsAmong(db: DbClient, tenant: Tenant, viewerMembershipId: string, membershipIds: string[], now: Date): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await db
    .select({ id: memberships.id })
    .from(mentorProfiles)
    .innerJoin(memberships, eq(memberships.id, mentorProfiles.membershipId))
    .where(and(listedMentor(tenant, now), inArray(memberships.id, membershipIds), notBlockedBy(viewerMembershipId)));
  return new Set(rows.map((r) => r.id));
}

// --- Requests and mentorships ---

export async function insertMentorship(db: DbClient, values: MentorshipInsert): Promise<MentorshipRow> {
  const [row] = await db.insert(mentorships).values(values).returning();
  return row!;
}

export async function findMentorship(db: DbClient, tenantId: string, id: string): Promise<MentorshipRow | undefined> {
  const [row] = await db
    .select()
    .from(mentorships)
    .where(and(eq(mentorships.tenantId, tenantId), eq(mentorships.id, id)))
    .limit(1);
  return row;
}

/** Holds the row until the transaction ends. Take the pair's lock first, as everything that changes a mentorship does. */
export async function lockMentorship(tx: Tx, tenantId: string, id: string): Promise<MentorshipRow | undefined> {
  const [row] = await tx
    .select()
    .from(mentorships)
    .where(and(eq(mentorships.tenantId, tenantId), eq(mentorships.id, id)))
    .for("update");
  return row;
}

export async function updateMentorship(db: DbClient, id: string, values: Partial<MentorshipInsert>): Promise<MentorshipRow> {
  const [row] = await db
    .update(mentorships)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(mentorships.id, id))
    .returning();
  return row!;
}

const isOpen = () => inArray(mentorships.status, ["REQUESTED", "ACCEPTED"]);

/** The mentee's request waiting with this mentor, or their mentorship under way, suppressed or not. */
export async function findOpenMentorship(db: DbClient, tenantId: string, mentorMembershipId: string, menteeMembershipId: string): Promise<MentorshipRow | undefined> {
  const [row] = await db
    .select()
    .from(mentorships)
    .where(and(eq(mentorships.tenantId, tenantId), eq(mentorships.mentorMembershipId, mentorMembershipId), eq(mentorships.menteeMembershipId, menteeMembershipId), isOpen()))
    .limit(1);
  return row;
}

/** Requests from this mentee to this mentor since `since`, whatever became of them, suppressed ones included. */
export async function countRequestsBetween(db: DbClient, tenantId: string, mentorMembershipId: string, menteeMembershipId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mentorships)
    .where(and(eq(mentorships.tenantId, tenantId), eq(mentorships.mentorMembershipId, mentorMembershipId), eq(mentorships.menteeMembershipId, menteeMembershipId), gte(mentorships.createdAt, since)));
  return row?.count ?? 0;
}

/** The mentee's requests waiting and mentorships under way, suppressed ones included, so a block can't change the count. */
export async function countOpenForMentee(db: DbClient, tenantId: string, menteeMembershipId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mentorships)
    .where(and(eq(mentorships.tenantId, tenantId), eq(mentorships.menteeMembershipId, menteeMembershipId), isOpen()));
  return row?.count ?? 0;
}

const eitherWay = (aId: string, bId: string) =>
  or(and(eq(mentorships.mentorMembershipId, aId), eq(mentorships.menteeMembershipId, bId)), and(eq(mentorships.mentorMembershipId, bId), eq(mentorships.menteeMembershipId, aId)));

/** Whether a mentorship between the pair, either way round, was under way and ended since `since`. */
export async function endedMentorshipSince(db: DbClient, tenantId: string, aId: string, bId: string, since: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: mentorships.id })
    .from(mentorships)
    .where(and(eq(mentorships.tenantId, tenantId), eq(mentorships.status, "ENDED"), isNotNull(mentorships.acceptedAt), gte(mentorships.endedAt, since), eitherWay(aId, bId)))
    .limit(1);
  return !!row;
}

/** Whether another mentorship under way connects the pair, in either direction. */
export async function hasOtherAcceptedMentorship(db: DbClient, tenantId: string, aId: string, bId: string, excludingId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: mentorships.id })
    .from(mentorships)
    .where(
      and(eq(mentorships.tenantId, tenantId), eq(mentorships.status, "ACCEPTED"), ne(mentorships.id, excludingId), eitherWay(aId, bId)),
    )
    .limit(1);
  return !!row;
}

/** The viewer's open request to each of these mentors, keyed by mentor. */
export async function findOpenRequestsTo(db: DbClient, tenantId: string, menteeMembershipId: string, mentorMembershipIds: string[]): Promise<Map<string, MentorshipRow>> {
  if (mentorMembershipIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(mentorships)
    .where(and(eq(mentorships.tenantId, tenantId), eq(mentorships.menteeMembershipId, menteeMembershipId), inArray(mentorships.mentorMembershipId, mentorMembershipIds), isOpen()));
  return new Map(rows.map((r) => [r.mentorMembershipId!, r]));
}

/**
 * One side's list. A mentor never sees a suppressed request, nor one waiting from someone they couldn't take on now (not
 * approved, or a current pupil), which comes back if that changes. A mentee sees everything they sent. The checks on the
 * other member read the `memberships` table of the query, which is joined as them.
 */
function boxCondition(tenant: Tenant, membershipId: string, box: MentorshipBox, now: Date): SQL {
  if (box === "sent") return and(eq(mentorships.tenantId, tenant.id), eq(mentorships.menteeMembershipId, membershipId))!;
  return and(
    eq(mentorships.tenantId, tenant.id),
    eq(mentorships.mentorMembershipId, membershipId),
    eq(mentorships.suppressed, false),
    or(ne(mentorships.status, "REQUESTED"), and(eq(memberships.status, "APPROVED"), notCurrentPupil(tenant, now))),
  )!;
}

const otherMember = (box: MentorshipBox) => eq(memberships.id, box === "sent" ? mentorships.mentorMembershipId : mentorships.menteeMembershipId);

/** Whether this member has reported the note of the mentorship in the query, spelled out, so the inner table's columns can't lose their name. */
const reportedBy = (membershipId: string) =>
  sql<boolean>`exists (select 1 from chat_reports cr where cr.target_kind = 'MENTORSHIP_NOTE' and cr.target_id = mentorships.id and cr.reporter_membership_id = ${membershipId})`;

/** Whether this member has reported this request's note. */
export async function hasReportedNote(db: DbClient, mentorshipId: string, reporterMembershipId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: chatReports.id })
    .from(chatReports)
    .where(and(eq(chatReports.targetKind, "MENTORSHIP_NOTE"), eq(chatReports.targetId, mentorshipId), eq(chatReports.reporterMembershipId, reporterMembershipId)))
    .limit(1);
  return !!row;
}

export interface MentorshipListRow {
  mentorship: MentorshipRow;
  /** Null once they've deleted their account. */
  member: MembershipRow | null;
  /** This member reported its note. Only a mentor can, so always false on the sent list. */
  reported: boolean;
}

export async function listMentorships(db: DbClient, tenant: Tenant, membershipId: string, q: { box: MentorshipBox; cursor?: string; limit: number; now: Date }): Promise<CursorPage<MentorshipListRow>> {
  const rows = await db
    .select({ mentorship: mentorships, member: memberships, reported: q.box === "received" ? reportedBy(membershipId) : sql<boolean>`false` })
    .from(mentorships)
    .leftJoin(memberships, otherMember(q.box))
    .where(and(boxCondition(tenant, membershipId, q.box, q.now), keysetCondition(mentorships.createdAt, mentorships.id, decodeCursor(q.cursor), "desc")))
    .orderBy(desc(mentorships.createdAt), desc(mentorships.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.mentorship.createdAt.toISOString(), id: r.mentorship.id }), (r) => r);
}

/** Requests in that list waiting for an answer. */
export async function countWaiting(db: DbClient, tenant: Tenant, membershipId: string, box: MentorshipBox, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mentorships)
    .leftJoin(memberships, otherMember(box))
    .where(and(boxCondition(tenant, membershipId, box, now), eq(mentorships.status, "REQUESTED")));
  return row?.count ?? 0;
}

/** Requests waiting and mentorships under way in that list. */
export async function countOpenIn(db: DbClient, tenant: Tenant, membershipId: string, box: MentorshipBox, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mentorships)
    .leftJoin(memberships, otherMember(box))
    .where(and(boxCondition(tenant, membershipId, box, now), isOpen()));
  return row?.count ?? 0;
}

/** Declines every request waiting for this mentor, suppressed ones too, and says which they were. */
export async function declineWaitingFor(tx: Tx, tenantId: string, mentorMembershipId: string, now: Date): Promise<MentorshipRow[]> {
  return tx
    .update(mentorships)
    .set({ status: "DECLINED", respondedAt: now, updatedAt: now })
    .where(and(eq(mentorships.tenantId, tenantId), eq(mentorships.mentorMembershipId, mentorMembershipId), eq(mentorships.status, "REQUESTED")))
    .returning();
}

/**
 * What a block does to requests between the two, silently: the blocker's own waiting requests to them are withdrawn, and
 * theirs waiting for the blocker are suppressed, so the blocker never sees them and accepting can never meet a block.
 * Mentorships under way are left alone, and either side can still end them.
 */
export async function applyBlockToMentorships(tx: Tx, tenantId: string, blockerMembershipId: string, blockedMembershipId: string, now: Date): Promise<{ withdrawn: MentorshipRow[]; suppressed: MentorshipRow[] }> {
  const waiting = (mentor: string, mentee: string) =>
    and(eq(mentorships.tenantId, tenantId), eq(mentorships.mentorMembershipId, mentor), eq(mentorships.menteeMembershipId, mentee), eq(mentorships.status, "REQUESTED"));
  const withdrawn = await tx.update(mentorships).set({ status: "ENDED", endedAt: now, endedByMembershipId: blockerMembershipId, updatedAt: now }).where(waiting(blockedMembershipId, blockerMembershipId)).returning();
  const suppressed = await tx.update(mentorships).set({ suppressed: true, updatedAt: now }).where(waiting(blockerMembershipId, blockedMembershipId)).returning();
  return { withdrawn, suppressed };
}

/**
 * Before an account goes: requests it sent are withdrawn, requests waiting for it are declined, and its mentorships under
 * way end, all without telling anyone. The foreign keys then leave the other member's copy with a null where this one was.
 * Returns every row it changed.
 */
export async function closeMentorshipsOf(tx: Tx, membershipIds: string[], now: Date): Promise<MentorshipRow[]> {
  if (membershipIds.length === 0) return [];
  const withdrawn = await tx
    .update(mentorships)
    .set({ status: "ENDED", endedAt: now, endedByMembershipId: sql`${mentorships.menteeMembershipId}`, updatedAt: now })
    .where(and(eq(mentorships.status, "REQUESTED"), inArray(mentorships.menteeMembershipId, membershipIds)))
    .returning();
  const declined = await tx
    .update(mentorships)
    .set({ status: "DECLINED", respondedAt: now, updatedAt: now })
    .where(and(eq(mentorships.status, "REQUESTED"), inArray(mentorships.mentorMembershipId, membershipIds)))
    .returning();
  const ended = await tx
    .update(mentorships)
    .set({ status: "ENDED", endedAt: now, endedByMembershipId: sql`case when ${inArray(mentorships.mentorMembershipId, membershipIds)} then ${mentorships.mentorMembershipId} else ${mentorships.menteeMembershipId} end`, updatedAt: now })
    .where(and(eq(mentorships.status, "ACCEPTED"), or(inArray(mentorships.mentorMembershipId, membershipIds), inArray(mentorships.menteeMembershipId, membershipIds))))
    .returning();
  return [...withdrawn, ...declined, ...ended];
}

/**
 * After an account has gone, in the same transaction: anything still open that lost a member. Only a request sent to or by
 * them while their deletion was under way can be left like that, because its row's foreign keys held the deletion back until
 * it committed, after the closing above had already run. Closed as the closing would have.
 */
export async function closeMentorshipsLeftBehind(tx: Tx, tenantIds: string[], now: Date): Promise<MentorshipRow[]> {
  if (tenantIds.length === 0) return [];
  const inTenants = inArray(mentorships.tenantId, tenantIds);
  const withdrawn = await tx
    .update(mentorships)
    .set({ status: "ENDED", endedAt: now, updatedAt: now })
    .where(and(inTenants, eq(mentorships.status, "REQUESTED"), isNull(mentorships.menteeMembershipId)))
    .returning();
  const declined = await tx
    .update(mentorships)
    .set({ status: "DECLINED", respondedAt: now, updatedAt: now })
    .where(and(inTenants, eq(mentorships.status, "REQUESTED"), isNull(mentorships.mentorMembershipId)))
    .returning();
  const ended = await tx
    .update(mentorships)
    .set({ status: "ENDED", endedAt: now, updatedAt: now })
    .where(and(inTenants, eq(mentorships.status, "ACCEPTED"), or(isNull(mentorships.mentorMembershipId), isNull(mentorships.menteeMembershipId))))
    .returning();
  return [...withdrawn, ...declined, ...ended];
}

/** The users behind these memberships, for live events to their own rooms. */
export async function userIdsOfMemberships(db: DbClient, membershipIds: string[]): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const rows = await db.select({ userId: memberships.userId }).from(memberships).where(inArray(memberships.id, membershipIds));
  return [...new Set(rows.map((r) => r.userId))];
}
