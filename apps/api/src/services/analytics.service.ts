import { MESSAGE_CHANNELS, PROFESSION_TYPE_LABELS, countryName, zonedWallTimeToUtc, type CountRow, type MessageChannel, type PlatformComparisonDto, type TenantAnalyticsDto } from "@illuminize/shared";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { invitations, memberActivityDays, memberFieldValues, memberships, moderationItems, outboundMessages, tenantBillingPlans, tenants, users } from "../db/schema";
import { toBillingPlanDto } from "../dto/platform.dto";
import { addDays, billingPeriod, currentMonth, cycleFraction } from "./billing.periods";
import { estimateAmount, messageAmount } from "./billing.service";
import { localClock } from "./celebrations.service";
import { weekStartIn } from "./digest.service";
import { getActiveFields } from "./profileFields.service";

const OTHER = "Other";

/** Folds a ranked list into its top `n` plus an "Other" row with the rest. */
function topWithOther(rows: CountRow[], n: number): CountRow[] {
  if (rows.length <= n) return rows;
  const rest = rows.slice(n).reduce((sum, r) => sum + r.count, 0);
  return [...rows.slice(0, n), { label: OTHER, count: rest }];
}

/** Week starts from `first` to `last` (Mondays, inclusive). */
function mondays(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 7)) out.push(d);
  return out;
}

/**
 * Admin analytics over the last `weeks` weeks (Monday-start in the institution's time zone, the current week
 * included). "Active" uses member activity days, the same definition as billing, so the numbers match invoices.
 */
/**
 * The last `weeks` Monday-start weeks in a time zone, the current one included, and the same span before it.
 * `from`/`prevFrom` are the instants those weeks start; `today` is the local date (the range's last day).
 */
export function analyticsRange(tz: string, weeks: number, now = new Date()) {
  const lastWeek = weekStartIn(now, tz);
  const firstWeek = addDays(lastWeek, -7 * (weeks - 1));
  const prevFirst = addDays(firstWeek, -7 * weeks);
  const at = (day: string) => new Date(zonedWallTimeToUtc(`${day}T00:00`, tz)!);
  return { weekList: mondays(firstWeek, lastWeek), firstWeek, prevFirst, from: at(firstWeek), prevFrom: at(prevFirst), today: localClock(now, tz).day };
}

export async function getTenantAnalytics(ctx: AppContext, tenantId: string, weeks: number): Promise<TenantAnalyticsDto> {
  const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
  const tz = tenant!.timezone;
  const { weekList, firstWeek, prevFirst, from, prevFrom, today } = analyticsRange(tz, weeks);
  const index = new Map(weekList.map((w, i) => [w, i]));
  const weekOf = (col: unknown) => sql<string>`to_char(date_trunc('week', ${col} at time zone ${tz}), 'YYYY-MM-DD')`;
  const fill = (rows: Array<{ week: string; n: number }>) => {
    const arr = weekList.map(() => 0);
    for (const r of rows) {
      const i = index.get(r.week);
      if (i !== undefined) arr[i] = r.n;
    }
    return arr;
  };

  const inTenant = eq(memberships.tenantId, tenantId);
  const approved = and(inTenant, eq(memberships.status, "APPROVED"));
  const [joined, registered, active, content, kpiRows, activeNow, activePrev, batches, cities, countries, professions, completeness, inviteRows] = await Promise.all([
    ctx.db
      .select({ week: weekOf(memberships.approvedAt), n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(inTenant, sql`${memberships.approvedAt} >= ${from}`))
      .groupBy(sql`1`),
    ctx.db
      .select({ week: weekOf(memberships.createdAt), n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(inTenant, sql`${memberships.createdAt} >= ${from}`))
      .groupBy(sql`1`),
    // Activity days are calendar dates already (billing time zone); bucket them into Monday weeks.
    ctx.db
      .select({ week: sql<string>`to_char(date_trunc('week', ${memberActivityDays.day}::timestamp), 'YYYY-MM-DD')`, n: sql<number>`count(distinct ${memberActivityDays.membershipId})::int` })
      .from(memberActivityDays)
      .where(and(eq(memberActivityDays.tenantId, tenantId), sql`${memberActivityDays.day} >= ${firstWeek}`))
      .groupBy(sql`1`),
    ctx.db
      .select({ type: moderationItems.contentType, week: weekOf(moderationItems.createdAt), n: sql<number>`count(*)::int` })
      .from(moderationItems)
      .where(and(eq(moderationItems.tenantId, tenantId), sql`${moderationItems.createdAt} >= ${prevFrom}`, sql`${moderationItems.moderationStatus} <> 'REJECTED'`))
      .groupBy(sql`1`, sql`2`),
    ctx.db
      .select({
        members: sql<number>`(count(*) filter (where ${memberships.status} = 'APPROVED'))::int`,
        newMembers: sql<number>`(count(*) filter (where ${memberships.approvedAt} >= ${from}))::int`,
        newMembersPrev: sql<number>`(count(*) filter (where ${memberships.approvedAt} >= ${prevFrom} and ${memberships.approvedAt} < ${from}))::int`,
      })
      .from(memberships)
      .where(inTenant),
    ctx.db
      .select({ n: sql<number>`count(distinct ${memberActivityDays.membershipId})::int` })
      .from(memberActivityDays)
      .where(and(eq(memberActivityDays.tenantId, tenantId), sql`${memberActivityDays.day} >= ${firstWeek}`, sql`${memberActivityDays.day} <= ${today}`)),
    ctx.db
      .select({ n: sql<number>`count(distinct ${memberActivityDays.membershipId})::int` })
      .from(memberActivityDays)
      .where(and(eq(memberActivityDays.tenantId, tenantId), sql`${memberActivityDays.day} >= ${prevFirst}`, sql`${memberActivityDays.day} < ${firstWeek}`)),
    ctx.db
      .select({ label: sql<string>`${memberships.batchYear}::text`, count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(approved)
      .groupBy(memberships.batchYear)
      .orderBy(memberships.batchYear),
    ctx.db
      .select({ label: sql<string>`initcap(trim(${memberships.city}))`, count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(approved, sql`coalesce(trim(${memberships.city}), '') <> ''`))
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`, sql`1`),
    ctx.db
      .select({ label: memberships.country, count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(approved, sql`${memberships.country} is not null`))
      .groupBy(memberships.country)
      .orderBy(sql`2 desc`),
    ctx.db
      .select({ label: memberships.professionType, count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(approved)
      .groupBy(memberships.professionType)
      .orderBy(sql`2 desc`),
    ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        photo: sql<number>`(count(*) filter (where ${memberships.avatarUrl} is not null))::int`,
        headline: sql<number>`(count(*) filter (where coalesce(${memberships.headline}, '') <> ''))::int`,
        city: sql<number>`(count(*) filter (where coalesce(${memberships.city}, '') <> ''))::int`,
        company: sql<number>`(count(*) filter (where coalesce(${memberships.companyName}, '') <> ''))::int`,
        industry: sql<number>`(count(*) filter (where ${memberships.industry} is not null))::int`,
        skills: sql<number>`(count(*) filter (where cardinality(${memberships.skills}) > 0))::int`,
        pastRoles: sql<number>`(count(*) filter (where jsonb_array_length(${memberships.experiences}) > 0))::int`,
        education: sql<number>`(count(*) filter (where coalesce(${memberships.degree}, '') <> '' or coalesce(${memberships.fieldOfStudy}, '') <> '' or jsonb_array_length(${memberships.education}) > 0))::int`,
        birthday: sql<number>`(count(*) filter (where ${memberships.dateOfBirth} is not null))::int`,
        linkedin: sql<number>`(count(*) filter (where ${memberships.linkedinUrl} is not null))::int`,
        anyLink: sql<number>`(count(*) filter (where coalesce(${memberships.linkedinUrl}, ${memberships.websiteUrl}, ${memberships.githubUrl}, ${memberships.instagramUrl}, ${memberships.xUrl}) is not null))::int`,
        email: sql<number>`(count(*) filter (where ${users.email} is not null))::int`,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(approved),
    ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        sent: sql<number>`(count(*) filter (where ${invitations.sendCount} > 0))::int`,
        accepted: sql<number>`(count(*) filter (where ${invitations.status} = 'ACCEPTED'))::int`,
      })
      .from(invitations)
      .where(eq(invitations.tenantId, tenantId)),
  ]);

  const contentSeries = (type: string) => fill(content.filter((c) => c.type === type).map((c) => ({ week: c.week, n: c.n })));
  const postsPrev = content.filter((c) => c.type === "POST" && c.week >= prevFirst && c.week < firstWeek).reduce((s, c) => s + c.n, 0);
  const posts = contentSeries("POST");

  // Answer counts for choice and yes/no fields (several choices count once each).
  const choiceFields = (await getActiveFields(ctx, tenantId)).filter((f) => f.type === "SELECT" || f.type === "MULTI_SELECT" || f.type === "BOOLEAN");
  const answerRows = choiceFields.length
    ? await ctx.db
        .select({ fieldId: memberFieldValues.fieldId, value: sql<string>`coalesce(e.elem, ${memberFieldValues.value} #>> '{}')`, n: sql<number>`count(*)::int` })
        .from(memberFieldValues)
        .innerJoin(memberships, eq(memberships.id, memberFieldValues.membershipId))
        .leftJoin(sql`lateral jsonb_array_elements_text(case when jsonb_typeof(${memberFieldValues.value}) = 'array' then ${memberFieldValues.value} else '[]'::jsonb end) as e(elem)`, sql`true`)
        .where(and(approved, inArray(memberFieldValues.fieldId, choiceFields.map((f) => f.id))))
        .groupBy(sql`1`, sql`2`)
    : [];
  const fields = choiceFields.map((f) => {
    const label = (v: string) => (f.type === "BOOLEAN" ? (v === "true" ? "Yes" : v === "false" ? "No" : v) : (f.options.find((o) => o.value === v)?.label ?? v));
    const options = answerRows
      .filter((r) => r.fieldId === f.id)
      .map((r) => ({ label: label(r.value), count: r.n }))
      .sort((a, b) => b.count - a.count);
    return { key: f.key, label: f.label, options: topWithOther(options, 10) };
  });

  const k = kpiRows[0]!;
  return {
    timeZone: tz,
    weeks: weekList,
    kpis: {
      members: k.members,
      newMembers: k.newMembers,
      newMembersPrev: k.newMembersPrev,
      activeMembers: activeNow[0]?.n ?? 0,
      activeMembersPrev: activePrev[0]?.n ?? 0,
      posts: posts.reduce((a, b) => a + b, 0),
      postsPrev,
    },
    series: { joined: fill(joined), registered: fill(registered), active: fill(active), posts, comments: contentSeries("COMMENT"), jobs: contentSeries("JOB"), events: contentSeries("EVENT") },
    coverage: {
      batches,
      cities: topWithOther(cities, 10),
      countries: topWithOther(
        countries.map((c) => ({ label: countryName(c.label) ?? c.label ?? "", count: c.count })),
        8,
      ),
      professions: professions.map((p) => ({ label: PROFESSION_TYPE_LABELS[p.label], count: p.count })),
      completeness: completeness[0]!,
      fields,
    },
    invites: inviteRows[0] ?? { total: 0, sent: 0, accepted: 0 },
  };
}

/**
 * One row per institution for a billing period (days in the billing time zone): members, activity (billing
 * definition), content created, messages delivered and the estimated charge. Grouped queries, so it covers every
 * institution however many there are.
 */
export async function getPlatformComparison(ctx: AppContext, query: { from?: string; to?: string }): Promise<PlatformComparisonDto> {
  const timeZone = ctx.config.BILLING_TIMEZONE;
  const month = currentMonth(timeZone);
  const periodStart = query.from ?? month.fromDay;
  const periodEnd = query.to ?? month.toDay;
  const { from, toExclusive } = billingPeriod(periodStart, periodEnd, timeZone);
  const [allTenants, members, active, content, messages, plans] = await Promise.all([
    ctx.db.select().from(tenants).orderBy(tenants.name),
    ctx.db
      .select({
        tenantId: memberships.tenantId,
        approved: sql<number>`(count(*) filter (where ${memberships.approvedAt} < ${toExclusive} and not (${memberships.status} in ('SUSPENDED', 'REJECTED') and ${memberships.statusChangedAt} < ${toExclusive})))::int`,
        created: sql<number>`(count(*) filter (where ${memberships.approvedAt} >= ${from} and ${memberships.approvedAt} < ${toExclusive}))::int`,
      })
      .from(memberships)
      .groupBy(memberships.tenantId),
    ctx.db
      .select({ tenantId: memberActivityDays.tenantId, n: sql<number>`count(distinct ${memberActivityDays.membershipId})::int` })
      .from(memberActivityDays)
      .where(and(sql`${memberActivityDays.day} >= ${periodStart}`, sql`${memberActivityDays.day} <= ${periodEnd}`))
      .groupBy(memberActivityDays.tenantId),
    ctx.db
      .select({ tenantId: moderationItems.tenantId, type: moderationItems.contentType, n: sql<number>`count(*)::int` })
      .from(moderationItems)
      .where(and(sql`${moderationItems.createdAt} >= ${from}`, sql`${moderationItems.createdAt} < ${toExclusive}`, sql`${moderationItems.moderationStatus} <> 'REJECTED'`))
      .groupBy(moderationItems.tenantId, moderationItems.contentType),
    ctx.db
      .select({ tenantId: outboundMessages.tenantId, channel: outboundMessages.channel, n: sql<number>`count(*)::int` })
      .from(outboundMessages)
      .where(and(inArray(outboundMessages.status, ["SENT", "DELIVERED", "READ"]), sql`${outboundMessages.sentAt} >= ${from}`, sql`${outboundMessages.sentAt} < ${toExclusive}`))
      .groupBy(outboundMessages.tenantId, outboundMessages.channel),
    // The plan in force on the period's last day, per institution.
    ctx.db
      .selectDistinctOn([tenantBillingPlans.tenantId])
      .from(tenantBillingPlans)
      .where(and(lte(tenantBillingPlans.effectiveFrom, periodEnd), or(isNull(tenantBillingPlans.effectiveTo), sql`${tenantBillingPlans.effectiveTo} >= ${periodEnd}`)))
      .orderBy(tenantBillingPlans.tenantId, sql`${tenantBillingPlans.effectiveFrom} desc`),
  ]);
  const byTenant = <T extends { tenantId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.tenantId) m.set(r.tenantId, [...(m.get(r.tenantId) ?? []), r]);
    return m;
  };
  const membersBy = new Map(members.map((m) => [m.tenantId, m]));
  const activeBy = new Map(active.map((a) => [a.tenantId, a.n]));
  const contentBy = byTenant(content);
  const messagesBy = byTenant(messages);
  const planBy = new Map(plans.map((p) => [p.tenantId, toBillingPlanDto(p)]));

  const rows = allTenants.map((t) => {
    const m = membersBy.get(t.id);
    const approvedMembers = m?.approved ?? 0;
    const activeMembers = activeBy.get(t.id) ?? 0;
    const c = contentBy.get(t.id) ?? [];
    const count = (type: string) => c.find((x) => x.type === type)?.n ?? 0;
    const msgs = Object.fromEntries(MESSAGE_CHANNELS.map((ch) => [ch, (messagesBy.get(t.id) ?? []).find((x) => x.channel === ch)?.n ?? 0])) as Record<MessageChannel, number>;
    const plan = planBy.get(t.id) ?? null;
    const fraction = plan ? cycleFraction(periodStart, periodEnd, plan.billingCycle) : 1;
    return {
      tenant: { id: t.id, slug: t.slug, name: t.name, shortName: t.shortName, type: t.type, city: t.city, country: t.country, logoUrl: t.logoUrl, primaryColor: t.primaryColor, status: t.status },
      approvedMembers,
      newMembers: m?.created ?? 0,
      activeMembers,
      activityRate: approvedMembers ? Math.round((activeMembers / approvedMembers) * 1000) / 1000 : 0,
      content: { posts: count("POST"), jobs: count("JOB"), events: count("EVENT") },
      messages: msgs,
      plan: plan ? { billingModel: plan.billingModel, billingCycle: plan.billingCycle, currency: plan.currency } : null,
      estimatedAmountMinor: estimateAmount(plan, activeMembers, fraction) + messageAmount(plan, msgs),
      currency: plan?.currency ?? "INR",
    };
  });
  return { periodStart, periodEnd, timeZone, rows };
}
