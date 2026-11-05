import {
  MENTORSHIP_MAX_OPEN_PER_MENTEE,
  MENTORSHIP_MAX_REQUESTS_PER_PAIR,
  MENTORSHIP_REQUEST_WINDOW_DAYS,
  mentorshipAvailable,
  type ChatReportCreateInput,
  type CursorPage,
  type MentorCardDto,
  type MentorDto,
  type MentorProfileDto,
  type MentorProfileUpsert,
  type MentorsQuery,
  type MentorshipBox,
  type MentorshipDto,
  type MentorshipPageDto,
  type MentorshipRequestsQuery,
  type MentorshipSummaryDto,
} from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient, Tx } from "../../db/client";
import { toMentorCardDto, toMentorDto, toMentorProfileDto, toMentorshipDto } from "../../dto/mentorship.dto";
import { AppError } from "../../lib/errors";
import { runInTransaction } from "../../lib/transaction";
import { blocksBetween, limitLockWait, lockPair } from "../../repositories/chat.repo";
import { insertChatReport, lockReportSubject } from "../../repositories/chatReports.repo";
import { findMembershipById, listMembershipsForUser, lockMembership } from "../../repositories/memberships.repo";
import {
  closeMentorshipsLeftBehind,
  closeMentorshipsOf,
  countOpenForMentee,
  countOpenIn,
  countRequestsBetween,
  countWaiting,
  deactivateMentorProfile,
  declineWaitingFor,
  endedMentorshipSince,
  findListedMentor,
  findMentorProfile,
  findMentorship,
  findOpenMentorship,
  hasOtherAcceptedMentorship,
  hasReportedNote,
  insertMentorship,
  listMentors,
  listMentorships,
  lockMentorProfileForShare,
  lockMentorship,
  updateMentorship,
  upsertMentorProfile,
  type MentorshipRow,
} from "../../repositories/mentorship.repo";
import { hasAcceptedReferralBetween } from "../../repositories/referrals.repo";
import type { MembershipRow, TenantContext } from "../../types/request";
import { recordAuditStrict } from "../audit.service";
import { blockedByYou, contactUnavailable, freshChatTenant, isReachable, type ChatTenant } from "../chat/common";
import { closeOriginConversation, openDirectFromOrigin } from "../chat/open";
import { alertStaffIfEscalated } from "../chat/staffAlerts.service";
import type { ContentActor } from "../content.common";
import { assertNoOpenReportAboutActor, recordingRefusal, type Actor as MemberAdminActor } from "../membership.service";
import { notify, notifyTenantAdmins } from "../notifications/notification.service";
import { publishMentorshipChanged } from "./events";
import { transitionMentorship, type MentorshipAction, type MentorshipSide } from "./transitions";

const DAY_MS = 24 * 60 * 60 * 1000;

const requestNotFound = () => AppError.notFound("Mentorship request not found");

/**
 * The institution as it is now, for anything that starts something: the request's copy can be 300 seconds old. Mentorship
 * needs messaging, which a resolved map already says.
 */
async function freshMentorshipTenant(db: DbClient, tenantId: string): Promise<ChatTenant> {
  const tenant = await freshChatTenant(db, tenantId);
  if (!mentorshipAvailable(tenant.features, true)) throw AppError.forbidden("Mentorship is switched off for this institution", "FEATURE_DISABLED");
  return tenant;
}

/** Audit rows for member actions name the mentorship and nothing anyone wrote. */
function auditOf(tenantId: string, actor: ContentActor, action: string, target: { type: "mentorship" | "membership"; id: string }) {
  return { tenantId, actorUserId: actor.userId, actorMembershipId: actor.membership.id, action, targetType: target.type, targetId: target.id, ip: actor.ip };
}

/**
 * Each mentee whose request was declined hears of it, a request the mentor never saw included: its sender sees it change
 * just as the others do, so telling only the rest would show the block. The notice goes to its sender alone, so the mentor
 * learns nothing of it. `title` says it: by the mentor's name when they declined, and without saying anyone declined when an
 * admin took the mentor off the list. A report's decline is told the same way as the mentor's own.
 */
async function notifyDeclined(ctx: AppContext, tx: Tx, tenantId: string, declined: MentorshipRow[], title: string, body: string | null = null): Promise<void> {
  for (const m of declined) {
    if (!m.menteeMembershipId) continue;
    await notify(ctx, { tenantId, recipientMembershipIds: [m.menteeMembershipId], type: "MENTORSHIP_DECLINED", title, body, data: { mentorshipId: m.id, box: "sent" }, dedupeKey: `mentorship-declined-${m.id}` }, tx);
  }
}

const declinedBy = (mentorName: string) => `${mentorName} declined your mentorship request`;

// --- Being a mentor ---

export async function getMyMentorProfile(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor): Promise<MentorProfileDto | null> {
  const row = await findMentorProfile(ctx.db, tenantCtx.tenant.id, actor.membership.id);
  return row ? toMentorProfileDto(row) : null;
}

/** Offers to mentor, or edits the offer. Offering again after stopping starts from what they wrote last time. */
export async function saveMyMentorProfile(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: MentorProfileUpsert): Promise<MentorProfileDto> {
  const tenantId = tenantCtx.tenant.id;
  const me = actor.membership.id;
  const row = await runInTransaction(ctx, async (tx) => {
    const before = await findMentorProfile(tx, tenantId, me);
    const saved = await upsertMentorProfile(tx, { tenantId, membershipId: me, areas: input.areas, availability: input.availability, availabilityNote: input.availabilityNote, note: input.note });
    if (!before?.isActive) await recordAuditStrict(tx, auditOf(tenantId, actor, "mentor.optin", { type: "membership", id: me }));
    await publishMentorshipChanged(ctx, tx, tenantCtx.tenant.slug, [me]);
    return saved;
  });
  return toMentorProfileDto(row);
}

/**
 * Stops mentoring. Requests waiting are declined, each mentee told as for any decline, the sender of a request the mentor
 * never saw included, so nothing shows the block. Mentorships under way carry on. Works with mentorship switched off,
 * because it's a way out. A request being sent at the same moment either lands first and is declined here, or sees the
 * mentor gone.
 */
export async function stopMentoring(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor): Promise<void> {
  const tenantId = tenantCtx.tenant.id;
  const me = actor.membership.id;
  await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const before = await findMentorProfile(tx, tenantId, me);
    await deactivateMentorProfile(tx, tenantId, me);
    const declined = await declineWaitingFor(tx, tenantId, me, new Date());
    await notifyDeclined(ctx, tx, tenantId, declined, declinedBy(actor.membership.fullName));
    if (before?.isActive) await recordAuditStrict(tx, auditOf(tenantId, actor, "mentor.optout", { type: "membership", id: me }));
    // Their senders too, suppressed ones included: theirs changes just as the others' do, so telling only some would show which.
    await publishMentorshipChanged(ctx, tx, tenantCtx.tenant.slug, [me, ...declined.map((m) => m.menteeMembershipId)]);
  });
}

/** What a member still has in mentorship: whether they're listed, and what's open in their two lists. */
export async function getMentorshipSummary(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor): Promise<MentorshipSummaryDto> {
  const { tenant } = tenantCtx;
  const me = actor.membership.id;
  const now = new Date();
  const [profile, received, sent] = await Promise.all([findMentorProfile(ctx.db, tenant.id, me), countOpenIn(ctx.db, tenant, me, "received", now), countOpenIn(ctx.db, tenant, me, "sent", now)]);
  return { listed: !!profile?.isActive, open: received + sent };
}

// --- Finding a mentor ---

export async function findMentors(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: MentorsQuery): Promise<CursorPage<MentorCardDto>> {
  const page = await listMentors(ctx.db, tenantCtx.tenant, actor.membership.id, { ...query, now: new Date() });
  return { data: page.data.map((r) => toMentorCardDto(r.profile, r.member)), nextCursor: page.nextCursor };
}

/** One mentor's page. Someone the list leaves out, including a mentor the viewer blocked, is a 404 here too. */
export async function getMentor(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, membershipId: string): Promise<MentorDto> {
  const me = actor.membership.id;
  const found = await findListedMentor(ctx.db, tenantCtx.tenant, me, membershipId, new Date());
  if (!found) throw AppError.notFound("This mentor isn't available");
  const mine = found.member.id === me ? undefined : await findOpenMentorship(ctx.db, tenantCtx.tenant.id, found.member.id, me);
  return toMentorDto(found.profile, found.member, me, mine);
}

/**
 * Asks a mentor, with a note. Whoever the mentor has blocked gets the same answer as anyone else, from the same checks in the
 * same order, and the request is stored suppressed: the mentor never sees it, nobody is told and nothing is audited, and its
 * sender reads it as a request still waiting for an answer, for good. Every limit counts it like any other.
 */
export async function requestMentorship(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: { mentorMembershipId: string; note: string }): Promise<MentorshipDto> {
  const tenantId = tenantCtx.tenant.id;
  const me = actor.membership.id;
  if (input.mentorMembershipId === me) throw AppError.badRequest("You can't ask yourself to be your mentor");
  const { row, mentor } = await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const tenant = await freshMentorshipTenant(tx, tenantId);
    const mentor = await findMembershipById(tx, tenantId, input.mentorMembershipId);
    if (!mentor) throw AppError.notFound("Member not found");
    // The member first, so that two of their requests to different mentors can't both squeeze under the limit, then the pair, which a block also takes.
    await lockMembership(tx, tenantId, me);
    await lockPair(tx, tenantId, me, mentor.id);
    const blocks = await blocksBetween(tx, me, mentor.id);
    if (blocks.byMe) throw blockedByYou();
    // Held until this commits, so the mentor stopping, or being taken off the list, can't miss this request (see the repo).
    const profile = await lockMentorProfileForShare(tx, tenantId, mentor.id);
    if (!profile?.isActive || !isReachable(tenant, mentor)) throw contactUnavailable();

    const open = await findOpenMentorship(tx, tenantId, mentor.id, me);
    if (open) throw AppError.conflict(open.status === "ACCEPTED" ? "They're already your mentor" : "You've already asked this mentor. Wait for their answer, or withdraw your request.");
    const now = new Date();
    const windowStart = new Date(now.getTime() - MENTORSHIP_REQUEST_WINDOW_DAYS * DAY_MS);
    // Ending a mentorship closes its chat until a month has passed, so a new request mustn't be a way back in sooner.
    if (await endedMentorshipSince(tx, tenantId, mentor.id, me, windowStart)) {
      throw AppError.conflict(`Your mentorship with them ended recently. You can ask them again ${MENTORSHIP_REQUEST_WINDOW_DAYS} days after it ended.`);
    }
    if ((await countRequestsBetween(tx, tenantId, mentor.id, me, windowStart)) >= MENTORSHIP_MAX_REQUESTS_PER_PAIR) {
      throw AppError.conflict(`You can ask one mentor up to ${MENTORSHIP_MAX_REQUESTS_PER_PAIR} times in ${MENTORSHIP_REQUEST_WINDOW_DAYS} days. Try again later.`);
    }
    if ((await countOpenForMentee(tx, tenantId, me)) >= MENTORSHIP_MAX_OPEN_PER_MENTEE) {
      throw AppError.conflict(`You can have up to ${MENTORSHIP_MAX_OPEN_PER_MENTEE} requests and mentorships open at once. Withdraw a request or end a mentorship to ask someone new.`);
    }

    const suppressed = blocks.byOther;
    const row = await insertMentorship(tx, { tenantId, mentorMembershipId: mentor.id, menteeMembershipId: me, note: input.note, suppressed, createdAt: now, updatedAt: now });
    if (!suppressed) {
      await recordAuditStrict(tx, auditOf(tenantId, actor, "mentorship.request", { type: "mentorship", id: row.id }));
      // Nobody has agreed to anything yet, so the bell and the lock screen name no one.
      await notify(ctx, { tenantId, recipientMembershipIds: [mentor.id], type: "MENTORSHIP_REQUESTED", title: "New mentorship request", data: { mentorshipId: row.id, box: "received" }, dedupeKey: `mentorship-requested-${row.id}` }, tx);
    }
    await publishMentorshipChanged(ctx, tx, tenantCtx.tenant.slug, suppressed ? [me] : [me, mentor.id]);
    return { row, mentor };
  });
  return toMentorshipDto(row, mentor, me);
}

// --- Requests ---

export async function listMyMentorships(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: MentorshipRequestsQuery): Promise<MentorshipPageDto> {
  const me = actor.membership.id;
  const now = new Date();
  const [page, waiting] = await Promise.all([listMentorships(ctx.db, tenantCtx.tenant, me, { ...query, now }), countWaiting(ctx.db, tenantCtx.tenant, me, query.box, now)]);
  return { data: page.data.map((r) => toMentorshipDto(r.mentorship, r.member, me, r.reported)), nextCursor: page.nextCursor, waiting };
}

const sideOf = (m: MentorshipRow, membershipId: string): MentorshipSide | null => (m.mentorMembershipId === membershipId ? "MENTOR" : m.menteeMembershipId === membershipId ? "MENTEE" : null);

/**
 * The mentorship, locked, and which side of it this member is on. Anyone else, and a mentor asking about a request they were
 * never shown, gets a 404. The pair's lock comes first, as for a request or a block, so none of them can deadlock another.
 */
async function lockForAction(tx: Tx, tenantId: string, me: string, id: string): Promise<{ row: MentorshipRow; side: MentorshipSide }> {
  const visible = (m: MentorshipRow | undefined) => {
    const side = m && sideOf(m, me);
    return side && !(side === "MENTOR" && m.suppressed) ? side : null;
  };
  const found = await findMentorship(tx, tenantId, id);
  if (!visible(found)) throw requestNotFound();
  if (found!.mentorMembershipId && found!.menteeMembershipId) await lockPair(tx, tenantId, found!.mentorMembershipId, found!.menteeMembershipId);
  const row = await lockMentorship(tx, tenantId, id);
  const side = visible(row);
  if (!row || !side) throw requestNotFound();
  return { row, side };
}

/**
 * Whether something else still connects the pair one to one, so ending this mustn't close their chat: another mentorship
 * under way between them, or a referral one of them accepted for the other, in either direction. A referral is never ended,
 * so once accepted it keeps a chat open for good.
 */
async function hasOtherLiveConnection(db: DbClient, tenantId: string, aId: string, bId: string, mentorshipId: string): Promise<boolean> {
  return (await hasOtherAcceptedMentorship(db, tenantId, aId, bId, mentorshipId)) || (await hasAcceptedReferralBetween(db, tenantId, aId, bId));
}

interface ActionResult {
  row: MentorshipRow;
  other: MembershipRow | null;
}

/**
 * Runs one member's action on a mentorship in a transaction and returns it as they now see it. Both members' devices hear
 * that it changed, except a mentor who was never shown it.
 */
async function act(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, action: MentorshipAction, fn: (tx: Tx, row: MentorshipRow, side: MentorshipSide, now: Date) => Promise<ActionResult>): Promise<MentorshipDto> {
  const me = actor.membership.id;
  const result = await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const { row, side } = await lockForAction(tx, tenantCtx.tenant.id, me, id);
    transitionMentorship(row.status, action, side);
    const done = await fn(tx, row, side, new Date());
    await publishMentorshipChanged(ctx, tx, tenantCtx.tenant.slug, row.suppressed ? [me] : [row.mentorMembershipId, row.menteeMembershipId]);
    return { ...done, reported: side === "MENTOR" && (await hasReportedNote(tx, row.id, me)) };
  });
  return toMentorshipDto(result.row, result.other, me, result.reported);
}

const otherOf = (tx: Tx, tenantId: string, row: MentorshipRow, side: MentorshipSide) => {
  const id = side === "MENTOR" ? row.menteeMembershipId : row.mentorMembershipId;
  return id ? findMembershipById(tx, tenantId, id).then((m) => m ?? null) : Promise.resolve(null);
};

/**
 * Accepts, in one transaction: with the row and the pair locked and the request still waiting, both members and the
 * institution's switches are read again now, then the pair's chat opens with the note as the mentee's first message. An
 * accepted chat they already had is reused and keeps what started it.
 */
export async function acceptMentorship(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<MentorshipDto> {
  const tenantId = tenantCtx.tenant.id;
  return act(ctx, tenantCtx, actor, id, "accept", async (tx, row, side, now) => {
    const tenant = await freshMentorshipTenant(tx, tenantId);
    const mentee = await otherOf(tx, tenantId, row, side);
    const mentor = await findMembershipById(tx, tenantId, actor.membership.id);
    if (!mentee || !mentor || !isReachable(tenant, mentee) || !isReachable(tenant, mentor)) throw contactUnavailable();
    // A mentor who has stopped, or was taken off the list, has had what was waiting declined; one that slipped past that
    // still can't be accepted. Read without a lock: stopping takes the profile first and then this row, which is held here.
    if (!(await findMentorProfile(tx, tenantId, mentor.id))?.isActive) throw contactUnavailable();
    const { conversationId } = await openDirectFromOrigin(ctx, tx, {
      tenantId,
      aId: mentee.id,
      bId: mentor.id,
      origin: "MENTORSHIP",
      originId: row.id,
      seedMessage: { senderMembershipId: mentee.id, body: row.note },
      actorMembershipId: mentor.id,
      quiet: true,
    });
    const updated = await updateMentorship(tx, row.id, { status: "ACCEPTED", respondedAt: now, acceptedAt: now, conversationId });
    await recordAuditStrict(tx, auditOf(tenantId, actor, "mentorship.accept", { type: "mentorship", id: row.id }));
    await notify(
      ctx,
      { tenantId, recipientMembershipIds: [mentee.id], type: "MENTORSHIP_ACCEPTED", title: `${mentor.fullName} accepted your mentorship request`, data: { mentorshipId: row.id, conversationId, box: "sent" }, dedupeKey: `mentorship-accepted-${row.id}` },
      tx,
    );
    return { row: updated, other: mentee };
  });
}

export async function declineMentorship(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<MentorshipDto> {
  const tenantId = tenantCtx.tenant.id;
  return act(ctx, tenantCtx, actor, id, "decline", async (tx, row, side, now) => {
    const updated = await updateMentorship(tx, row.id, { status: "DECLINED", respondedAt: now });
    await recordAuditStrict(tx, auditOf(tenantId, actor, "mentorship.decline", { type: "mentorship", id: row.id }));
    await notifyDeclined(ctx, tx, tenantId, [updated], declinedBy(actor.membership.fullName));
    return { row: updated, other: await otherOf(tx, tenantId, row, side) };
  });
}

/** The mentee takes a request back before it's answered. Nobody is told: it just reads as withdrawn on the mentor's list. */
export async function withdrawMentorship(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<MentorshipDto> {
  const tenantId = tenantCtx.tenant.id;
  return act(ctx, tenantCtx, actor, id, "withdraw", async (tx, row, side, now) => {
    const updated = await updateMentorship(tx, row.id, { status: "ENDED", endedAt: now, endedByMembershipId: actor.membership.id });
    // A request the mentor never saw was never audited, so its withdrawal isn't either, or the gap would show.
    if (!row.suppressed) await recordAuditStrict(tx, auditOf(tenantId, actor, "mentorship.withdraw", { type: "mentorship", id: row.id }));
    return { row: updated, other: await otherOf(tx, tenantId, row, side) };
  });
}

/**
 * Either side ends a mentorship under way. Its chat closes, read-only, but only if this mentorship is what opened it and
 * nothing else still connects the two: a chat they had anyway stays as it was.
 */
export async function endMentorship(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<MentorshipDto> {
  const tenantId = tenantCtx.tenant.id;
  return act(ctx, tenantCtx, actor, id, "end", async (tx, row, side, now) => {
    const updated = await updateMentorship(tx, row.id, { status: "ENDED", endedAt: now, endedByMembershipId: actor.membership.id });
    const { mentorMembershipId: mentorId, menteeMembershipId: menteeId } = row;
    if (row.conversationId && mentorId && menteeId) {
      await closeOriginConversation(ctx, tx, { tenantId, conversationId: row.conversationId, hasOtherLiveConnection: await hasOtherLiveConnection(tx, tenantId, mentorId, menteeId, row.id) });
    }
    await recordAuditStrict(tx, auditOf(tenantId, actor, "mentorship.end", { type: "mentorship", id: row.id }));
    const other = await otherOf(tx, tenantId, row, side);
    if (other) {
      const theirBox: MentorshipBox = side === "MENTOR" ? "sent" : "received";
      await notify(
        ctx,
        { tenantId, recipientMembershipIds: [other.id], type: "MENTORSHIP_ENDED", title: `${actor.membership.fullName} ended your mentorship`, data: { mentorshipId: row.id, box: theirBox }, dedupeKey: `mentorship-ended-${row.id}` },
        tx,
      );
    }
    return { row: updated, other };
  });
}

/**
 * The mentor reports a request's note: admins get a report holding only the note, under the chat report rules: the reporter
 * isn't named in the audit log, admins hear that a report exists and nothing it says, and one the report names is left out.
 * A request still waiting is declined, and its mentee is told exactly as for the mentor declining it, so nothing they see
 * tells a report from a decline; no decline is audited, though, as that row would name the reporter. One already declined
 * or withdrawn can be reported too, and stays as it is, telling nobody, because its mentor can still read it: withdrawing
 * mustn't take a note out of reach of a report. Not once it was accepted, when the note is the chat's first message,
 * reported there. Works with mentorship switched off: a way out.
 */
export async function reportMentorshipRequest(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, input: ChatReportCreateInput): Promise<MentorshipDto> {
  const tenantId = tenantCtx.tenant.id;
  const me = actor.membership.id;
  const result = await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    // Its mentee never changes, so it's read unlocked: the report subject's lock has to come before the pair's.
    const subject = (await findMentorship(tx, tenantId, id))?.menteeMembershipId;
    if (subject) await lockReportSubject(tx, tenantId, subject, "file");
    const { row, side } = await lockForAction(tx, tenantId, me, id);
    if (side !== "MENTOR") throw AppError.badRequest("You can't report your own request");
    if (row.acceptedAt) throw AppError.invalidTransition("This request became a mentorship. Report its messages in your chat instead.");
    const waiting = row.status === "REQUESTED";
    if (waiting) transitionMentorship(row.status, "decline", side);
    const updated = waiting ? await updateMentorship(tx, row.id, { status: "DECLINED", respondedAt: new Date() }) : row;
    const report = await insertChatReport(tx, {
      tenantId,
      targetKind: "MENTORSHIP_NOTE",
      targetId: row.id,
      conversationId: null,
      reporterMembershipId: me,
      reportedMembershipId: row.menteeMembershipId,
      reason: input.reason,
      details: input.details ?? null,
      noteSnapshot: row.note,
    });
    if (!report) throw AppError.conflict("You have already reported this request");
    await recordAuditStrict(tx, { tenantId, action: "chat_report.file", targetType: "chat_report", targetId: report.id, metadata: { reason: report.reason, targetKind: report.targetKind } });
    const forStaff = await alertStaffIfEscalated(ctx, tx, report.id);
    await notifyTenantAdmins(ctx, { tenantId, type: "CHAT_REPORT_FILED", title: "A mentorship request was reported", data: { chatReportId: report.id }, excludeMembershipIds: [me, row.menteeMembershipId], excludeStaff: !forStaff }, tx);
    // The mentee's copy changes only if it was waiting, and then they hear of it just as of a decline.
    if (waiting) await notifyDeclined(ctx, tx, tenantId, [updated], declinedBy(actor.membership.fullName));
    await publishMentorshipChanged(ctx, tx, tenantCtx.tenant.slug, waiting ? [me, row.menteeMembershipId] : [me]);
    return { row: updated, other: await otherOf(tx, tenantId, row, side) };
  });
  return toMentorshipDto(result.row, result.other, me, true);
}

// --- Admins ---

/**
 * Takes a member out of the Mentors list, because a mentor's note can't be reported as chat. Requests waiting for them are
 * declined, or a removed mentor could still accept them, and each mentee is told the request is closed because the mentor
 * isn't taking requests any more, the sender of one the mentor never saw included: not that the mentor declined it, which
 * they didn't, nor that an admin was involved. They can offer again, and suspension is there for anyone who repeats it. An
 * admin an open chat report names can't do it (see assertNoOpenReportAboutActor): a mentor who reported their request could
 * otherwise be taken off the list for it.
 */
export async function removeMentorAsAdmin(ctx: AppContext, tenantCtx: TenantContext, actor: MemberAdminActor, membershipId: string): Promise<MentorProfileDto> {
  const tenantId = tenantCtx.tenant.id;
  const row = await recordingRefusal(ctx, tenantId, actor, "mentor.admin_remove", membershipId, () =>
    runInTransaction(ctx, async (tx) => {
      await limitLockWait(tx);
      await assertNoOpenReportAboutActor(tx, tenantId, actor);
      const member = await findMembershipById(tx, tenantId, membershipId);
      const before = member && (await findMentorProfile(tx, tenantId, member.id));
      if (!member || !before) throw AppError.notFound("This member has no mentor profile");
      const after = (await deactivateMentorProfile(tx, tenantId, member.id))!;
      const declined = await declineWaitingFor(tx, tenantId, member.id, new Date());
      await notifyDeclined(ctx, tx, tenantId, declined, "Your mentorship request was closed", `${member.fullName} isn't taking mentorship requests any more.`);
      if (before.isActive) {
        await recordAuditStrict(tx, { tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId ?? null, action: "mentor.admin_remove", targetType: "membership", targetId: member.id, ip: actor.ip });
      }
      await publishMentorshipChanged(ctx, tx, tenantCtx.tenant.slug, [member.id, ...declined.map((m) => m.menteeMembershipId)]);
      return after;
    }),
  );
  return toMentorProfileDto(row);
}

export async function getMentorProfileForAdmin(ctx: AppContext, tenantId: string, membershipId: string): Promise<MentorProfileDto | null> {
  const row = await findMentorProfile(ctx.db, tenantId, membershipId);
  return row ? toMentorProfileDto(row) : null;
}

// --- Account deletion ---

/**
 * Inside the account-deletion transaction, before the chat's own preparation, so it takes mentorship rows before
 * conversations, as accepting does. Nobody is notified, though the other members' lists hear that something changed. Their
 * mentor profile goes with the membership. Returns what to run once the user row is gone, in the same transaction: a request
 * sent to or by them while this ran is only committed by then (its foreign keys hold the deletion back until it is), so it's
 * closed there, as this would have closed it.
 */
export async function prepareMentorshipsForAccountDeletion(ctx: AppContext, tx: Tx, userId: string): Promise<() => Promise<void>> {
  await limitLockWait(tx);
  const memberships = await listMembershipsForUser(tx, userId);
  const ids = new Set(memberships.map((m) => m.membership.id));
  const slugOf = new Map(memberships.map((m) => [m.tenant.id, m.tenant.slug]));
  const tellOthers = async (rows: MentorshipRow[]) => {
    for (const [tenantId, slug] of slugOf) {
      const others = rows.filter((r) => r.tenantId === tenantId).flatMap((r) => [r.mentorMembershipId, r.menteeMembershipId]).filter((id) => !!id && !ids.has(id));
      if (others.length > 0) await publishMentorshipChanged(ctx, tx, slug, others);
    }
  };
  await tellOthers(await closeMentorshipsOf(tx, [...ids], new Date()));
  return async () => tellOthers(await closeMentorshipsLeftBehind(tx, [...slugOf.keys()], new Date()));
}
