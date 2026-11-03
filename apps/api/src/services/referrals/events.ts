import type { AppContext } from "../../context";
import type { Tx } from "../../db/client";
import type { ReferralRow } from "../../repositories/referrals.repo";
import { publishConnectionChanged } from "../mentorship/events";

/** `referral:changed` to these members' own devices once `tx` commits. Callers leave out a poster who must never learn of a request. */
export const publishReferralChanged = (ctx: AppContext, tx: Tx, tenantSlug: string, membershipIds: Array<string | null>) => publishConnectionChanged(ctx, tx, "referral:changed", tenantSlug, membershipIds);

/**
 * What a block changed in referrals, told as it would be had it happened by hand: to the blocker, and to the member blocked
 * only about the blocker's own requests to them, which read as withdrawn. Never about their requests to the blocker, which
 * now go unseen and look to them exactly as before. Nor about a request of the blocker's they never saw, because they had
 * blocked the blocker first: withdrawing that one by hand wouldn't tell them either.
 */
export async function publishBlockOnReferrals(ctx: AppContext, tx: Tx, tenantSlug: string, blockerMembershipId: string, changed: { withdrawn: ReferralRow[]; suppressed: ReferralRow[] }): Promise<void> {
  if (changed.withdrawn.length === 0 && changed.suppressed.length === 0) return;
  await publishReferralChanged(ctx, tx, tenantSlug, [blockerMembershipId, ...changed.withdrawn.filter((r) => !r.suppressed).map((r) => r.posterMembershipId)]);
}
