import { and, eq, gt, lt, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { AppError } from "./errors";

export interface Cursor {
  /** Primary sort value: ISO timestamp or number, serialised as string. */
  v: string;
  /** Tie-breaker: row id. */
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decodes a client-supplied cursor. Anything malformed is a 400, never a database error. */
export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.v !== "string" || typeof parsed.id !== "string" || parsed.v.length > 500 || !UUID.test(parsed.id)) throw new Error("bad cursor");
    return { v: parsed.v, id: parsed.id };
  } catch {
    throw AppError.badRequest("Invalid pagination cursor");
  }
}

/** Default cursor value parser: an ISO timestamp. */
export function parseCursorDate(v: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest("Invalid pagination cursor");
  return d;
}

/**
 * Keyset condition for `(sortCol, idCol)` ordering.
 * direction "desc": rows strictly after the cursor in descending order.
 * Timestamp columns are stored with millisecond precision (migration 0004), so the ISO value in the cursor matches the
 * stored value exactly.
 */
export function keysetCondition(
  sortCol: AnyPgColumn,
  idCol: AnyPgColumn,
  cursor: Cursor | undefined,
  direction: "asc" | "desc",
  parse: (v: string) => unknown = parseCursorDate,
): SQL | undefined {
  if (!cursor) return undefined;
  const value = parse(cursor.v);
  const cmp = direction === "desc" ? lt : gt;
  return or(cmp(sortCol, value), and(eq(sortCol, value), cmp(idCol, cursor.id)));
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

/** Trims an over-fetched (limit + 1) result set and builds the next cursor. */
export function buildCursorPage<Row, Out>(
  rows: Row[],
  limit: number,
  toCursor: (row: Row) => Cursor,
  map: (row: Row) => Out,
): CursorPage<Out> {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  return {
    data: slice.map(map),
    nextCursor: hasMore && last ? encodeCursor(toCursor(last)) : null,
  };
}

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function buildPage<T>(data: T[], page: number, pageSize: number, total: number): Page<T> {
  return { data, page, pageSize, total };
}

export function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}
