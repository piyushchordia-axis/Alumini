import { MEMBERSHIP_STATUS_LABELS, PROFESSION_TYPE_LABELS, countryName, wallPartsInZone, type MembershipRole } from "@illuminize/shared";
import type { Response } from "express";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { memberActivityDays, memberships, moderationItems, users } from "../db/schema";
import { streamCsv } from "../lib/csvStream";
import type { TenantContext } from "../types/request";
import { analyticsRange, getPlatformComparison } from "./analytics.service";
import { recordAudit } from "./audit.service";
import { answersFor, getActiveFields } from "./profileFields.service";

/** Rows fetched per query while streaming an export. */
export const EXPORT_BATCH = 1000;

interface ExportActor {
  userId: string;
  membershipId: string | null;
  ip?: string;
}

const ROLE_LABELS: Record<MembershipRole, string> = { MEMBER: "Member", TENANT_ADMIN: "Admin" };
const pad = (n: number) => String(n).padStart(2, "0");
const dateIn = (d: Date | null, tz: string) => {
  if (!d) return "";
  const p = wallPartsInZone(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};
const dateTimeIn = (d: Date | null, tz: string) => {
  if (!d) return "";
  const p = wallPartsInZone(d, tz);
  return `${dateIn(d, tz)} ${pad(p.hour)}:${pad(p.minute)}`;
};

/**
 * Pages of members in name order (keyset on name, id), so a large institution streams in constant memory and a
 * member added mid-export can't shift a page boundary and be skipped or repeated.
 */
async function* memberPages<T>(ctx: AppContext, tenantId: string, where: ReturnType<typeof and> | undefined, map: (rows: MemberRow[]) => Promise<T[][]>): AsyncGenerator<T[][]> {
  let after: { name: string; id: string } | null = null;
  for (;;) {
    const rows: MemberRow[] = await ctx.db
      .select({
        id: memberships.id,
        fullName: memberships.fullName,
        phone: users.phoneE164,
        email: sql<string | null>`case when ${users.emailVerifiedAt} is not null then ${users.email} end`,
        batchYear: memberships.batchYear,
        status: memberships.status,
        role: memberships.role,
        professionType: memberships.professionType,
        companyName: memberships.companyName,
        designation: memberships.designation,
        city: memberships.city,
        country: memberships.country,
        dateOfBirth: memberships.dateOfBirth,
        createdAt: memberships.createdAt,
        approvedAt: memberships.approvedAt,
        lastActiveAt: memberships.lastActiveAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), where, after ? sql`(${memberships.fullName}, ${memberships.id}) > (${after.name}, ${after.id})` : undefined))
      .orderBy(memberships.fullName, memberships.id)
      .limit(EXPORT_BATCH);
    if (rows.length === 0) return;
    yield await map(rows);
    if (rows.length < EXPORT_BATCH) return;
    const last = rows[rows.length - 1]!;
    after = { name: last.fullName, id: last.id };
  }
}

interface MemberRow {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  batchYear: number;
  status: keyof typeof MEMBERSHIP_STATUS_LABELS;
  role: MembershipRole;
  professionType: keyof typeof PROFESSION_TYPE_LABELS;
  companyName: string | null;
  designation: string | null;
  city: string | null;
  country: string | null;
  dateOfBirth: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  lastActiveAt: Date | null;
}

async function audit(ctx: AppContext, tenantId: string, actor: ExportActor, action: string, metadata: Record<string, unknown>) {
  await recordAudit(ctx, { tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, action, metadata, ip: actor.ip ?? null });
}

/**
 * Every member with their profile, confirmed email and all custom fields (admin-only ones included). Dates are in
 * the institution's time zone.
 */
export async function exportMembersCsv(ctx: AppContext, tenantCtx: TenantContext, actor: ExportActor, res: Response): Promise<void> {
  const { tenant } = tenantCtx;
  const tz = tenant.timezone;
  const fields = await getActiveFields(ctx, tenant.id);
  const header = ["Name", "Phone", "Email", "Batch", "Status", "Role", "Profession", "Company", "Designation", "City", "Country", "Date of birth", "Joined", "Approved", "Last active", ...fields.map((f) => f.label)];
  const pages = memberPages(ctx, tenant.id, undefined, async (rows) => {
    const answers = await answersFor(ctx, tenant.id, rows.map((r) => r.id), "admin");
    return rows.map((r) => {
      const byKey = new Map((answers.get(r.id) ?? []).map((a) => [a.key, a.display]));
      return [
        r.fullName,
        r.phone,
        r.email,
        r.batchYear,
        MEMBERSHIP_STATUS_LABELS[r.status],
        ROLE_LABELS[r.role],
        PROFESSION_TYPE_LABELS[r.professionType],
        r.companyName,
        r.designation,
        r.city,
        r.country ? (countryName(r.country) ?? r.country) : null,
        r.dateOfBirth,
        dateIn(r.createdAt, tz),
        dateIn(r.approvedAt, tz),
        dateTimeIn(r.lastActiveAt, tz),
        ...fields.map((f) => byKey.get(f.key) ?? ""),
      ];
    });
  });
  // Audited before the first byte, so even an export cut short is on record (and the entry exists by the time the
  // download finishes).
  await audit(ctx, tenant.id, actor, "export.members", { customFields: fields.length });
  await streamCsv(res, `${tenant.slug}-members-${dateIn(new Date(), tz)}.csv`, header, pages);
}

/**
 * Per member who has been approved: days active (the billing definition), and content created in the last `weeks`
 * weeks (Monday-start, in the institution's time zone, the current week included).
 */
export async function exportActivityCsv(ctx: AppContext, tenantCtx: TenantContext, actor: ExportActor, weeks: number, res: Response): Promise<void> {
  const { tenant } = tenantCtx;
  const tz = tenant.timezone;
  const range = analyticsRange(tz, weeks);
  const header = ["Name", "Phone", "Batch", "Status", "Active days", "Posts", "Comments", "Jobs", "Events", "Last active"];
  const pages = memberPages(ctx, tenant.id, and(isNotNull(memberships.approvedAt)), async (rows) => {
    const ids = rows.map((r) => r.id);
    const [days, content] = await Promise.all([
      ctx.db
        .select({ id: memberActivityDays.membershipId, n: sql<number>`count(*)::int` })
        .from(memberActivityDays)
        .where(and(inArray(memberActivityDays.membershipId, ids), sql`${memberActivityDays.day} >= ${range.firstWeek}`, sql`${memberActivityDays.day} <= ${range.today}`))
        .groupBy(memberActivityDays.membershipId),
      ctx.db
        .select({ id: moderationItems.authorMembershipId, type: moderationItems.contentType, n: sql<number>`count(*)::int` })
        .from(moderationItems)
        .where(and(eq(moderationItems.tenantId, tenant.id), inArray(moderationItems.authorMembershipId, ids), sql`${moderationItems.createdAt} >= ${range.from}`, sql`${moderationItems.moderationStatus} <> 'REJECTED'`))
        .groupBy(moderationItems.authorMembershipId, moderationItems.contentType),
    ]);
    const daysBy = new Map(days.map((d) => [d.id, d.n]));
    const count = (id: string, type: string) => content.find((c) => c.id === id && c.type === type)?.n ?? 0;
    return rows.map((r) => [r.fullName, r.phone, r.batchYear, MEMBERSHIP_STATUS_LABELS[r.status], daysBy.get(r.id) ?? 0, count(r.id, "POST"), count(r.id, "COMMENT"), count(r.id, "JOB"), count(r.id, "EVENT"), dateTimeIn(r.lastActiveAt, tz)]);
  });
  await audit(ctx, tenant.id, actor, "export.activity", { from: range.firstWeek, to: range.today });
  await streamCsv(res, `${tenant.slug}-activity-${range.firstWeek}-to-${range.today}.csv`, header, pages);
}

/** The platform comparison as a spreadsheet, for chargeback. Amounts are in major units (rupees, not paise). */
export async function exportComparisonCsv(ctx: AppContext, actor: ExportActor, query: { from?: string; to?: string }, res: Response): Promise<void> {
  const data = await getPlatformComparison(ctx, query);
  const header = ["Institution", "Slug", "Status", "Approved members", "New members", "Active members", "Activity rate %", "Posts", "Jobs", "Events", "WhatsApp messages", "SMS messages", "Emails", "Billing model", "Billing cycle", "Estimated amount", "Currency"];
  const rows = data.rows.map((r) => [
    r.tenant.name,
    r.tenant.slug,
    r.tenant.status,
    r.approvedMembers,
    r.newMembers,
    r.activeMembers,
    Math.round(r.activityRate * 1000) / 10,
    r.content.posts,
    r.content.jobs,
    r.content.events,
    r.messages.WHATSAPP,
    r.messages.SMS,
    r.messages.EMAIL,
    r.plan?.billingModel ?? "",
    r.plan?.billingCycle ?? "",
    (r.estimatedAmountMinor / 100).toFixed(2),
    r.currency,
  ]);
  async function* one() {
    if (rows.length) yield rows;
  }
  await recordAudit(ctx, { actorUserId: actor.userId, action: "platform.export.comparison", metadata: { institutions: rows.length, from: data.periodStart, to: data.periodEnd }, ip: actor.ip ?? null });
  await streamCsv(res, `institutions-${data.periodStart}-to-${data.periodEnd}.csv`, header, one());
}
