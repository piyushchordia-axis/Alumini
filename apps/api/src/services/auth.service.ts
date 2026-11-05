import type { AuthSessionDto, MeDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toMembershipSummaryDto, toUserDto } from "../dto/user.dto";
import { AppError } from "../lib/errors";
import { normalizePhone } from "../lib/phone";
import { afterCommit, runInTransaction } from "../lib/transaction";
import { resolveOpenReportsOnListingsOfUser } from "../repositories/businesses.repo";
import { lockAccountForDeletion } from "../repositories/deletedAccounts.repo";
import { listMembershipsForUser } from "../repositories/memberships.repo";
import { deleteUser, findUserById, upsertUserOnLogin } from "../repositories/users.repo";
import { recordAudit, recordAuditStrict } from "./audit.service";
import { prepareChatForAccountDeletion } from "./chat/lifecycle";
import { keepHoldsOfDeletedAccount } from "./deletedAccounts.service";
import { prepareMentorshipsForAccountDeletion } from "./mentorship/mentorship.service";
import { prepareReferralsForAccountDeletion } from "./referrals/referrals.service";
import { issueSession, revokeAllSessions, type SessionMeta } from "./token.service";
import { avatarKeysOfUser, removeAvatarsIfUnused } from "./uploads.service";

export async function loginWithVerifiedPhone(ctx: AppContext, phoneE164: string, meta: SessionMeta): Promise<AuthSessionDto> {
  const { region } = normalizePhone(phoneE164);
  const forcePlatformAdmin = ctx.config.platformAdminPhones.includes(phoneE164);
  const user = await upsertUserOnLogin(ctx.db, { phoneE164, phoneRegion: region, forcePlatformAdmin });
  const session = await issueSession(ctx, user, meta);
  await recordAudit(ctx, { actorUserId: user.id, action: "auth.login", ip: meta.ip, metadata: { sid: session.sid } });
  const memberships = await listMembershipsForUser(ctx.db, user.id);
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: toUserDto(user),
    memberships: memberships.map((r) => toMembershipSummaryDto(r.membership, r.tenant)),
  };
}

export async function getMe(ctx: AppContext, userId: string): Promise<MeDto> {
  const user = await findUserById(ctx.db, userId);
  if (!user) throw AppError.unauthenticated("Account no longer exists");
  const memberships = await listMembershipsForUser(ctx.db, user.id);
  return {
    user: toUserDto(user),
    memberships: memberships.map((r) => toMembershipSummaryDto(r.membership, r.tenant)),
  };
}

export async function deleteAccount(ctx: AppContext, userId: string, ip?: string): Promise<void> {
  const user = await findUserById(ctx.db, userId);
  if (!user) return;
  await runInTransaction(ctx, async (tx) => {
    await resolveOpenReportsOnListingsOfUser(tx, userId, "auto: author deleted");
    const finishMentorships = await prepareMentorshipsForAccountDeletion(ctx, tx, userId);
    const finishReferrals = await prepareReferralsForAccountDeletion(ctx, tx, userId);
    await prepareChatForAccountDeletion(ctx, tx, userId);
    // From here on nothing about them is still being committed: a suspension or a block in flight, or a membership a
    // rejoin is inserting, is waited for, so the holds below see it rather than the cascade deleting it unseen.
    const memberships = await lockAccountForDeletion(tx, userId);
    // Collected first: the cascade takes the memberships that show the photos, and the uploads' link to the user.
    const avatarKeys = await avatarKeysOfUser(ctx, tx, userId);
    const held = await keepHoldsOfDeletedAccount(ctx, tx, user);
    await deleteUser(tx, userId);
    // In the transaction, so a deletion that fails leaves no row. No actor: the user it would name is gone. The phone is
    // kept only as the keyed hash, and nothing about blocks is written.
    await recordAuditStrict(tx, {
      action: "auth.account_deleted",
      targetType: "user",
      targetId: userId,
      metadata: { phoneHash: held.phoneHash, memberships, heldSuspensions: held.suspensions },
      ip,
    });
    await finishMentorships();
    await finishReferrals();
    // Once it's done: a deletion that gives up on a row lock tells them to try again, and they have to still be signed in to.
    await afterCommit(ctx, tx, () => revokeAllSessions(ctx, userId));
    await afterCommit(ctx, tx, () => removeAvatarsIfUnused(ctx, avatarKeys));
  });
}
