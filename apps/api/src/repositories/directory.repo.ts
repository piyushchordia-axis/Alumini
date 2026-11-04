import { and, asc, eq, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { INDUSTRIES, type DirectoryQuery, type Industry } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { memberFieldValues, memberships, tenantProfileFields, users } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow, TenantRow } from "../types/request";
import { escapeLike } from "./content.common";
import { notCurrentPupil } from "./memberships.repo";
import type { UserRow } from "./users.repo";

/** Members who list a skill that `matches`, a condition on `skill`. */
const hasSkill = (matches: SQL) => sql`exists (select 1 from unnest(${memberships.skills}) as listed(skill) where ${matches})`;

export async function searchDirectory(db: DbClient, tenant: Pick<TenantRow, "id" | "type" | "timezone">, q: DirectoryQuery, now = new Date()): Promise<CursorPage<MembershipRow>> {
  const conds: SQL[] = [eq(memberships.tenantId, tenant.id), eq(memberships.status, "APPROVED")];
  if (q.q) {
    const p = `%${escapeLike(q.q)}%`;
    conds.push(or(ilike(memberships.fullName, p), ilike(memberships.companyName, p), ilike(memberships.designation, p), ilike(memberships.headline, p), hasSkill(sql`skill ilike ${p}`))!);
  }
  if (q.batchYear) conds.push(eq(memberships.batchYear, q.batchYear));
  if (q.city) conds.push(ilike(memberships.city, escapeLike(q.city)));
  if (q.country) conds.push(eq(memberships.country, q.country));
  if (q.professionType) conds.push(eq(memberships.professionType, q.professionType));
  if (q.company) conds.push(ilike(memberships.companyName, `%${escapeLike(q.company)}%`));
  if (q.industry) conds.push(eq(memberships.industry, q.industry));
  if (q.skill) conds.push(hasSkill(sql`lower(skill) = lower(${q.skill})`));
  if (q.fieldOfStudy) conds.push(ilike(memberships.fieldOfStudy, escapeLike(q.fieldOfStudy)));
  // Saving clears a pupil's Open to, but a value stored before that rule mustn't be findable either: their card hides it.
  if (q.openTo) conds.push(and(sql`${q.openTo}::open_to = any(${memberships.openTo})`, notCurrentPupil(tenant, now))!);
  // Custom-field filters: only the institution's active, filterable, members-visible fields match. A choice answer
  // is a JSON string, several choices a JSON array, yes/no a JSON boolean.
  for (const f of q.field ?? []) {
    conds.push(sql`exists (
      select 1 from ${memberFieldValues} v join ${tenantProfileFields} pf on pf.id = v.field_id
      where v.membership_id = ${memberships.id} and pf.tenant_id = ${tenant.id} and pf.key = ${f.key}
        and pf.filterable and pf.visibility = 'MEMBERS' and pf.archived_at is null
        and (v.value = to_jsonb(${f.value}::text) or v.value @> jsonb_build_array(${f.value}::text)
             or (jsonb_typeof(v.value) = 'boolean' and v.value::text = ${f.value}::text))
    )`);
  }
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(memberships.fullName, memberships.id, cursor, "asc", (v) => v);
  if (keyset) conds.push(keyset);
  const rows = await db
    .select()
    .from(memberships)
    .where(and(...conds))
    .orderBy(asc(memberships.fullName), asc(memberships.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.fullName, id: r.id }), (r) => r);
}

/** How many of the top skills and fields of study the filters offer. */
const TOP_TERMS = 50;

export async function directoryFacets(
  db: DbClient,
  tenantId: string,
): Promise<{ batchYears: number[]; cities: string[]; countries: string[]; companies: string[]; industries: Industry[]; skills: string[]; fieldsOfStudy: string[] }> {
  const base = and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"));
  const field = sql`trim(${memberships.fieldOfStudy})`;
  const [years, cities, countries, companies, industries, skills, fields] = await Promise.all([
    db.selectDistinct({ v: memberships.batchYear }).from(memberships).where(base).orderBy(sql`${memberships.batchYear} desc`),
    db
      .select({ v: memberships.city, n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(base, sql`${memberships.city} IS NOT NULL AND ${memberships.city} <> ''`))
      .groupBy(memberships.city)
      .orderBy(sql`count(*) desc`, asc(memberships.city))
      .limit(100),
    db.selectDistinct({ v: memberships.country }).from(memberships).where(and(base, sql`${memberships.country} IS NOT NULL`)).orderBy(asc(memberships.country)),
    db
      .select({ v: memberships.companyName, n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(base, sql`${memberships.companyName} IS NOT NULL AND ${memberships.companyName} <> ''`))
      .groupBy(memberships.companyName)
      .orderBy(sql`count(*) desc`, asc(memberships.companyName))
      .limit(100),
    db.selectDistinct({ v: memberships.industry }).from(memberships).where(and(base, isNotNull(memberships.industry))),
    // The filters match regardless of case, so "Go" and "go" are one option, shown as most members spell it.
    db
      .select({ v: sql<string>`mode() within group (order by s.skill)`, n: sql<number>`count(*)::int` })
      .from(memberships)
      .innerJoin(sql`lateral unnest(${memberships.skills}) as s(skill)`, sql`true`)
      .where(base)
      .groupBy(sql`lower(s.skill)`)
      .orderBy(sql`count(*) desc`, sql`1`)
      .limit(TOP_TERMS),
    db
      .select({ v: sql<string>`mode() within group (order by ${field})`, n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(base, sql`coalesce(${field}, '') <> ''`))
      .groupBy(sql`lower(${field})`)
      .orderBy(sql`count(*) desc`, sql`1`)
      .limit(TOP_TERMS),
  ]);
  const present = new Set(industries.map((r) => r.v));
  return {
    batchYears: years.map((r) => r.v),
    cities: cities.map((r) => r.v!).filter(Boolean),
    countries: countries.map((r) => r.v!).filter(Boolean),
    companies: companies.map((r) => r.v!).filter(Boolean),
    industries: INDUSTRIES.filter((i) => present.has(i)),
    skills: skills.map((r) => r.v),
    fieldsOfStudy: fields.map((r) => r.v),
  };
}

export async function findApprovedMemberWithUser(
  db: DbClient,
  tenantId: string,
  membershipId: string,
): Promise<{ membership: MembershipRow; user: UserRow } | undefined> {
  const [row] = await db
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, membershipId), eq(memberships.status, "APPROVED")))
    .limit(1);
  return row;
}
