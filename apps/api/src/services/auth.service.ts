import type { AuthSessionDto, MeDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toMembershipSummaryDto, toUserDto } from "../dto/user.dto";
import { AppError } from "../lib/errors";
import { normalizePhone } from "../lib/phone";
import { afterCommit, runInTransaction } from "../lib/transaction";
import { resolveOpenReportsOnListingsOfUser } from "../repositories/businesses.repo";
import { listMembershipsForUser } from "../repositories/memberships.repo";
import { deleteUser, findUserById, upsertUserOnLogin } from "../repositories/users.repo";
import { recordAudit } from "./audit.service";
import { prepareChatForAccountDeletion } from "./chat/lifecycle";
import { prepareMentorshipsForAccountDeletion } from "./mentorship/mentorship.service";
import { prepareReferralsForAccountDeletion } from "./referrals/referrals.service";
import { issueSession, revokeAllSessions, type SessionMeta } from "./token.service";

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
  await recordAudit(ctx, { actorUserId: userId, action: "auth.account_deleted", ip, metadata: { phone: user.phoneE164 } });
  await runInTransaction(ctx, async (tx) => {
    await resolveOpenReportsOnListingsOfUser(tx, userId, "auto: author deleted");
    const finishMentorships = await prepareMentorshipsForAccountDeletion(ctx, tx, userId);
    const finishReferrals = await prepareReferralsForAccountDeletion(ctx, tx, userId);
    await prepareChatForAccountDeletion(ctx, tx, userId);
    await deleteUser(tx, userId);
    await finishMentorships();
    await finishReferrals();
    // Once it's done: a deletion that gives up on a row lock tells them to try again, and they have to still be signed in to.
    await afterCommit(ctx, tx, () => revokeAllSessions(ctx, userId));
  });
}
