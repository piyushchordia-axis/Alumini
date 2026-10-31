import { z } from "zod";
import { EVENT_KINDS, RSVP_STATUSES } from "../constants";
import { booleanQuerySchema, cursorQuerySchema, httpUrlSchema, isoDateTimeSchema, optionalTrimmed, trimmedString } from "./common";

/**
 * Validates an IANA time zone id. `Intl.supportedValuesOf` is not used because V8
 * reports canonical ids only (e.g. "Asia/Calcutta" instead of "Asia/Kolkata");
 * constructing a DateTimeFormat accepts every valid id including links.
 */
export function isValidTimeZone(tz: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().trim().min(1).max(64).refine(isValidTimeZone, "Unknown time zone");

const eventFields = {
  title: trimmedString(150, 3),
  description: trimmedString(5000, 1),
  kind: z.enum(EVENT_KINDS),
  city: trimmedString(80, 1),
  venueName: optionalTrimmed(120),
  address: optionalTrimmed(300),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema.nullable().optional(),
  timezone: timezoneSchema,
  maxAttendees: z.number().int().min(1).max(100000).nullable().optional(),
  coverImageUrl: httpUrlSchema.nullable().optional(),
};

/** One hour of grace so an event that is just starting can still be created or moved. */
export const EVENT_START_GRACE_MS = 60 * 60 * 1000;

const endAfterStart = (v: { startAt?: string; endAt?: string | null }) =>
  !v.startAt || !v.endAt || new Date(v.endAt).getTime() > new Date(v.startAt).getTime();

export const eventCreateSchema = z
  .object(eventFields)
  .refine(endAfterStart, { message: "End time must be after the start time", path: ["endAt"] })
  .refine((v) => new Date(v.startAt).getTime() > Date.now() - EVENT_START_GRACE_MS, { message: "Start time must be in the future", path: ["startAt"] });
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

export const eventUpdateSchema = z
  .object(eventFields)
  .partial()
  .refine(endAfterStart, { message: "End time must be after the start time", path: ["endAt"] });
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;

/**
 * Full-form schema for editing an existing event: the start may stay in the past
 * (the event already happened) but cannot be moved to a different past time.
 */
export function eventEditSchema(originalStartAt: string) {
  const original = new Date(originalStartAt).getTime();
  return z
    .object(eventFields)
    .refine(endAfterStart, { message: "End time must be after the start time", path: ["endAt"] })
    .refine((v) => new Date(v.startAt).getTime() === original || new Date(v.startAt).getTime() > Date.now() - EVENT_START_GRACE_MS, {
      message: "Start time must be in the future",
      path: ["startAt"],
    });
}

export const eventListQuerySchema = cursorQuerySchema.extend({
  scope: z.enum(["upcoming", "past"]).default("upcoming"),
  kind: z.enum(EVENT_KINDS).optional(),
  city: z.string().trim().max(80).optional(),
  mine: booleanQuerySchema.optional(),
});
export type EventListQuery = z.infer<typeof eventListQuerySchema>;

export const rsvpSchema = z.object({ status: z.enum(RSVP_STATUSES) });
export type RsvpInput = z.infer<typeof rsvpSchema>;

export const attendeesQuerySchema = cursorQuerySchema.extend({
  status: z.enum(["YES", "MAYBE"]).default("YES"),
});
export type AttendeesQuery = z.infer<typeof attendeesQuerySchema>;

export const eventCancelSchema = z.object({ reason: optionalTrimmed(300) });
export type EventCancelInput = z.infer<typeof eventCancelSchema>;
