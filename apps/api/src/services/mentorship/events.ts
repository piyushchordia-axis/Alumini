import type { AppContext } from "../../context";
import type { Tx } from "../../db/client";
import { afterCommit } from "../../lib/transaction";
import { rooms } from "../../realtime/rooms";
import { userIdsOfMemberships, type MentorshipRow } from "../../repositories/mentorship.repo";

/**
 * Tells these members' own devices, once `tx` commits, that something of theirs in mentorship or referrals changed, so their
 * lists refetch whatever notifications they get, or don't. It says nothing else. Callers leave out anyone who must never
 * learn of a request, such as a mentor or poster who blocked its sender.
 */
export async function publishConnectionChanged(ctx: AppContext, tx: Tx, event: "mentorship:changed" | "referral:changed", tenantSlug: string, membershipIds: Array<string | null>): Promise<void> {
  const userIds = await userIdsOfMemberships(tx, [...new Set(membershipIds.filter((id): id is string => !!id))]);
  await afterCommit(ctx, tx, async () => {
    if (userIds.length > 0) ctx.realtime.emit(userIds.map(rooms.user), event, { tenantSlug });
  });
}

export const publishMentorshipChanged = (ctx: AppContext, tx: Tx, tenantSlug: string, membershipIds: Array<string | null>) => publishConnectionChanged(ctx, tx, "mentorship:changed", tenantSlug, membershipIds);

/**
 * What a block changed in mentorship, told as it would be had it happened by hand: to the blocker, and to the member blocked
 * only about the blocker's own requests to them, which read as withdrawn. Never about their requests to the blocker, which
 * now go unseen and look to them exactly as before. Nor about a request of the blocker's they never saw, because they had
 * blocked the blocker first: withdrawing that one by hand wouldn't tell them either.
 */
export async function publishBlockOnMentorships(ctx: AppContext, tx: Tx, tenantSlug: string, blockerMembershipId: string, changed: { withdrawn: MentorshipRow[]; suppressed: MentorshipRow[] }): Promise<void> {
  if (changed.withdrawn.length === 0 && changed.suppressed.length === 0) return;
  await publishMentorshipChanged(ctx, tx, tenantSlug, [blockerMembershipId, ...changed.withdrawn.filter((m) => !m.suppressed).map((m) => m.mentorMembershipId)]);
}
