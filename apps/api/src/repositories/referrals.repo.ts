import type { ReferralBox } from "@illuminize/shared";
import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { DbClient, Tx } from "../db/client";
import { chatReports, jobs, memberships, referralRequests } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow, TenantRow } from "../types/request";
import type { JobRow } from "./jobs.repo";
import { notCurrentPupil } from "./memberships.repo";

export type ReferralRow = typeof referralRequests.$inferSelect;
export type ReferralInsert = typeof referralRequests.$inferInsert;

type Tenant = Pick<TenantRow, "id" | "type" | "timezone">;

/** Waiting for the poster's answer. The only status anything moves a request out of. */
const waiting = () => eq(referralRequests.status, "REQUESTED");

export async function insertReferral(db: DbClient, values: ReferralInsert): Promise<ReferralRow> {
  const [row] = await db.insert(referralRequests).values(values).returning();
  return row!;
}

export async function findReferral(db: DbClient, tenantId: string, id: string): Promise<ReferralRow | undefined> {
  const [row] = await db
    .select()
    .from(referralRequests)
    .where(and(eq(referralRequests.tenantId, tenantId), eq(referralRequests.id, id)))
    .limit(1);
  return row;
}

/** Holds the row until the transaction ends. Take the pair's lock first, as everything that changes a request does. */
export async function lockReferral(tx: Tx, tenantId: string, id: string): Promise<ReferralRow | undefined> {
  const [row] = await tx
    .select()
    .from(referralRequests)
    .where(and(eq(referralRequests.tenantId, tenantId), eq(referralRequests.id, id)))
    .for("update");
  return row;
}

export async function updateReferral(db: DbClient, id: string, values: Partial<ReferralInsert>): Promise<ReferralRow> {
  const [row] = await db
    .update(referralRequests)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(referralRequests.id, id))
    .returning();
  return row!;
}

/** The member's request about this job that still stands in the way of another: waiting, accepted or declined. */
export async function findStandingReferral(db: DbClient, jobId: string, requesterMembershipId: string): Promise<ReferralRow | undefined> {
  const [row] = await db
    .select()
    .from(referralRequests)
    .where(and(eq(referralRequests.jobId, jobId), eq(referralRequests.requesterMembershipId, requesterMembershipId), inArray(referralRequests.status, ["REQUESTED", "ACCEPTED", "DECLINED"])))
    .limit(1);
  return row;
}

/** The member's latest request about this job, whatever became of it. */
export async function findLatestReferral(db: DbClient, tenantId: string, jobId: string, requesterMembershipId: string): Promise<ReferralRow | undefined> {
  const [row] = await db
    .select()
    .from(referralRequests)
    .where(and(eq(referralRequests.tenantId, tenantId), eq(referralRequests.jobId, jobId), eq(referralRequests.requesterMembershipId, requesterMembershipId)))
    .orderBy(desc(referralRequests.createdAt), desc(referralRequests.id))
    .limit(1);
  return row;
}

/** Requests this member has sent about this job, in any state, suppressed ones included. */
export async function countRequestsAboutJob(db: DbClient, jobId: string, requesterMembershipId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(referralRequests)
    .where(and(eq(referralRequests.jobId, jobId), eq(referralRequests.requesterMembershipId, requesterMembershipId)));
  return row?.count ?? 0;
}

/** The member's requests still waiting, suppressed ones included, so a block can't change the count. */
export async function countWaitingFromRequester(db: DbClient, tenantId: string, requesterMembershipId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(referralRequests)
    .where(and(eq(referralRequests.tenantId, tenantId), eq(referralRequests.requesterMembershipId, requesterMembershipId), waiting()));
  return row?.count ?? 0;
}

/**
 * What a poster sees. Never a suppressed request, nor one waiting from someone they couldn't take on now (not approved, or a
 * current pupil), which comes back if that changes. The checks on the requester read the `memberships` table of the query,
 * which is joined as them.
 */
const posterSees = (tenant: Tenant, now: Date): SQL =>
  and(eq(referralRequests.suppressed, false), or(ne(referralRequests.status, "REQUESTED"), and(eq(memberships.status, "APPROVED"), notCurrentPupil(tenant, now))))!;

function boxCondition(tenant: Tenant, membershipId: string, box: ReferralBox, now: Date, jobId?: string): SQL {
  const inTenant = eq(referralRequests.tenantId, tenant.id);
  const forJob = jobId ? eq(referralRequests.jobId, jobId) : undefined;
  if (box === "sent") return and(inTenant, eq(referralRequests.requesterMembershipId, membershipId), forJob)!;
  return and(inTenant, eq(referralRequests.posterMembershipId, membershipId), posterSees(tenant, now), forJob)!;
}

const otherMember = (box: ReferralBox) => eq(memberships.id, box === "sent" ? referralRequests.posterMembershipId : referralRequests.requesterMembershipId);

/**
 * Requests waiting for this job's poster that they can see. What the 25-a-job limit counts, so a member they've blocked can't
 * use it up, and what the job's own page shows them.
 */
export async function countVisibleWaitingForJob(db: DbClient, tenant: Tenant, jobId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(referralRequests)
    .leftJoin(memberships, eq(memberships.id, referralRequests.requesterMembershipId))
    .where(and(eq(referralRequests.tenantId, tenant.id), eq(referralRequests.jobId, jobId), waiting(), posterSees(tenant, now)));
  return row?.count ?? 0;
}

/** Whether this member has reported the note of the request in the query, spelled out, so the inner table's columns can't lose their name. */
const reportedBy = (membershipId: string) =>
  sql<boolean>`exists (select 1 from chat_reports cr where cr.target_kind = 'REFERRAL_NOTE' and cr.target_id = referral_requests.id and cr.reporter_membership_id = ${membershipId})`;

/** Whether this member has reported this request's note. */
export async function hasReportedReferralNote(db: DbClient, referralId: string, reporterMembershipId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: chatReports.id })
    .from(chatReports)
    .where(and(eq(chatReports.targetKind, "REFERRAL_NOTE"), eq(chatReports.targetId, referralId), eq(chatReports.reporterMembershipId, reporterMembershipId)))
    .limit(1);
  return !!row;
}

export interface ReferralListRow {
  referral: ReferralRow;
  /** The other member. Null once they've deleted their account. */
  member: MembershipRow | null;
  /** The job as it is now, or null once it's been deleted. */
  job: JobRow | null;
  /** This member reported its note. Only a poster can, so always false on the sent list. */
  reported: boolean;
}

/** One side's list, or with `jobId` only the requests about that one job. */
export async function listReferrals(
  db: DbClient,
  tenant: Tenant,
  membershipId: string,
  q: { box: ReferralBox; jobId?: string; cursor?: string; limit: number; now: Date },
): Promise<CursorPage<ReferralListRow>> {
  const rows = await db
    .select({ referral: referralRequests, member: memberships, job: jobs, reported: q.box === "received" ? reportedBy(membershipId) : sql<boolean>`false` })
    .from(referralRequests)
    .leftJoin(memberships, otherMember(q.box))
    .leftJoin(jobs, eq(jobs.id, referralRequests.jobId))
    .where(and(boxCondition(tenant, membershipId, q.box, q.now, q.jobId), keysetCondition(referralRequests.createdAt, referralRequests.id, decodeCursor(q.cursor), "desc")))
    .orderBy(desc(referralRequests.createdAt), desc(referralRequests.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.referral.createdAt.toISOString(), id: r.referral.id }), (r) => r);
}

/** Requests in that list waiting for an answer, or with `jobId` only those about that job. */
export async function countWaitingIn(db: DbClient, tenant: Tenant, membershipId: string, box: ReferralBox, now: Date, jobId?: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(referralRequests)
    .leftJoin(memberships, otherMember(box))
    .where(and(boxCondition(tenant, membershipId, box, now, jobId), waiting()));
  return row?.count ?? 0;
}

/** Whether a referral that was accepted connects the pair, whichever of them asked. Nothing ends one, so its chat is theirs to keep. */
export async function hasAcceptedReferralBetween(db: DbClient, tenantId: string, aId: string, bId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: referralRequests.id })
    .from(referralRequests)
    .where(
      and(
        eq(referralRequests.tenantId, tenantId),
        eq(referralRequests.status, "ACCEPTED"),
        or(
          and(eq(referralRequests.posterMembershipId, aId), eq(referralRequests.requesterMembershipId, bId)),
          and(eq(referralRequests.posterMembershipId, bId), eq(referralRequests.requesterMembershipId, aId)),
        ),
      ),
    )
    .limit(1);
  return !!row;
}

/** Closes every request waiting on this job, suppressed ones too, and says which they were. Take the job's lock first. */
export async function closeWaitingForJob(tx: Tx, jobId: string, now: Date): Promise<ReferralRow[]> {
  return tx
    .update(referralRequests)
    .set({ status: "CLOSED", closedAt: now, updatedAt: now })
    .where(and(eq(referralRequests.jobId, jobId), waiting()))
    .returning();
}

/**
 * What a block does to requests between the two, silently: the blocker's own waiting requests to them are withdrawn, and
 * theirs waiting for the blocker are suppressed, so the blocker never sees them and accepting can never meet a block.
 * Accepted ones are left alone: their chat is an ordinary chat, with the block's own rules.
 */
export async function applyBlockToReferrals(tx: Tx, tenantId: string, blockerMembershipId: string, blockedMembershipId: string, now: Date): Promise<{ withdrawn: ReferralRow[]; suppressed: ReferralRow[] }> {
  const waitingFrom = (requester: string, poster: string) =>
    and(eq(referralRequests.tenantId, tenantId), eq(referralRequests.requesterMembershipId, requester), eq(referralRequests.posterMembershipId, poster), waiting());
  const withdrawn = await tx.update(referralRequests).set({ status: "WITHDRAWN", closedAt: now, updatedAt: now }).where(waitingFrom(blockerMembershipId, blockedMembershipId)).returning();
  const suppressed = await tx.update(referralRequests).set({ suppressed: true, updatedAt: now }).where(waitingFrom(blockedMembershipId, blockerMembershipId)).returning();
  return { withdrawn, suppressed };
}

/**
 * Before an account goes: requests it sent and still waiting are withdrawn, and those waiting for it close, as its jobs go
 * with it, all without telling anyone. The foreign keys then leave the other member's copy with a null where this one was.
 * Accepted ones stay accepted. Returns every row it changed.
 */
export async function closeReferralsOf(tx: Tx, membershipIds: string[], now: Date): Promise<ReferralRow[]> {
  if (membershipIds.length === 0) return [];
  const withdrawn = await tx
    .update(referralRequests)
    .set({ status: "WITHDRAWN", closedAt: now, updatedAt: now })
    .where(and(waiting(), inArray(referralRequests.requesterMembershipId, membershipIds)))
    .returning();
  const closed = await tx
    .update(referralRequests)
    .set({ status: "CLOSED", closedAt: now, updatedAt: now })
    .where(and(waiting(), inArray(referralRequests.posterMembershipId, membershipIds)))
    .returning();
  return [...withdrawn, ...closed];
}

/**
 * Before an account goes: requests about the jobs it posted let go of them now, as the jobs' deletion would. Postgres checks
 * every foreign key again on a row this transaction has already changed, so a request closed above whose job the cascade
 * deletes first would otherwise fail its job check when the cascade then nulls its poster.
 */
export async function detachFromJobsOf(tx: Tx, membershipIds: string[]): Promise<void> {
  if (membershipIds.length === 0) return;
  await tx
    .update(referralRequests)
    .set({ jobId: null })
    .where(inArray(referralRequests.jobId, tx.select({ id: jobs.id }).from(jobs).where(inArray(jobs.authorMembershipId, membershipIds))));
}

/**
 * After an account has gone, in the same transaction: requests still waiting that lost a member or their job. Only one sent
 * to or by them while their deletion was under way can be left like that, because its row's foreign keys held the deletion
 * back until it committed, after the closing above had already run. Closed as the closing would have.
 */
export async function closeReferralsLeftBehind(tx: Tx, tenantIds: string[], now: Date): Promise<ReferralRow[]> {
  if (tenantIds.length === 0) return [];
  const inTenants = inArray(referralRequests.tenantId, tenantIds);
  const withdrawn = await tx
    .update(referralRequests)
    .set({ status: "WITHDRAWN", closedAt: now, updatedAt: now })
    .where(and(inTenants, waiting(), isNull(referralRequests.requesterMembershipId)))
    .returning();
  const closed = await tx
    .update(referralRequests)
    .set({ status: "CLOSED", closedAt: now, updatedAt: now })
    .where(and(inTenants, waiting(), or(isNull(referralRequests.posterMembershipId), isNull(referralRequests.jobId))))
    .returning();
  return [...withdrawn, ...closed];
}
