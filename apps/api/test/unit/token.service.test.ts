import { describe, expect, it } from "vitest";
import { pushTokens } from "../../src/db/schema";
import { keys } from "../../src/redis/keys";
import { isSessionAlive, issueSession, revokeAllSessions, revokeSession } from "../../src/services/token.service";
import { createUnitContext } from "../helpers/unitContext";

const user = { id: "11111111-1111-4111-8111-111111111111", isPlatformAdmin: false };

describe("token.service", () => {
  it("issues a session with a verifiable access token and a stored refresh token", async () => {
    const ctx = createUnitContext();
    const session = await issueSession(ctx, user, { ip: "1.1.1.1", userAgent: "vitest" });
    const claims = await ctx.jwt.verify(session.accessToken);
    expect(claims).toEqual({ sub: user.id, sid: session.sid, pa: false, exp: expect.any(Number) });
    expect(claims.exp * 1000).toBeGreaterThan(Date.now());
    expect(await isSessionAlive(ctx, session.sid)).toBe(true);
    expect(await ctx.redis.smembers(keys.userSessions(user.id))).toEqual([session.sid]);
    expect(await ctx.redis.ttl(keys.session(session.sid))).toBeGreaterThan(0);
  });

  it("revokes a single session", async () => {
    const ctx = createUnitContext();
    const a = await issueSession(ctx, user);
    const b = await issueSession(ctx, user);
    await revokeSession(ctx, a.sid, user.id, a.refreshToken);
    expect(await isSessionAlive(ctx, a.sid)).toBe(false);
    expect(await isSessionAlive(ctx, b.sid)).toBe(true);
    expect(await ctx.redis.smembers(keys.userSessions(user.id))).toEqual([b.sid]);
  });

  it("revokes all sessions for a user", async () => {
    const ctx = createUnitContext();
    // It also forgets the user's push tokens. push.test.ts checks the rows against a real database; here a recorder is enough.
    const deletedFrom: unknown[] = [];
    ctx.db = { delete: (table: unknown) => ({ where: async () => void deletedFrom.push(table) }) } as unknown as typeof ctx.db;
    const a = await issueSession(ctx, user);
    const b = await issueSession(ctx, user);
    await revokeAllSessions(ctx, user.id);
    expect(await isSessionAlive(ctx, a.sid)).toBe(false);
    expect(await isSessionAlive(ctx, b.sid)).toBe(false);
    expect(await ctx.redis.exists(keys.userSessions(user.id))).toBe(0);
    expect(deletedFrom).toEqual([pushTokens]);
  });

  it("rejects tampered and expired access tokens", async () => {
    const ctx = createUnitContext({ ACCESS_TOKEN_TTL_SEC: "1" });
    const session = await issueSession(ctx, user);
    await expect(ctx.jwt.verify(session.accessToken + "x")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await new Promise((r) => setTimeout(r, 1500));
    await expect(ctx.jwt.verify(session.accessToken)).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });
});
