import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { eventKindEnum, rsvpStatusEnum } from "./enums";
import { moderationColumns, tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";
import { tenants } from "./tenants";

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    authorMembershipId: uuid("author_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    kind: eventKindEnum("kind").notNull(),
    city: text("city").notNull(),
    venueName: text("venue_name"),
    address: text("address"),
    startAt: timestamp("start_at", { withTimezone: true, precision: 3 }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, precision: 3 }),
    timezone: text("timezone").notNull(),
    maxAttendees: integer("max_attendees"),
    coverImageUrl: text("cover_image_url"),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    yesCount: integer("yes_count").notNull().default(0),
    maybeCount: integer("maybe_count").notNull().default(0),
    ...moderationColumns(),
    ...timestamps(),
  },
  (t) => [
    index("events_tenant_status_start_idx").on(t.tenantId, t.moderationStatus, t.startAt),
    index("events_tenant_author_idx").on(t.tenantId, t.authorMembershipId),
    check("events_end_after_start", sql`${t.endAt} IS NULL OR ${t.endAt} > ${t.startAt}`),
    check("events_max_attendees_positive", sql`${t.maxAttendees} IS NULL OR ${t.maxAttendees} > 0`),
  ],
);

export const eventRsvps = pgTable(
  "event_rsvps",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: rsvpStatusEnum("status").notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.membershipId] }), index("event_rsvps_event_status_idx").on(t.eventId, t.status)],
);
