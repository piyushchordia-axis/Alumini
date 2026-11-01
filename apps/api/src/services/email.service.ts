import { EMAIL_VERIFICATION_TTL_SECONDS, type EmailStatusDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { opaqueToken, sha256 } from "../lib/random";
import { runInTransaction } from "../lib/transaction";
import { keys } from "../redis/keys";
import {
  closeEmailVerifications,
  consumeEmailVerification,
  findPendingEmailVerification,
  insertEmailVerification,
} from "../repositories/emailVerifications.repo";
import { findUserById, updateUser } from "../repositories/users.repo";
import { recordAudit } from "./audit.service";
import { queueMessage } from "./messages/message.service";

/** Confirmation emails one address may receive per day. */
export const EMAIL_VERIFY_MAX_PER_ADDRESS_DAY = 3;

const limitsEnabled = (ctx: AppContext) => !ctx.config.isTest || process.env.RATE_LIMIT_IN_TESTS === "1";

async function incrWithWindow(ctx: AppContext, key: string, windowSec: number): Promise<number> {
  const n = await ctx.redis.incr(key);
  if (n === 1) await ctx.redis.expire(key, windowSec);
  return n;
}

export async function getEmailStatus(ctx: AppContext, userId: string): Promise<EmailStatusDto> {
  const [user, pending] = await Promise.all([findUserById(ctx.db, userId), findPendingEmailVerification(ctx.db, userId)]);
  if (!user) throw AppError.unauthenticated("Account no longer exists");
  return {
    email: user.email,
    verifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    pending: pending ? { email: pending.email, expiresAt: pending.expiresAt.toISOString() } : null,
  };
}

/**
 * Sends a confirmation link to `email`. The current confirmed address (if any) stays until the link is opened; an
 * older pending request is replaced. Asking for the address that is already confirmed sends nothing.
 */
export async function requestEmailChange(ctx: AppContext, userId: string, email: string, ip?: string): Promise<EmailStatusDto> {
  if (!ctx.messageSenders.EMAIL || !ctx.config.webAppUrl) {
    throw new AppError(503, "EMAIL_NOT_CONFIGURED", "Email isn't set up on this server yet.");
  }
  const user = await findUserById(ctx.db, userId);
  if (!user) throw AppError.unauthenticated("Account no longer exists");
  if (user.email === email) {
    await closeEmailVerifications(ctx.db, userId);
    return getEmailStatus(ctx, userId);
  }

  if (limitsEnabled(ctx)) {
    const perAddress = await incrWithWindow(ctx, keys.emailVerifyAddressDay(sha256(`email:${email}`)), 86_400);
    if (perAddress > EMAIL_VERIFY_MAX_PER_ADDRESS_DAY) throw AppError.rateLimited(3600, "Too many confirmation emails for this address today. Please try again tomorrow.");
    const global = await incrWithWindow(ctx, keys.emailVerifyGlobalDay(new Date().toISOString().slice(0, 10)), 86_400);
    if (global > ctx.config.EMAIL_VERIFY_GLOBAL_DAILY_CAP) {
      ctx.logger.error({ cap: ctx.config.EMAIL_VERIFY_GLOBAL_DAILY_CAP }, "Daily email confirmation cap reached");
      throw AppError.rateLimited(3600, "Email confirmation is busy right now. Please try again later.");
    }
  }

  const token = opaqueToken(32);
  const link = `${ctx.config.webAppUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await runInTransaction(ctx, async (tx) => {
    await closeEmailVerifications(tx, userId);
    const v = await insertEmailVerification(tx, {
      userId,
      email,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000),
    });
    await queueMessage(ctx, { type: "EMAIL_VERIFY", to: { email, userId }, payload: { verificationId: v.id, link }, context: { type: "email_verification", id: v.id } }, tx);
    await recordAudit(ctx, { actorUserId: userId, action: "user.email.requested", targetType: "user", targetId: userId, metadata: { verificationId: v.id }, ip }, tx);
  });
  return getEmailStatus(ctx, userId);
}

/** Opens a confirmation link: the address becomes the account's confirmed email. Links are single use. */
export async function confirmEmail(ctx: AppContext, token: string, ip?: string): Promise<{ email: string }> {
  return runInTransaction(ctx, async (tx) => {
    const v = await consumeEmailVerification(tx, sha256(token));
    if (!v) throw new AppError(400, "EMAIL_TOKEN_INVALID", "This link has expired or was already used. Request a new one from your profile.");
    await updateUser(tx, v.userId, { email: v.email, emailVerifiedAt: new Date() });
    await closeEmailVerifications(tx, v.userId);
    await recordAudit(ctx, { actorUserId: v.userId, action: "user.email.verified", targetType: "user", targetId: v.userId, metadata: { verificationId: v.id }, ip }, tx);
    return { email: v.email };
  });
}

/** Removes the confirmed address and cancels any pending confirmation. */
export async function removeEmail(ctx: AppContext, userId: string, ip?: string): Promise<EmailStatusDto> {
  await runInTransaction(ctx, async (tx) => {
    await updateUser(tx, userId, { email: null, emailVerifiedAt: null });
    await closeEmailVerifications(tx, userId);
    await recordAudit(ctx, { actorUserId: userId, action: "user.email.removed", targetType: "user", targetId: userId, ip }, tx);
  });
  return getEmailStatus(ctx, userId);
}
