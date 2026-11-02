import { randomUUID } from "node:crypto";
import express from "express";
import Redis from "ioredis";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context";
import { AppError } from "../../src/lib/errors";
import { byIp, consumeRateLimit, rateLimit } from "../../src/middleware/rateLimit";
import { errorHandler } from "../../src/middleware/errorHandler";
import { createLogger } from "../../src/lib/logger";
import type { RedisClient } from "../../src/redis/client";
import { keys } from "../../src/redis/keys";
import { isRealRedisAvailable, realRedisUrl } from "../helpers/realRedis";
import { newRedisMock } from "../helpers/testContext";

const realRedis = await isRealRedisAvailable();

const contextWith = (redis: RedisClient) => ({ config: { isTest: true }, redis }) as unknown as AppContext;

/** The same rules have to hold on the mock most tests use and on the real thing. */
const backends: Array<{ name: string; skip: boolean; redis: () => RedisClient; cleanup: () => Promise<void> }> = [];
const mock = newRedisMock();
backends.push({ name: "the mock", skip: false, redis: () => mock, cleanup: async () => undefined });
const real = realRedis ? (new Redis(realRedisUrl()) as unknown as RedisClient) : null;
backends.push({ name: "real Redis", skip: !realRedis, redis: () => real!, cleanup: async () => void (await real!.quit()) });

describe.each(backends)("consumeRateLimit on $name", ({ skip, redis }) => {
  const window = (windowSec = 60, limit = 100) => ({ bucket: `test-${randomUUID()}`, limit, windowSec });
  const ttlOf = (w: { bucket: string }, key: string) => redis().ttl(keys.rateLimit(w.bucket, key));

  beforeEach(() => {
    process.env.RATE_LIMIT_IN_TESTS = "1";
  });
  afterEach(() => {
    delete process.env.RATE_LIMIT_IN_TESTS;
  });

  it.skipIf(skip)("gives a counter that jumps past 1 a TTL, so it can't lock a member out forever", async () => {
    const w = window(60);
    await consumeRateLimit(contextWith(redis()), w, "m1", 25);
    const ttl = await ttlOf(w, "m1");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    expect(await redis().get(keys.rateLimit(w.bucket, "m1"))).toBe("25");
  });

  it.skipIf(skip)("gives a counter of 1 a TTL too", async () => {
    const w = window(60);
    await consumeRateLimit(contextWith(redis()), w, "m1");
    expect(await ttlOf(w, "m1")).toBeGreaterThan(0);
  });

  it.skipIf(skip)("doesn't extend the window as it counts", async () => {
    const w = window(60);
    await consumeRateLimit(contextWith(redis()), w, "m1", 25);
    await redis().expire(keys.rateLimit(w.bucket, "m1"), 30);
    await consumeRateLimit(contextWith(redis()), w, "m1", 25);
    expect(await ttlOf(w, "m1")).toBeLessThanOrEqual(30);
    expect(await redis().get(keys.rateLimit(w.bucket, "m1"))).toBe("50");
  });

  it.skipIf(skip)("counts up to the limit, then refuses with how long to wait", async () => {
    const w = window(60, 3);
    const ctx = contextWith(redis());
    expect(await consumeRateLimit(ctx, w, "m1")).toEqual({ remaining: 2 });
    expect(await consumeRateLimit(ctx, w, "m1")).toEqual({ remaining: 1 });
    expect(await consumeRateLimit(ctx, w, "m1")).toEqual({ remaining: 0 });
    const refused = await consumeRateLimit(ctx, w, "m1").catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    const { retryAfterSec } = (refused as AppError).details as { retryAfterSec: number };
    expect(retryAfterSec).toBeGreaterThan(0);
    expect(retryAfterSec).toBeLessThanOrEqual(60);
  });

  it.skipIf(skip)("refuses a single large amount that goes over, and it still expires", async () => {
    const w = window(60, 20);
    await expect(consumeRateLimit(contextWith(redis()), w, "m1", 25)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await ttlOf(w, "m1")).toBeGreaterThan(0);
  });

  it.skipIf(skip)("keeps members and buckets apart", async () => {
    const w = window(60, 1);
    const ctx = contextWith(redis());
    await consumeRateLimit(ctx, w, "m1");
    await expect(consumeRateLimit(ctx, w, "m1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await consumeRateLimit(ctx, w, "m2")).toEqual({ remaining: 0 });
    expect(await consumeRateLimit(ctx, { ...w, bucket: `${w.bucket}-other` }, "m1")).toEqual({ remaining: 0 });
  });

  it.skipIf(skip)("does nothing in tests unless they ask, which moved in here from the middleware", async () => {
    delete process.env.RATE_LIMIT_IN_TESTS;
    const w = window(60, 1);
    const ctx = contextWith(redis());
    expect(await consumeRateLimit(ctx, w, "m1")).toBeNull();
    expect(await consumeRateLimit(ctx, w, "m1")).toBeNull();
    expect(await redis().get(keys.rateLimit(w.bucket, "m1"))).toBeNull();
  });

  it.skipIf(skip)("counts afresh once the window has passed", async () => {
    const w = window(1, 2);
    const ctx = contextWith(redis());
    await consumeRateLimit(ctx, w, "m1", 2);
    await expect(consumeRateLimit(ctx, w, "m1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await new Promise((r) => setTimeout(r, 1100));
    expect(await consumeRateLimit(ctx, w, "m1")).toEqual({ remaining: 1 });
  });

  it.skipIf(skip)("backs the middleware, which still reports its headers", async () => {
    const w = window(60, 2);
    const app = express();
    app.set("trust proxy", true);
    app.get("/x", rateLimit(contextWith(redis()), { ...w, keyFn: byIp }), (_req, res) => void res.json({ ok: true }));
    app.use(errorHandler(createLogger("silent", false)));
    const first = await request(app).get("/x");
    expect(first.status).toBe(200);
    expect(first.headers["x-ratelimit-limit"]).toBe("2");
    expect(first.headers["x-ratelimit-remaining"]).toBe("1");
    await request(app).get("/x");
    const refused = await request(app).get("/x");
    expect(refused.status).toBe(429);
    expect(refused.headers["x-ratelimit-limit"]).toBe("2");
    expect(refused.headers["x-ratelimit-remaining"]).toBe("0");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect(refused.body.error.code).toBe("RATE_LIMITED");
  });

  it.skipIf(skip)("in the middleware, sets no headers when tests have it switched off", async () => {
    delete process.env.RATE_LIMIT_IN_TESTS;
    const app = express();
    app.get("/x", rateLimit(contextWith(redis()), { ...window(60, 1), keyFn: () => "k" }), (_req, res) => void res.json({ ok: true }));
    const res = await request(app).get("/x");
    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it.skipIf(skip)("in the middleware, skips a request with no key", async () => {
    const app = express();
    app.get("/x", rateLimit(contextWith(redis()), { ...window(60, 0), keyFn: () => undefined }), (_req, res) => void res.json({ ok: true }));
    expect((await request(app).get("/x")).status).toBe(200);
  });
});

afterAll(async () => {
  for (const b of backends) if (!b.skip) await b.cleanup();
});
