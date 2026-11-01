import { sql } from "drizzle-orm";
import { date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantScoped } from "./helpers";
import { memberships } from "./memberships";
import { tenants } from "./tenants";

/** "Send wishes" from one member to another, once per day and kind (birthday / anniversary). */
export const celebrationWishes = pgTable(
  "celebration_wishes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    senderMembershipId: uuid("sender_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    recipientMembershipId: uuid("recipient_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The institution's local date the wish was for. */
    day: date("day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("celebration_wishes_once_uq").on(t.senderMembershipId, t.recipientMembershipId, t.day, t.kind),
    index("celebration_wishes_recipient_day_idx").on(t.recipientMembershipId, t.day),
  ],
);

/**
 * Per-institution scheduled work that must happen once per period (celebrations each day, the digest each week).
 * A run is claimed before the work and marked DONE after it, so retries and repeated ticks never lose or repeat a
 * period.
 */
export const tenantJobRuns = pgTable(
  "tenant_job_runs",
  {
    job: text("job").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    status: text("status").notNull().default("RUNNING"),
    attempts: integer("attempts").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, precision: 3 }),
  },
  (t) => [primaryKey({ columns: [t.job, t.tenantId, t.periodKey] }), index("tenant_job_runs_done_idx").on(t.job, t.periodKey).where(sql`${t.status} = 'DONE'`)],
);
