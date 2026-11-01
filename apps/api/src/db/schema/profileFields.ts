import type { ProfileFieldOption, ProfileFieldValue } from "@illuminize/shared";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { profileFieldTypeEnum, profileFieldVisibilityEnum } from "./enums";
import { jsonValue, tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";

/** An institution's own profile question ("House", "Roll number", "Hostel"). Archived, never deleted. */
export const tenantProfileFields = pgTable(
  "tenant_profile_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    /** Immutable; names the field in CSV imports/exports and answers. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),
    type: profileFieldTypeEnum("type").notNull(),
    options: jsonb("options").$type<ProfileFieldOption[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    visibility: profileFieldVisibilityEnum("visibility").notNull().default("MEMBERS"),
    memberEditable: boolean("member_editable").notNull().default(true),
    filterable: boolean("filterable").notNull().default(false),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true, precision: 3 }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("tenant_profile_fields_key_uq").on(t.tenantId, t.key), index("tenant_profile_fields_tenant_pos_idx").on(t.tenantId, t.position)],
);

/** A member's answer to one field. */
export const memberFieldValues = pgTable(
  "member_field_values",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => tenantProfileFields.id, { onDelete: "cascade" }),
    ...tenantScoped(),
    value: jsonValue<ProfileFieldValue>("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.fieldId] }), index("member_field_values_field_idx").on(t.fieldId)],
);
