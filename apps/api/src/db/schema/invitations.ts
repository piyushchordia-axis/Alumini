import type { ProfileFieldValue } from "@illuminize/shared";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { invitationStatusEnum } from "./enums";
import { tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";
import { users } from "./users";

/**
 * An invitation to join an institution, one per phone number. The token in the link only identifies the invitation
 * (to show "you're invited"); accepting needs the matching phone, proven by OTP. Imported answers prefill the
 * profile.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    fullName: text("full_name"),
    batchYear: integer("batch_year"),
    /** Profile field answers by key, applied when the invitation is accepted. */
    fieldValues: jsonb("field_values").$type<Record<string, ProfileFieldValue>>().notNull().default({}),
    token: text("token").notNull().unique(),
    status: invitationStatusEnum("status").notNull().default("PENDING"),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
    sendCount: integer("send_count").notNull().default(0),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true, precision: 3 }),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    acceptedMembershipId: uuid("accepted_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, precision: 3 }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("invitations_tenant_phone_uq").on(t.tenantId, t.phoneE164), index("invitations_tenant_status_created_idx").on(t.tenantId, t.status, t.createdAt)],
);
