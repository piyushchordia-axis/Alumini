import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantScoped } from "./helpers";
import { memberships } from "./memberships";

/**
 * What a deleted account leaves for others, keyed by `phoneHash` (lib/phoneHash.ts) and nothing else about the person:
 * a suspension, and blocks members placed on them. Both come back if the number joins that institution again
 * (deletedAccounts.service). They don't expire; a hold goes when it's taken back, or with the institution or the
 * blocker's membership. A clean account leaves no row.
 */
export const deletedAccountSuspensions = pgTable(
  "deleted_account_suspensions",
  {
    phoneHash: text("phone_hash").notNull(),
    ...tenantScoped(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true, precision: 3 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.phoneHash, t.tenantId] })],
);

export const deletedAccountBlocks = pgTable(
  "deleted_account_blocks",
  {
    phoneHash: text("phone_hash").notNull(),
    ...tenantScoped(),
    blockerMembershipId: uuid("blocker_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    blockedAt: timestamp("blocked_at", { withTimezone: true, precision: 3 }).notNull(),
  },
  // The blocker's index serves the cascade, which every account deletion runs for its memberships.
  (t) => [primaryKey({ columns: [t.phoneHash, t.blockerMembershipId] }), index("deleted_account_blocks_blocker_idx").on(t.blockerMembershipId)],
);
