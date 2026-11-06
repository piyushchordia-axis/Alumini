import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memberships, tenants } from "../../src/db/schema";
import { PROFILE, auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

/** Everything "Use details from …" may copy, and nothing else. */
const PORTABLE_KEYS = [
  "bio",
  "careerStartYear",
  "city",
  "companyName",
  "country",
  "dateOfBirth",
  "designation",
  "education",
  "experiences",
  "githubUrl",
  "headline",
  "industry",
  "instagramUrl",
  "interests",
  "linkedinUrl",
  "openTo",
  "skills",
  "source",
  "websiteUrl",
  "xUrl",
];

describe.skipIf(!dbAvailable)("copying a profile from another institution", () => {
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
  const api = () => request(ctx.app);
  const copy = (headers: Record<string, string>, exclude?: string) => api().get(`/api/v1/me/profile-copy${exclude ? `?exclude=${exclude}` : ""}`).set(headers);

  it("offers only the caller's own portable details, from their most recently updated other membership", async () => {
    const { tenant: college } = await createTenant(ctx, { slug: "demo-college", name: "Demo College" });
    const { tenant: university } = await createTenant(ctx, { slug: "demo-university", name: "Demo University" });
    const { tenant: joining } = await createTenant(ctx, { slug: "joining" });
    const admin = await memberSession(ctx, university.id, { role: "TENANT_ADMIN" });
    const me = await memberSession(ctx, college.id, { batchYear: 2008 });
    await createMembership(ctx, university.id, me.user.id, { startYear: 2008, batchYear: 2012 });
    const patch = (slug: string, body: object) => api().patch(`/api/v1/t/${slug}/memberships/me`).set(me.headers).send(body);

    // An institution's own question, answered at the university: never copied.
    const field = await api().post(`/api/v1/t/${university.slug}/admin/profile-fields`).set(admin.headers).send({ key: "hostel", label: "Hostel", type: "TEXT" });
    expect(field.status).toBe(201);

    expect((await patch(college.slug, { headline: "Old headline", city: "Delhi" })).status).toBe(200);
    const personal = { maritalStatus: "MARRIED", kidsCount: 2, isPhoneVisible: true, celebrateBirthday: false, fields: { hostel: "Raman" } };
    const atUniversity = {
      headline: "Builds payments at Zylo",
      companyName: "Zylo",
      designation: "Engineer",
      industry: "SOFTWARE_INTERNET",
      careerStartYear: 2014,
      skills: ["Go", "SQL"],
      degree: "M.Tech",
      fieldOfStudy: "Computer Science",
      experiences: [{ company: "Acme", title: "Intern", startYear: 2013, endYear: 2014 }],
      education: [{ institution: "IIM Ahmedabad", degree: "MBA", fieldOfStudy: "Finance", startYear: 2016, endYear: 2018 }],
      linkedinUrl: "https://www.linkedin.com/in/me",
      websiteUrl: "https://me.dev/",
      githubUrl: "https://github.com/me",
      instagramUrl: "https://instagram.com/me",
      xUrl: "https://x.com/me",
      openTo: ["HIRING"],
      bio: "Hello",
      interests: ["chess"],
      city: "Pune",
      country: "IN",
      dateOfBirth: "1990-04-02",
    };
    expect((await patch(university.slug, { ...atUniversity, ...personal })).status).toBe(200);

    const res = await copy(me.headers, joining.slug);
    expect(res.status).toBe(200);
    const offered = res.body.data;
    expect(Object.keys(offered).sort()).toEqual(PORTABLE_KEYS);
    // Their years are their own at each institution.
    for (const key of ["startYear", "batchYear"]) expect(offered).not.toHaveProperty(key);
    const { degree: _degree, fieldOfStudy: _field, education, ...rest } = atUniversity;
    // Their birthday is kept off the university's feed, so their date of birth stays there: a new profile would show it.
    expect(offered).toMatchObject({ ...rest, dateOfBirth: null, source: { slug: "demo-university", name: "Demo University" } });
    // Their degree and field there become studies elsewhere, named after it, after the dated entries.
    expect(offered.education).toEqual([
      { ...education[0] },
      { institution: "Demo University", degree: "M.Tech", fieldOfStudy: "Computer Science", startYear: null, endYear: null },
    ]);
    expect((await patch(university.slug, { celebrateBirthday: true })).status).toBe(200);
    expect((await copy(me.headers, joining.slug)).body.data).toMatchObject({ source: { slug: "demo-university" }, dateOfBirth: "1990-04-02" });

    // Leaving out the newest one gives the next.
    const fromCollege = await copy(me.headers, university.slug);
    expect(fromCollege.body.data).toMatchObject({ source: { slug: "demo-college" }, headline: "Old headline", city: "Delhi", skills: [], education: [] });

    // Whichever was updated last wins.
    expect((await patch(college.slug, { headline: "Newer headline" })).status).toBe(200);
    expect((await copy(me.headers, joining.slug)).body.data).toMatchObject({ source: { slug: "demo-college" }, headline: "Newer headline" });
  });

  it("offers only a profile they have: never an application turned down or waiting, a suspension, or a closed institution", async () => {
    const { tenant: school } = await createTenant(ctx, { slug: "demo-school", name: "Demo School" });
    const { tenant: college } = await createTenant(ctx, { slug: "demo-college", name: "Demo College" });
    const { tenant: closed } = await createTenant(ctx, { slug: "closed-institute", name: "Closed Institute" });
    const { tenant: joining } = await createTenant(ctx, { slug: "joining" });
    const me = await memberSession(ctx, school.id);
    expect((await api().patch(`/api/v1/t/${school.slug}/memberships/me`).set(me.headers).send({ headline: "Approved at the school" })).status).toBe(200);
    const elsewhere = await createMembership(ctx, college.id, me.user.id, { status: "REJECTED" });
    const atClosed = await createMembership(ctx, closed.id, me.user.id);
    const later = new Date(Date.now() + 60_000);
    await ctx.db.update(memberships).set({ headline: "Not approved here", updatedAt: later }).where(eq(memberships.id, elsewhere.id));
    await ctx.db.update(memberships).set({ headline: "At a closed institution", updatedAt: later }).where(eq(memberships.id, atClosed.id));
    await ctx.db.update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, closed.id));

    // Newer than the school's, and still passed over.
    for (const status of ["REJECTED", "PENDING", "SUSPENDED"] as const) {
      await ctx.db.update(memberships).set({ status }).where(eq(memberships.id, elsewhere.id));
      expect((await copy(me.headers, joining.slug)).body.data, status).toMatchObject({ source: { slug: "demo-school" }, headline: "Approved at the school" });
    }
    await ctx.db.update(tenants).set({ status: "ARCHIVED" }).where(eq(tenants.id, closed.id));
    expect((await copy(me.headers, joining.slug)).body.data).toMatchObject({ source: { slug: "demo-school" } });

    // Once approved at the college, its newer profile is the one offered; with nothing approved, nothing is.
    await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, elsewhere.id));
    expect((await copy(me.headers, joining.slug)).body.data).toMatchObject({ source: { slug: "demo-college" }, headline: "Not approved here" });
    await ctx.db.update(memberships).set({ status: "REJECTED" }).where(eq(memberships.userId, me.user.id));
    expect((await copy(me.headers, joining.slug)).body.data).toBeNull();
  });

  it("never offers anyone else's details", async () => {
    const { tenant } = await createTenant(ctx, { name: "Shared Institute" });
    const { tenant: joining } = await createTenant(ctx);
    const me = await memberSession(ctx, tenant.id);
    await api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(me.headers).send({ headline: "Mine" });
    // Someone else at the same institution saves later.
    const other = await memberSession(ctx, tenant.id);
    await api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(other.headers).send({ headline: "Theirs" });

    expect((await copy(me.headers, joining.slug)).body.data).toMatchObject({ headline: "Mine" });
    expect((await copy(other.headers, joining.slug)).body.data).toMatchObject({ headline: "Theirs" });
  });

  it("answers null when there's nothing elsewhere, and needs a signed-in caller", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    const onlyHere = await copy(member.headers, tenant.slug);
    expect(onlyHere.status).toBe(200);
    expect(onlyHere.body.data).toBeNull();
    // Without `exclude`, their one membership is the source.
    expect((await copy(member.headers)).body.data).toMatchObject({ source: { slug: tenant.slug } });

    const newcomer = auth((await loginAs(ctx, (await createUser(ctx)).phoneE164)).accessToken);
    expect((await copy(newcomer)).body.data).toBeNull();

    expect((await api().get("/api/v1/me/profile-copy")).status).toBe(401);
    expect((await copy(member.headers, "Not A Slug")).status).toBe(400);
  });

  it("doesn't repeat an institution they already list, and keeps within the limit on studies", async () => {
    const { tenant: university } = await createTenant(ctx, { name: "Demo University" });
    const { tenant: joining } = await createTenant(ctx);
    const me = await memberSession(ctx, university.id);
    const patch = (body: object) => api().patch(`/api/v1/t/${university.slug}/memberships/me`).set(me.headers).send(body);

    await patch({ degree: "B.Tech", education: [{ institution: "demo university ", degree: "B.Tech", startYear: 2008, endYear: 2012 }] });
    expect((await copy(me.headers, joining.slug)).body.data.education).toEqual([{ institution: "demo university", degree: "B.Tech", fieldOfStudy: null, startYear: 2008, endYear: 2012 }]);

    const ten = Array.from({ length: 10 }, (_, i) => ({ institution: `Course ${i}`, startYear: 2000 + i, endYear: 2001 + i }));
    expect((await patch({ education: ten })).status).toBe(200);
    const capped = (await copy(me.headers, joining.slug)).body.data.education as Array<{ institution: string }>;
    expect(capped).toHaveLength(10);
    expect(capped.map((e) => e.institution)).not.toContain("Demo University");
    // So it can be saved as it is.
    expect((await api().patch(`/api/v1/t/${university.slug}/memberships/me`).set(me.headers).send({ education: capped })).status).toBe(200);
  });

  it("leaves out a link stored under an older, looser rule, which the new institution would refuse", async () => {
    const { tenant } = await createTenant(ctx);
    const { tenant: joining } = await createTenant(ctx);
    const me = await memberSession(ctx, tenant.id);
    // The old LinkedIn check took any text with "linkedin.com/" in it.
    await ctx.db
      .update(memberships)
      .set({ linkedinUrl: "https://evil.com/?linkedin.com/", websiteUrl: "https://user:pw@me.dev/", githubUrl: "https://GitHub.com/Me" })
      .where(eq(memberships.id, me.membership.id));
    const offered = (await copy(me.headers, joining.slug)).body.data;
    // A link that passes is offered as it would be saved now.
    expect(offered).toMatchObject({ linkedinUrl: null, websiteUrl: null, githubUrl: "https://github.com/Me" });
    const { source: _source, ...details } = offered;
    expect((await api().post(`/api/v1/t/${joining.slug}/memberships`).set(me.headers).send({ ...PROFILE, ...details })).status).toBe(201);
  });
});
