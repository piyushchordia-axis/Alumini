import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { posts } from "../../src/db/schema";
import { encodeCursor } from "../../src/lib/pagination";
import { auth, createTenant, createUser, loginAs, memberSession, PROFILE } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("request robustness", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("answers malformed cursors with 400, not a database error", async () => {
    const { tenant } = await createTenant(ctx);
    const m = await memberSession(ctx, tenant.id);
    const base = `/api/v1/t/${tenant.slug}/posts`;
    const bad = [
      "not-base64-json",
      encodeCursor({ v: "2026-01-01T00:00:00.000Z", id: "not-a-uuid" }),
      encodeCursor({ v: "yesterday-ish", id: "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81" }),
    ];
    for (const cursor of bad) {
      const res = await request(ctx.app).get(base).query({ cursor }).set(m.headers);
      expect(res.status, cursor).toBe(400);
    }
  });

  it("rejects impossible calendar dates", async () => {
    const { tenant } = await createTenant(ctx);
    const m = await memberSession(ctx, tenant.id);
    const res = await request(ctx.app).patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(m.headers).send({ dateOfBirth: "1990-02-30" });
    expect(res.status).toBe(400);
  });

  it("turns a double-submitted registration into one membership and a 409", async () => {
    const { tenant } = await createTenant(ctx);
    const user = await createUser(ctx);
    const session = await loginAs(ctx, user.phoneE164);
    const send = () => request(ctx.app).post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    const statuses = (await Promise.all([send(), send(), send()])).map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201 || s === 200)).toHaveLength(1);
    expect(statuses.every((s) => s === 200 || s === 201 || s === 409)).toBe(true);
  });

  it("pages through rows created in the same millisecond without skipping or repeating", async () => {
    const { tenant } = await createTenant(ctx);
    const m = await memberSession(ctx, tenant.id);
    const at = new Date("2026-05-05T10:00:00.123Z");
    await ctx.db.insert(posts).values(
      Array.from({ length: 5 }, (_, i) => ({ tenantId: tenant.id, authorMembershipId: m.membership.id, body: `same-ms ${i}`, moderationStatus: "APPROVED" as const, createdAt: at })),
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/posts`).query({ limit: 2, ...(cursor ? { cursor } : {}) }).set(m.headers);
      expect(res.status).toBe(200);
      seen.push(...(res.body.data as Array<{ id: string }>).map((p) => p.id));
      cursor = res.body.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});
