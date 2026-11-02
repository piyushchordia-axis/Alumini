import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { chatMessages } from "../../src/db/schema";
import { AppError } from "../../src/lib/errors";
import { keysetCondition, parseCursorDate, parseCursorSeq } from "../../src/lib/pagination";

describe("parseCursorSeq", () => {
  it("accepts 0 to 2147483647", () => {
    for (const [raw, n] of [["0", 0], ["1", 1], ["10", 10], ["007", 7], ["2147483647", 2147483647]] as const) expect(parseCursorSeq(raw)).toBe(n);
  });

  it("answers anything else with a 400, never a database error", () => {
    for (const raw of ["2147483648", "9999999999", "99999999999", "-1", "+1", "1.5", "1e3", "0x10", "", " ", " 1", "1 ", "abc", "NaN", "Infinity", "2026-01-01T00:00:00.000Z", "١٠"]) {
      let caught: unknown;
      try {
        parseCursorSeq(raw);
      } catch (err) {
        caught = err;
      }
      expect(caught, JSON.stringify(raw)).toBeInstanceOf(AppError);
      expect((caught as AppError).status).toBe(400);
    }
  });

  it("is needed, because the default parser takes a number happily", () => {
    expect(() => parseCursorDate("10")).not.toThrow();
  });
});

describe("keysetCondition", () => {
  const dialect = new PgDialect();
  const render = (s: ReturnType<typeof keysetCondition>) => dialect.sqlToQuery(s!);
  const ID = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";

  it("is nothing without a cursor", () => {
    expect(keysetCondition(chatMessages.seq, chatMessages.id, undefined, "desc", parseCursorSeq)).toBeUndefined();
  });

  it("orders on a column, with the parser's value", () => {
    const { sql: text, params } = render(keysetCondition(chatMessages.seq, chatMessages.id, { v: "10", id: ID }, "desc", parseCursorSeq));
    expect(text).toContain('"chat_messages"."seq" <');
    expect(text).toContain('"chat_messages"."id" <');
    expect(params).toEqual([10, 10, ID]);
  });

  it("orders on an expression too", () => {
    const at = new Date("2026-05-05T10:00:00.123Z");
    const { sql: text, params } = render(keysetCondition(sql`coalesce(${chatMessages.removedAt}, ${chatMessages.createdAt})`, chatMessages.id, { v: at.toISOString(), id: ID }, "desc"));
    expect(text).toContain("coalesce(");
    expect(text).toContain('"chat_messages"."id" <');
    expect(params.filter((p) => p instanceof Date)).toEqual([at, at]);
  });

  it("goes the other way ascending", () => {
    const { sql: text } = render(keysetCondition(chatMessages.seq, chatMessages.id, { v: "1", id: ID }, "asc", parseCursorSeq));
    expect(text).toContain('"chat_messages"."seq" >');
  });

  it("refuses a bad value before anything reaches the database", () => {
    expect(() => keysetCondition(chatMessages.seq, chatMessages.id, { v: "2147483648", id: ID }, "desc", parseCursorSeq)).toThrow(AppError);
  });
});
