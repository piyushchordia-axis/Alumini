import type { AppContext } from "../../context";
import type { Tx } from "../../db/client";
import { afterCommit } from "../../lib/transaction";
import { rooms } from "../../realtime/rooms";
import { userIdsOfMemberships, type MentorshipRow } from "../../repositories/mentorship.repo";

/**
 * Tells these members' own devices, once `tx` commits, that something of theirs in mentorship changed, so their lists refetch
 * whatever notifications they get, or don't. It says nothing else. Callers leave out a mentor who must never learn of a request.
 */
export async function publishMentorshipChanged(ctx: AppContext, tx: Tx, tenantSlug: string, membershipIds: Array<string | null>): Promise<void> {
  const userIds = await userIdsOfMemberships(tx, [...new Set(membershipIds.filter((id): id is string => !!id))]);
  await afterCommit(ctx, tx, async () => {
    if (userIds.length > 0) ctx.realtime.emit(userIds.map(rooms.user), "mentorship:changed", { tenantSlug });
  });
}

/**
 * What a block changed in mentorship, told as it would be had it happened by hand: to the blocker, and to the member blocked
 * only about the blocker's own requests to them, which read as withdrawn. Never about their requests to the blocker, which
 * now go unseen and look to them exactly as before.
 */
export async function publishBlockOnMentorships(ctx: AppContext, tx: Tx, tenantSlug: string, blockerMembershipId: string, changed: { withdrawn: MentorshipRow[]; suppressed: MentorshipRow[] }): Promise<void> {
  if (changed.withdrawn.length === 0 && changed.suppressed.length === 0) return;
  await publishMentorshipChanged(ctx, tx, tenantSlug, [blockerMembershipId, ...changed.withdrawn.map((m) => m.mentorMembershipId)]);
}
