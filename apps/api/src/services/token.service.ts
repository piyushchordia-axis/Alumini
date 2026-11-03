import { randomUUID } from "node:crypto";
import type { TokenPairDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { opaqueToken, sha256 } from "../lib/random";
import { rooms } from "../realtime/rooms";
import { keys } from "../redis/keys";
import { deletePushTokensForUser, findUserById } from "../repositories/users.repo";

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

interface RefreshRecord {
  userId: string;
  sid: string;
}

export async function issueSession(
  ctx: AppContext,
  user: { id: string; isPlatformAdmin: boolean },
  meta: SessionMeta = {},
): Promise<TokenPairDto & { sid: string }> {
  const sid = randomUUID();
  const refreshToken = opaqueToken();
  const refreshHash = sha256(refreshToken);
  const ttl = ctx.config.REFRESH_TOKEN_TTL_SEC;
  const now = String(Date.now());

  await ctx.redis
    .multi()
    .hset(
      keys.session(sid),
      "userId",
      user.id,
      "createdAt",
      now,
      "lastSeenAt",
      now,
      "userAgent",
      meta.userAgent ?? "",
      "ip",
      meta.ip ?? "",
      "refreshHash",
      refreshHash,
    )
    .expire(keys.session(sid), ttl)
    .set(keys.refresh(refreshHash), JSON.stringify({ userId: user.id, sid } satisfies RefreshRecord), "EX", ttl)
    .sadd(keys.userSessions(user.id), sid)
    .exec();

  const accessToken = await ctx.jwt.sign({ sub: user.id, sid, pa: user.isPlatformAdmin });
  return { accessToken, refreshToken, sid };
}

export async function rotateRefresh(ctx: AppContext, refreshToken: string): Promise<TokenPairDto> {
  const oldHash = sha256(refreshToken);
  const raw = await ctx.redis.get(keys.refresh(oldHash));
  if (!raw) throw new AppError(401, "SESSION_REVOKED", "Your session has expired. Please sign in again.");
  const record = JSON.parse(raw) as RefreshRecord;

  const alive = await ctx.redis.exists(keys.session(record.sid));
  if (!alive) {
    await ctx.redis.del(keys.refresh(oldHash));
    throw new AppError(401, "SESSION_REVOKED", "Your session has expired. Please sign in again.");
  }

  const user = await findUserById(ctx.db, record.userId);
  if (!user) {
    await revokeSessionById(ctx, record.sid, record.userId, oldHash);
    throw new AppError(401, "SESSION_REVOKED", "Account no longer exists");
  }

  const newToken = opaqueToken();
  const newHash = sha256(newToken);
  const ttl = ctx.config.REFRESH_TOKEN_TTL_SEC;
  await ctx.redis
    .multi()
    .del(keys.refresh(oldHash))
    .set(keys.refresh(newHash), JSON.stringify({ userId: user.id, sid: record.sid } satisfies RefreshRecord), "EX", ttl)
    .hset(keys.session(record.sid), "refreshHash", newHash, "lastSeenAt", String(Date.now()))
    .expire(keys.session(record.sid), ttl)
    .exec();

  const accessToken = await ctx.jwt.sign({ sub: user.id, sid: record.sid, pa: user.isPlatformAdmin });
  return { accessToken, refreshToken: newToken };
}

async function revokeSessionById(ctx: AppContext, sid: string, userId: string, refreshHash?: string | null): Promise<void> {
  const hash = refreshHash ?? (await ctx.redis.hget(keys.session(sid), "refreshHash"));
  const multi = ctx.redis.multi().del(keys.session(sid)).srem(keys.userSessions(userId), sid);
  if (hash) multi.del(keys.refresh(hash));
  await multi.exec();
}

/** Revokes the session identified by `sid` (from the access token) and, if given, the refresh token. */
export async function revokeSession(ctx: AppContext, sid: string, userId: string, refreshToken?: string): Promise<void> {
  await revokeSessionById(ctx, sid, userId, refreshToken ? sha256(refreshToken) : undefined);
  if (refreshToken) await ctx.redis.del(keys.refresh(sha256(refreshToken)));
  // Live connections opened with this session close straight away.
  ctx.realtime.disconnect(rooms.session(sid));
}

/**
 * Signs the user out everywhere, and forgets their devices' push tokens: a phone signed out this way, perhaps lost, must not
 * go on showing their notifications (chat ones name people) on its lock screen. Each device registers again at sign-in.
 */
export async function revokeAllSessions(ctx: AppContext, userId: string): Promise<void> {
  await deletePushTokensForUser(ctx.db, userId);
  const sids = await ctx.redis.smembers(keys.userSessions(userId));
  for (const sid of sids) await revokeSessionById(ctx, sid, userId);
  await ctx.redis.del(keys.userSessions(userId));
  ctx.realtime.disconnect(rooms.user(userId));
}

export async function isSessionAlive(ctx: AppContext, sid: string): Promise<boolean> {
  return (await ctx.redis.exists(keys.session(sid))) === 1;
}
