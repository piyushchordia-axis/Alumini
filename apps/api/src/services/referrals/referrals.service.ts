import {
  REFERRAL_MAX_OPEN_PER_REQUESTER,
  REFERRAL_MAX_REQUESTS_PER_JOB,
  REFERRAL_MAX_WAITING_PER_JOB,
  jobIsOpen,
  referralsEnabled,
  type ChatReportCreateInput,
  type CursorQuery,
  type JobDetailDto,
  type JobDto,
  type ReferralAskRefusal,
  type ReferralDto,
  type ReferralPageDto,
  type ReferralRequestsQuery,
  type ReferralStatus,
  type ReferralSummaryDto,
} from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient, Tx } from "../../db/client";
import { toJobReferralLinkDto, toReferralDto } from "../../dto/referrals.dto";
import { AppError } from "../../lib/errors";
import { runInTransaction } from "../../lib/transaction";
import { blocksBetween, limitLockWait, lockPair } from "../../repositories/chat.repo";
import { insertChatReport } from "../../repositories/chatReports.repo";
import { findJobWithAuthor, lockJob, type JobRow, type JobWithAuthor } from "../../repositories/jobs.repo";
import { findMembershipById, listMembershipsForUser, lockMembership } from "../../repositories/memberships.repo";
import {
  closeReferralsLeftBehind,
  closeReferralsOf,
  closeWaitingForJob,
  countRequestsAboutJob,
  countVisibleWaitingForJob,
  countWaitingFromRequester,
  countWaitingIn,
  detachFromJobsOf,
  findLatestReferral,
  findReferral,
  findStandingReferral,
  hasReportedReferralNote,
  insertReferral,
  listReferrals,
  lockReferral,
  updateReferral,
  type ReferralListRow,
  type ReferralRow,
} from "../../repositories/referrals.repo";
import type { MembershipRow, TenantContext, TenantRow } from "../../types/request";
import { recordAuditStrict } from "../audit.service";
import { blockedByYou, contactUnavailable, freshChatTenant, isReachable, type ChatTenant } from "../chat/common";
import { openDirectFromOrigin } from "../chat/open";
import { assertCanView, canView, type ContentActor } from "../content.common";
import { notify, notifyTenantAdmins } from "../notifications/notification.service";
import { publishReferralChanged } from "./events";
import { transitionReferral, type ReferralAction, type ReferralSide } from "./transitions";

const requestNotFound = () => AppError.notFound("Referral request not found");
const jobNotFound = () => AppError.notFound("Job not found");
const notTakingRequests = () => AppError.conflict("This job isn't taking referral requests", "CONTACT_UNAVAILABLE");

/**
 * The institution as it is now, for anything that starts something: the request's copy can be 300 seconds old. Referrals
 * need jobs and messaging, because accepting one opens a private chat.
 */
async function freshReferralTenant(db: DbClient, tenantId: string): Promise<ChatTenant> {
  const tenant = await freshChatTenant(db, tenantId);
  if (!referralsEnabled(tenant.features)) throw AppError.forbidden("Referral requests are switched off for this institution", "FEATURE_DISABLED");
  return tenant;
}

/** Audit rows for member actions name the request and nothing anyone wrote. */
function auditOf(tenantId: string, actor: ContentActor, action: string, referralId: string) {
  return { tenantId, actorUserId: actor.userId, actorMembershipId: actor.membership.id, action, targetType: "referral", targetId: referralId, ip: actor.ip };
}

/** A job takes new referral requests while it's open (`jobIsOpen`) and its poster offered. */
const takesRequests = (job: JobRow, now: Date): boolean => job.canRefer && jobIsOpen(job, now);

/** Whether the viewer can open the job's page now, as its own route would decide. */
const jobOpenTo = (actor: ContentActor, found: JobWithAuthor | null | undefined): boolean => !!found && canView(actor, found.job.moderationStatus, found.job.authorMembershipId, found.author.status);

/** What a member is told when an earlier request about the same job stands in the way. */
const STANDING: Partial<Record<ReferralStatus, string>> = {
  REQUESTED: "You've already asked for a referral for this job. Wait for an answer, or withdraw your request.",
  ACCEPTED: "The poster has already accepted your referral request for this job",
  DECLINED: "The poster declined your referral request for this job, so you can't ask again",
};

// --- Jobs ---

/**
 * A job's own page, with what only this viewer may know about referrals on it: their own latest request, and for its poster
 * how many requests wait for an answer. Requesters never learn of each other, or how many there are.
 */
export async function toJobDetail(db: DbClient, tenant: Pick<TenantRow, "id" | "type" | "timezone">, viewerMembershipId: string, row: JobWithAuthor, dto: JobDto): Promise<JobDetailDto> {
  if (row.job.authorMembershipId === viewerMembershipId) {
    return { ...dto, myReferral: null, referralAskRefusal: null, pendingReferralCount: await countWaitingIn(db, tenant, viewerMembershipId, "received", new Date(), row.job.id) };
  }
  const latest = await findLatestReferral(db, tenant.id, row.job.id, viewerMembershipId);
  const referralAskRefusal = dto.canRefer ? await askRefusalOf(db, row.job.id, viewerMembershipId, row.job.authorMembershipId) : null;
  return { ...dto, myReferral: latest ? toJobReferralLinkDto(latest) : null, referralAskRefusal, pendingReferralCount: null };
}

/**
 * What of the viewer's own would refuse their asking about this job, in the order requestReferral checks: a block they made,
 * then how many times they've asked. Their requests count whether or not the poster saw them, and a block the poster made
 * isn't looked at, so nothing here gives that away.
 */
async function askRefusalOf(db: DbClient, jobId: string, me: string, posterId: string): Promise<ReferralAskRefusal | null> {
  if ((await blocksBetween(db, me, posterId)).byMe) return "YOU_BLOCKED";
  if ((await countRequestsAboutJob(db, jobId, me)) >= REFERRAL_MAX_REQUESTS_PER_JOB) return "LIMIT";
  return null;
}

/**
 * Inside the transaction that stops a job taking referral requests, once its row is locked or written: closing, deleting,
 * rejecting or removing it, or its poster unticking "I can refer". Everything waiting closes, and each sender is told, one
 * the poster had blocked included: theirs must read like any unanswered request, and the notice goes to them alone, so the
 * poster learns nothing. Requests already answered stay as they are, and a chat an acceptance opened stays open.
 */
export async function closeReferralsForJob(ctx: AppContext, tx: Tx, tenant: Pick<TenantRow, "id" | "slug">, jobId: string): Promise<void> {
  const closed = await closeWaitingForJob(tx, jobId, new Date());
  if (closed.length === 0) return;
  const real = closed.filter((r) => !r.suppressed);
  for (const r of closed) {
    if (!r.requesterMembershipId) continue;
    await notify(
      ctx,
      {
        tenantId: tenant.id,
        recipientMembershipIds: [r.requesterMembershipId],
        type: "REFERRAL_DECLINED",
        title: "Your referral request was closed",
        body: `${r.jobTitle} at ${r.jobCompany} is no longer taking referral requests.`,
        data: { referralId: r.id, box: "sent" },
        dedupeKey: `referral-closed-${r.id}`,
      },
      tx,
    );
  }
  // Every sender's copy changed, suppressed ones included, as theirs reads like any other. The poster's list changed only if they could see one.
  await publishReferralChanged(ctx, tx, tenant.slug, [real.length > 0 ? real[0]!.posterMembershipId : null, ...closed.map((r) => r.requesterMembershipId)]);
}

// --- Asking ---

/**
 * Asks a job's poster for a referral, with a note. Whoever the poster has blocked gets the same answer as anyone else, from
 * the same checks in the same order, and the request is stored suppressed: the poster never sees it, nobody is told and
 * nothing is audited, and its sender reads it as a request still waiting for an answer, for good. Every limit counts it like
 * any other, except the one on what waits for the job, which counts only what its poster can see, so a member they blocked
 * can't use it up.
 */
export async function requestReferral(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, jobId: string, input: { note: string }): Promise<ReferralDto> {
  const tenantId = tenantCtx.tenant.id;
  const me = actor.membership.id;
  const { row, poster } = await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const tenant = await freshReferralTenant(tx, tenantId);
    const found = await findJobWithAuthor(tx, tenantId, jobId);
    if (!found) throw jobNotFound();
    assertCanView(actor, found.job.moderationStatus, found.job.authorMembershipId, "Job", found.author.status);
    const poster = found.author;
    if (poster.id === me) throw AppError.badRequest("You can't ask for a referral to your own job");
    if (!isReachable(tenant, actor.membership)) throw AppError.forbidden("Referral requests aren't available to current pupils", "FEATURE_DISABLED");
    // The member first, so two of their requests can't both squeeze under their limits, then the pair, which a block also
    // takes, then the job, which closing it also takes, so a request can't slip in behind a close that missed it.
    await lockMembership(tx, tenantId, me);
    await lockPair(tx, tenantId, me, poster.id);
    const blocks = await blocksBetween(tx, me, poster.id);
    if (blocks.byMe) throw blockedByYou();
    const job = await lockJob(tx, tenantId, jobId);
    if (!job) throw jobNotFound();
    const now = new Date();
    if (!takesRequests(job, now)) throw notTakingRequests();
    if (!isReachable(tenant, poster)) throw contactUnavailable();

    const standing = await findStandingReferral(tx, job.id, me);
    if (standing) throw AppError.conflict(STANDING[standing.status] ?? "You've already asked for a referral for this job");
    if ((await countRequestsAboutJob(tx, job.id, me)) >= REFERRAL_MAX_REQUESTS_PER_JOB) {
      throw AppError.conflict(`You can ask for a referral for one job up to ${REFERRAL_MAX_REQUESTS_PER_JOB} times.`);
    }
    if ((await countWaitingFromRequester(tx, tenantId, me)) >= REFERRAL_MAX_OPEN_PER_REQUESTER) {
      throw AppError.conflict(`You can have up to ${REFERRAL_MAX_OPEN_PER_REQUESTER} referral requests waiting at once. Withdraw one, or wait for answers, to ask someone new.`);
    }
    if ((await countVisibleWaitingForJob(tx, tenant, job.id, now)) >= REFERRAL_MAX_WAITING_PER_JOB) {
      throw AppError.conflict("This job has as many referral requests waiting as its poster can answer. Try again later.");
    }

    const suppressed = blocks.byOther;
    const row = await insertReferral(tx, { tenantId, jobId: job.id, jobTitle: job.title, jobCompany: job.companyName, posterMembershipId: poster.id, requesterMembershipId: me, note: input.note, suppressed, createdAt: now, updatedAt: now });
    if (!suppressed) {
      await recordAuditStrict(tx, auditOf(tenantId, actor, "referral.request", row.id));
      // Nobody has agreed to anything yet, so the bell and the lock screen name no one. The job is the poster's own words.
      await notify(ctx, { tenantId, recipientMembershipIds: [poster.id], type: "REFERRAL_REQUESTED", title: "New referral request", body: `For ${job.title} at ${job.companyName}`, data: { referralId: row.id, jobId: job.id, box: "received" }, dedupeKey: `referral-requested-${row.id}` }, tx);
    }
    await publishReferralChanged(ctx, tx, tenantCtx.tenant.slug, suppressed ? [me] : [me, poster.id]);
    return { row, poster };
  });
  return toReferralDto(row, poster, me, true);
}

// --- Lists ---

function toListDto(actor: ContentActor, r: ReferralListRow): ReferralDto {
  const author = r.referral.posterMembershipId === actor.membership.id ? actor.membership : r.member;
  return toReferralDto(r.referral, r.member, actor.membership.id, jobOpenTo(actor, r.job && author ? { job: r.job, author } : null), r.reported);
}

/** One of the member's own lists. Works whether or not referrals are on for them, as the way out of what they started. */
export async function listMyReferrals(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: ReferralRequestsQuery): Promise<ReferralPageDto> {
  const me = actor.membership.id;
  const now = new Date();
  const page = await listReferrals(ctx.db, tenantCtx.tenant, me, { ...query, now });
  const waiting = await countWaitingIn(ctx.db, tenantCtx.tenant, me, query.box, now);
  return { data: page.data.map((r) => toListDto(actor, r)), nextCursor: page.nextCursor, waiting };
}

/** The requests about one job, for its poster alone. Anyone else who can see the job gets a 403, and one who can't a 404. */
export async function listJobReferrals(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, jobId: string, query: CursorQuery): Promise<ReferralPageDto> {
  const me = actor.membership.id;
  const found = await findJobWithAuthor(ctx.db, tenantCtx.tenant.id, jobId);
  if (!found) throw jobNotFound();
  if (found.job.authorMembershipId !== me) {
    assertCanView(actor, found.job.moderationStatus, found.job.authorMembershipId, "Job", found.author.status);
    throw AppError.forbidden("Only the job's poster can see its referral requests");
  }
  const now = new Date();
  const page = await listReferrals(ctx.db, tenantCtx.tenant, me, { box: "received", jobId, ...query, now });
  const waiting = await countWaitingIn(ctx.db, tenantCtx.tenant, me, "received", now, jobId);
  return { data: page.data.map((r) => toListDto(actor, r)), nextCursor: page.nextCursor, waiting };
}

/** What the member still has waiting, sent or received, even while referrals are off for them. */
export async function getReferralSummary(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor): Promise<ReferralSummaryDto> {
  const now = new Date();
  const received = await countWaitingIn(ctx.db, tenantCtx.tenant, actor.membership.id, "received", now);
  const sent = await countWaitingIn(ctx.db, tenantCtx.tenant, actor.membership.id, "sent", now);
  return { received, sent };
}

// --- Answering and withdrawing ---

const sideOf = (r: ReferralRow, membershipId: string): ReferralSide | null => (r.posterMembershipId === membershipId ? "POSTER" : r.requesterMembershipId === membershipId ? "REQUESTER" : null);

/**
 * The request, locked, and which side of it this member is on. Anyone else, and a poster asking about a request they were
 * never shown, gets a 404. The pair's lock comes first, as for a request or a block, so none of them can deadlock another.
 */
async function lockForAction(tx: Tx, tenantId: string, me: string, id: string): Promise<{ row: ReferralRow; side: ReferralSide }> {
  const visible = (r: ReferralRow | undefined) => {
    const side = r && sideOf(r, me);
    return side && !(side === "POSTER" && r.suppressed) ? side : null;
  };
  const found = await findReferral(tx, tenantId, id);
  if (!visible(found)) throw requestNotFound();
  if (found!.posterMembershipId && found!.requesterMembershipId) await lockPair(tx, tenantId, found!.posterMembershipId, found!.requesterMembershipId);
  const row = await lockReferral(tx, tenantId, id);
  const side = visible(row);
  if (!row || !side) throw requestNotFound();
  return { row, side };
}

const otherOf = async (tx: Tx, tenantId: string, row: ReferralRow, side: ReferralSide): Promise<MembershipRow | null> => {
  const id = side === "POSTER" ? row.requesterMembershipId : row.posterMembershipId;
  return id ? ((await findMembershipById(tx, tenantId, id)) ?? null) : null;
};

/** The request as the viewer now sees it, with whether its job's page is theirs to open. */
async function asSeenBy(tx: Tx, tenantId: string, actor: ContentActor, row: ReferralRow, other: MembershipRow | null, reported: boolean): Promise<ReferralDto> {
  const found = row.jobId ? await findJobWithAuthor(tx, tenantId, row.jobId) : undefined;
  return toReferralDto(row, other, actor.membership.id, jobOpenTo(actor, found), reported);
}

/**
 * Runs one member's action on a request in a transaction and returns it as they now see it. Both members' devices hear that
 * it changed, except a poster who was never shown it.
 */
async function act(
  ctx: AppContext,
  tenantCtx: TenantContext,
  actor: ContentActor,
  id: string,
  action: ReferralAction,
  fn: (tx: Tx, row: ReferralRow, side: ReferralSide, now: Date) => Promise<{ row: ReferralRow; other: MembershipRow | null }>,
): Promise<ReferralDto> {
  const me = actor.membership.id;
  const tenantId = tenantCtx.tenant.id;
  return runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const { row, side } = await lockForAction(tx, tenantId, me, id);
    transitionReferral(row.status, action, side);
    const done = await fn(tx, row, side, new Date());
    await publishReferralChanged(ctx, tx, tenantCtx.tenant.slug, row.suppressed ? [me] : [row.posterMembershipId, row.requesterMembershipId]);
    return asSeenBy(tx, tenantId, actor, done.row, done.other, side === "POSTER" && (await hasReportedReferralNote(tx, row.id, me)));
  });
}

/**
 * Accepts, in one transaction: with the row and the pair locked and the request still waiting, both members and the
 * institution's switches are read again now, then the pair's chat opens with the note as the requester's first message. An
 * accepted chat they already had is reused and keeps what started it. Whatever later happens to the job, the chat stays.
 */
export async function acceptReferral(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<ReferralDto> {
  const tenantId = tenantCtx.tenant.id;
  return act(ctx, tenantCtx, actor, id, "accept", async (tx, row, side, now) => {
    const tenant = await freshReferralTenant(tx, tenantId);
    const requester = await otherOf(tx, tenantId, row, side);
    const poster = await findMembershipById(tx, tenantId, actor.membership.id);
    if (!requester || !poster || !isReachable(tenant, requester) || !isReachable(tenant, poster)) throw contactUnavailable();
    const { conversationId } = await openDirectFromOrigin(ctx, tx, {
      tenantId,
      aId: requester.id,
      bId: poster.id,
      origin: "REFERRAL",
      originId: row.id,
      seedMessage: { senderMembershipId: requester.id, body: row.note },
      actorMembershipId: poster.id,
      quiet: true,
    });
    const updated = await updateReferral(tx, row.id, { status: "ACCEPTED", respondedAt: now, acceptedAt: now, conversationId });
    await recordAuditStrict(tx, auditOf(tenantId, actor, "referral.accept", row.id));
    await notify(
      ctx,
      {
        tenantId,
        recipientMembershipIds: [requester.id],
        type: "REFERRAL_ACCEPTED",
        title: `${poster.fullName} accepted your referral request`,
        body: `For ${row.jobTitle} at ${row.jobCompany}`,
        data: { referralId: row.id, conversationId, box: "sent" },
        dedupeKey: `referral-accepted-${row.id}`,
      },
      tx,
    );
    return { row: updated, other: requester };
  });
}

/** What a declined request's sender is told, by the poster's name: the same whether the poster declined it or reported it. */
async function notifyDeclined(ctx: AppContext, tx: Tx, tenantId: string, declined: ReferralRow, posterName: string): Promise<void> {
  if (!declined.requesterMembershipId) return;
  await notify(
    ctx,
    {
      tenantId,
      recipientMembershipIds: [declined.requesterMembershipId],
      type: "REFERRAL_DECLINED",
      title: `${posterName} declined your referral request`,
      body: `For ${declined.jobTitle} at ${declined.jobCompany}`,
      data: { referralId: declined.id, box: "sent" },
      dedupeKey: `referral-declined-${declined.id}`,
    },
    tx,
  );
}

/** The poster says no. Its sender is told, by the poster's name, and can't ask again about this job. Works with messaging off: a way out. */
export async function declineReferral(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<ReferralDto> {
  const tenantId = tenantCtx.tenant.id;
  return act(ctx, tenantCtx, actor, id, "decline", async (tx, row, side, now) => {
    const updated = await updateReferral(tx, row.id, { status: "DECLINED", respondedAt: now });
    await recordAuditStrict(tx, auditOf(tenantId, actor, "referral.decline", row.id));
    await notifyDeclined(ctx, tx, tenantId, updated, actor.membership.fullName);
    return { row: updated, other: await otherOf(tx, tenantId, row, side) };
  });
}

/** Its sender takes a request back before it's answered. Nobody is told: it just reads as withdrawn on the poster's list. */
export async function withdrawReferral(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<ReferralDto> {
  const tenantId = tenantCtx.tenant.id;
  return act(ctx, tenantCtx, actor, id, "withdraw", async (tx, row, side, now) => {
    const updated = await updateReferral(tx, row.id, { status: "WITHDRAWN", closedAt: now });
    // A request the poster never saw was never audited, so its withdrawal isn't either, or the gap would show.
    if (!row.suppressed) await recordAuditStrict(tx, auditOf(tenantId, actor, "referral.withdraw", row.id));
    return { row: updated, other: await otherOf(tx, tenantId, row, side) };
  });
}

/**
 * The poster reports a request's note: admins get a report holding only the note, under the chat report rules: the reporter
 * isn't named in the audit log, admins hear that a report exists and nothing it says, and one the report names is left out.
 * A request still waiting is declined, and its sender is told exactly as for the poster declining it, so nothing they see
 * tells a report from a decline; no decline is audited, though, as that row would name the reporter. One already declined,
 * withdrawn or closed can be reported too, and stays as it is, telling nobody, because its poster can still read it. Not once
 * it was accepted, when the note is the chat's first message, reported there. Works with messaging off: a way out.
 */
export async function reportReferralRequest(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, input: ChatReportCreateInput): Promise<ReferralDto> {
  const tenantId = tenantCtx.tenant.id;
  const me = actor.membership.id;
  return runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const { row, side } = await lockForAction(tx, tenantId, me, id);
    if (side !== "POSTER") throw AppError.badRequest("You can't report your own request");
    if (row.acceptedAt) throw AppError.invalidTransition("This request was accepted. Report its messages in your chat instead.");
    const isWaiting = row.status === "REQUESTED";
    if (isWaiting) transitionReferral(row.status, "decline", side);
    const updated = isWaiting ? await updateReferral(tx, row.id, { status: "DECLINED", respondedAt: new Date() }) : row;
    const report = await insertChatReport(tx, {
      tenantId,
      targetKind: "REFERRAL_NOTE",
      targetId: row.id,
      conversationId: null,
      reporterMembershipId: me,
      reportedMembershipId: row.requesterMembershipId,
      reason: input.reason,
      details: input.details ?? null,
      noteSnapshot: row.note,
    });
    if (!report) throw AppError.conflict("You have already reported this request");
    await recordAuditStrict(tx, { tenantId, action: "chat_report.file", targetType: "chat_report", targetId: report.id, metadata: { reason: report.reason, targetKind: report.targetKind } });
    await notifyTenantAdmins(ctx, { tenantId, type: "CHAT_REPORT_FILED", title: "A referral request was reported", data: { chatReportId: report.id }, excludeMembershipIds: [me, row.requesterMembershipId] }, tx);
    // The sender's copy changes only if it was waiting, and then they hear of it just as of a decline.
    if (isWaiting) await notifyDeclined(ctx, tx, tenantId, updated, actor.membership.fullName);
    await publishReferralChanged(ctx, tx, tenantCtx.tenant.slug, isWaiting ? [me, row.requesterMembershipId] : [me]);
    return asSeenBy(tx, tenantId, actor, updated, await otherOf(tx, tenantId, row, side), true);
  });
}

// --- Account deletion ---

/**
 * Inside the account-deletion transaction, beside mentorship's and before the chat's own preparation, so it takes request
 * rows before conversations, as accepting does. Their own waiting requests are withdrawn, and those waiting for them close,
 * as their jobs go with the membership. Nobody is notified, though the other members' lists hear that something changed.
 * Accepted ones stay accepted, and their chats go read-only with the rest of the member's. Returns what to run once the user
 * row is gone, in the same transaction, for a request sent to or by them while this ran (see closeReferralsLeftBehind).
 */
export async function prepareReferralsForAccountDeletion(ctx: AppContext, tx: Tx, userId: string): Promise<() => Promise<void>> {
  await limitLockWait(tx);
  const memberships = await listMembershipsForUser(tx, userId);
  const ids = new Set(memberships.map((m) => m.membership.id));
  const slugOf = new Map(memberships.map((m) => [m.tenant.id, m.tenant.slug]));
  const tellOthers = async (rows: ReferralRow[]) => {
    for (const [tenantId, slug] of slugOf) {
      const here = rows.filter((r) => r.tenantId === tenantId);
      // A poster who never saw a request isn't told it changed.
      const others = here.flatMap((r) => [r.suppressed ? null : r.posterMembershipId, r.requesterMembershipId]).filter((id) => !!id && !ids.has(id));
      if (others.length > 0) await publishReferralChanged(ctx, tx, slug, others);
    }
  };
  await tellOthers(await closeReferralsOf(tx, [...ids], new Date()));
  await detachFromJobsOf(tx, [...ids]);
  return async () => tellOthers(await closeReferralsLeftBehind(tx, [...slugOf.keys()], new Date()));
}
