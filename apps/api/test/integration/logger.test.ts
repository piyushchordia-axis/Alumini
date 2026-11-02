import { sql } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { errSerializer } from "../../src/lib/logger";
import { capturingLogger } from "../helpers/capturingLogger";
import { acceptedThread, chatApi } from "../helpers/chat";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

const SECRET = "the-private-message-body-7Q4X";

describe("the error serializer", () => {
  const failedQuery = () => {
    const cause = Object.assign(new Error('new row for relation "chat_messages" violates check constraint "boom"'), { code: "23514", constraint: "boom", detail: `Failing row contains (${SECRET}).`, where: `from ${SECRET}` });
    return new DrizzleQueryError('insert into "chat_messages" ("body") values ($1)', [SECRET, "other-param"], cause);
  };

  it("takes the parameters out of Drizzle's message, stack and params", () => {
    const out = errSerializer(failedQuery());
    const text = JSON.stringify(out);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("other-param");
    expect(out).not.toHaveProperty("params");
  });

  it("keeps what you need to debug: the SQL, the code, the constraint and where it happened", () => {
    const out = errSerializer(failedQuery()) as Record<string, string>;
    expect(out.type).toBe("DrizzleQueryError");
    expect(out.message).toContain('insert into "chat_messages"');
    expect(out.message).toContain("violates check constraint");
    expect(out.stack).toContain("logger.test.ts");
    expect(out.query).toContain('values ($1)');
  });

  it("drops a Postgres error's copy of the row even with no Drizzle error around it", () => {
    const pgError = Object.assign(new Error("null value in column"), { code: "23502", detail: `Failing row contains (${SECRET}).` });
    const out = errSerializer(pgError) as Record<string, string>;
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(out.code).toBe("23502");
    expect(out.message).toBe("null value in column");
  });

  it("leaves an ordinary error alone", () => {
    const err = Object.assign(new Error("Something else"), { status: 500 });
    const out = errSerializer(err) as Record<string, unknown>;
    expect(out).toMatchObject({ type: "Error", message: "Something else", status: 500 });
    expect(String(out.stack)).toContain("logger.test.ts");
  });

  it("passes through anything that isn't an error", () => {
    expect(errSerializer("a string")).toBe("a string");
    expect(errSerializer(null)).toBeNull();
    expect(errSerializer(undefined)).toBeUndefined();
    expect(errSerializer({ not: "an error" })).toEqual({ not: "an error" });
  });

  it("works on what pino-http passes, which is already serialized with the original kept as raw", () => {
    const wrapped = pino.stdSerializers.err(failedQuery());
    expect(JSON.stringify(wrapped)).toContain(SECRET);
    expect(JSON.stringify(errSerializer(wrapped))).not.toContain(SECRET);
  });

  it("copes with a chain of causes, and a circular one", () => {
    const inner = Object.assign(new Error("Inner"), { detail: SECRET });
    const outer = new DrizzleQueryError("select 1", [SECRET], new DrizzleQueryError("select 2", [SECRET], inner));
    expect(JSON.stringify(errSerializer(outer))).not.toContain(SECRET);
    const loop = new Error("Loop") as Error & { cause?: unknown };
    loop.cause = loop;
    expect(() => JSON.stringify(errSerializer(loop))).not.toThrow();
  });

  it("is what a logger uses", () => {
    const { logger, text } = capturingLogger();
    logger.error({ err: failedQuery() }, "Failed");
    expect(text()).toContain("violates check constraint");
    expect(text()).not.toContain(SECRET);
  });
});

describe.skipIf(!dbAvailable)("a failed insert", () => {
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

  it("logs the failure and not the message body, and the client gets a plain 500", async () => {
    const { tenant } = await createTenant(ctx);
    const a = await memberSession(ctx, tenant.id);
    const b = await memberSession(ctx, tenant.id);
    const id = await acceptedThread(ctx, tenant.slug, a, b);
    const { logger, text } = capturingLogger();
    const app = createApp({ ...ctx, logger });
    // A constraint this test adds makes Postgres refuse the insert, with the whole row in its error.
    await ctx.db.execute(sql.raw(`alter table chat_messages add constraint boom check (body <> '${SECRET}') not valid`));
    try {
      const res = await request(app).post(`/api/v1/t/${tenant.slug}/chat/conversations/${id}/messages`).set(a.headers).send({ body: SECRET, clientKey: "force-a-failure-1" });
      expect(res.status).toBe(500);
      expect(res.body.error).toEqual({ code: "INTERNAL", message: "Something went wrong" });
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    } finally {
      await ctx.db.execute(sql`alter table chat_messages drop constraint boom`);
    }
    const logged = text();
    expect(logged).toContain("Unhandled error");
    expect(logged).toContain("boom");
    expect(logged).not.toContain(SECRET);
    // Nothing was kept of the failed send.
    expect(await chatApi(ctx, tenant.slug, b).messages(id).then((r) => JSON.stringify(r.body))).not.toContain(SECRET);
  });
});
