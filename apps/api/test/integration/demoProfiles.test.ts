import { createHash } from "node:crypto";
import { isCurrentPupil, membershipProfileUpdateSchema, sortEducation, sortExperiences } from "@illuminize/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invitations, memberFieldValues, memberships, tenantProfileFields, tenants, users } from "../../src/db/schema";
import { seedAll } from "../../src/db/seed";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

/**
 * What every generated member was given before profiles had details (phone, name, batch, city, country, profession,
 * company, role, date of birth, LinkedIn), as a digest. Their details come from a random stream of their own, so adding
 * them shifted none of these, which e2e journeys and other demo-data tests rely on. Change it only on purpose.
 */
const GENERATED_DIGEST = "50c7f56ae4bbd4956e8bfbe795034ffe5ef415e488757e0a26c7ab7280cc7a0f";

describe.skipIf(!dbAvailable)("demo profiles", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  async function seed() {
    const { tenantIds } = await seedAll(ctx.db, ["+919999999999"]);
    const rows = await ctx.db
      .select({ m: memberships, phone: users.phoneE164, tenant: tenants })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId));
    return { tenantIds, rows };
  }

  const detailsOf = (m: typeof memberships.$inferSelect) => ({
    headline: m.headline,
    industry: m.industry,
    careerStartYear: m.careerStartYear,
    skills: m.skills,
    degree: m.degree,
    fieldOfStudy: m.fieldOfStudy,
    experiences: m.experiences,
    education: m.education,
    linkedinUrl: m.linkedinUrl,
    websiteUrl: m.websiteUrl,
    githubUrl: m.githubUrl,
    instagramUrl: m.instagramUrl,
    xUrl: m.xUrl,
    openTo: m.openTo,
  });

  it("seeds full profiles for a few named members and partial ones for about 60% of generated members, as the API would save them", async () => {
    const { rows } = await seed();
    for (const { m, phone, tenant } of rows) {
      const details = detailsOf(m);
      // Valid by the profile's own rules, already in the form they leave it in, and with both lists newest first.
      const parsed = membershipProfileUpdateSchema.safeParse(details);
      expect(parsed.success, `${phone}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(parsed.data, phone).toEqual(details);
      expect(m.experiences, phone).toEqual(sortExperiences(m.experiences));
      expect(m.education, phone).toEqual(sortEducation(m.education));
      // Schools don't ask for a degree; a current pupil is open to nothing and links to nothing.
      if (tenant.type === "SCHOOL") expect([m.degree, m.fieldOfStudy], phone).toEqual([null, null]);
      if (isCurrentPupil(tenant, m)) expect([m.openTo, m.linkedinUrl, m.websiteUrl, m.githubUrl, m.instagramUrl, m.xUrl], phone).toEqual([[], null, null, null, null, null]);
    }

    const named = rows.filter((r) => !r.phone.startsWith("+9193"));
    const rich = named.filter(({ m }) => m.headline && m.skills.length >= 3 && m.experiences.length + m.education.length > 0 && m.openTo.length + Number(!!m.linkedinUrl) > 0);
    expect(rich.map((r) => `${r.tenant.slug}:${r.phone}`).sort()).toEqual(
      [
        "demo-university:+919100000001",
        "demo-university:+919100000002",
        "demo-university:+919100000005",
        "demo-university:+919100000006",
        "demo-college:+919100000011",
        "demo-college:+919100000012",
        "demo-school:+919100000023",
        "shri-gujarati-samaj:+919100000031",
        "shri-gujarati-samaj:+919100000032",
        "shri-gujarati-samaj:+919100000035",
        "shri-gujarati-samaj:+919100000036",
      ].sort(),
    );
    expect(named.find((r) => r.phone === "+919100000001")?.m).toMatchObject({ industry: "BANKING_FINANCE", fieldOfStudy: "Computer Science", openTo: ["HIRING", "COLLABORATING"] });

    const generated = rows.filter((r) => r.phone.startsWith("+9193"));
    const withDetails = generated.filter(({ m }) => m.headline || m.industry || m.careerStartYear || m.skills.length || m.degree || m.experiences.length || m.education.length || m.openTo.length || m.githubUrl || m.websiteUrl || m.instagramUrl || m.xUrl);
    expect(withDetails.length / generated.length).toBeGreaterThan(0.45);
    expect(withDetails.length / generated.length).toBeLessThan(0.75);
    // Partly filled, as real profiles are: some without skills, some with past roles and studies elsewhere.
    expect(withDetails.some(({ m }) => m.skills.length === 0)).toBe(true);
    expect(withDetails.filter(({ m }) => m.experiences.length > 0).length).toBeGreaterThan(5);
    expect(withDetails.filter(({ m }) => m.education.length > 0).length).toBeGreaterThan(5);

    // The Samaj's 20 came later, from a stream of their own, so the first three institutions' 110 are as they were.
    expect(generated.filter((r) => r.tenant.slug === "shri-gujarati-samaj")).toHaveLength(20);
    const core = generated
      .filter((r) => r.tenant.slug !== "shri-gujarati-samaj")
      .map(({ m, phone }) => [phone, m.fullName, m.batchYear, m.city, m.country, m.professionType, m.companyName, m.designation, m.dateOfBirth, m.linkedinUrl] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    expect(core).toHaveLength(110);
    expect(createHash("sha256").update(JSON.stringify(core)).digest("hex")).toBe(GENERATED_DIGEST);
  });

  it("seeds no year past the server's own, even when it's already New Year's Day in India", async () => {
    // The seed dates its history in India's time; the profile's rules cap years by the server's clock, here UTC.
    const zone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
    // 20:00 UTC on 31 December is 01:30 on 1 January in India.
    vi.setSystemTime(new Date(`${new Date().getUTCFullYear()}-12-31T20:00:00Z`));
    try {
      const { rows } = await seed();
      for (const { m, phone } of rows) {
        const parsed = membershipProfileUpdateSchema.safeParse(detailsOf(m));
        expect(parsed.success, `${phone}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      }
    } finally {
      vi.useRealTimers();
      process.env.TZ = zone;
    }
  });

  it("asks no question a profile now has built in: Hostel replaces Department in the university, and the college has a choose-several question", async () => {
    const { tenantIds } = await seed();
    const questions = async (slug: string) => ctx.db.select().from(tenantProfileFields).where(eq(tenantProfileFields.tenantId, tenantIds[slug]!)).orderBy(tenantProfileFields.position);
    expect((await questions("demo-university")).map((f) => f.key)).toEqual(["hostel", "office_notes"]);
    expect((await questions("demo-school")).map((f) => f.key)).toEqual(["house", "year_joined"]);
    const [clubs, ...rest] = await questions("demo-college");
    expect(rest).toEqual([]);
    expect(clubs).toMatchObject({ key: "clubs", label: "Clubs and societies", type: "MULTI_SELECT", filterable: true, visibility: "MEMBERS", memberEditable: true });
    const answers = await ctx.db.select().from(memberFieldValues).where(eq(memberFieldValues.fieldId, clubs!.id));
    expect(answers.length).toBeGreaterThan(10);
    const options = new Set(clubs!.options.map((o) => o.value));
    for (const a of answers) {
      expect(Array.isArray(a.value) && a.value.length > 0, JSON.stringify(a.value)).toBe(true);
      for (const v of a.value as string[]) expect(options.has(v), v).toBe(true);
    }
    expect(answers.some((a) => (a.value as string[]).length > 1)).toBe(true);

    // The invitation prefill answers a question the university still asks, with one of its choices.
    const [invite] = await ctx.db.select().from(invitations).where(and(eq(invitations.tenantId, tenantIds["demo-university"]!), eq(invitations.phoneE164, "+919400000001")));
    expect(invite?.fieldValues).toEqual({ hostel: "raman" });
    const hostel = (await questions("demo-university")).find((f) => f.key === "hostel")!;
    expect(hostel.options.map((o) => o.value)).toContain("raman");
  });
});
