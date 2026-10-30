import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contentTypeEnum, reportReasonEnum, reportStatusEnum } from "./enums";
import { tenantScoped } from "./helpers";
import { memberships } from "./memberships";
import { users } from "./users";

export const contentReports = pgTable(
  "content_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    reporterMembershipId: uuid("reporter_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    contentType: contentTypeEnum("content_type").notNull(),
    contentId: uuid("content_id").notNull(),
    reason: reportReasonEnum("reason").notNull(),
    details: text("details"),
    status: reportStatusEnum("status").notNull().default("OPEN"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("content_reports_unique_reporter_uq").on(t.tenantId, t.contentType, t.contentId, t.reporterMembershipId),
    index("content_reports_tenant_status_created_idx").on(t.tenantId, t.status, t.createdAt),
    index("content_reports_tenant_content_idx").on(t.tenantId, t.contentType, t.contentId),
  ],
);
