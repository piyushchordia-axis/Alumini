import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, memberships, tenantSettings } from "../../src/db/schema";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { chatApi } from "../helpers/chat";
import { auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { mentorshipApi, offerToMentor } from "../helpers/mentorship";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("member directory", () => {
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

  it("searches, filters, paginates and exposes facets", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}/directory`;
    const viewer = await memberSession(ctx, tenant.id, { fullName: "Zed Viewer", batchYear: 2001, city: "Delhi" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Anita Rao", batchYear: 2010, city: "Mumbai", country: "IN", companyName: "Infosys", professionType: "EMPLOYED" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Bala Iyer", batchYear: 2010, city: "London", country: "GB", companyName: "Google", professionType: "EMPLOYED" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Chitra Das", batchYear: 2015, city: "Mumbai", country: "IN", companyName: "Self", professionType: "FOUNDER" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Pending Person", batchYear: 2015, status: "PENDING" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Suspended Person", batchYear: 2015, status: "SUSPENDED" });

    const all = await api().get(base).set(viewer.headers);
    expect(all.body.data.map((m: { fullName: string }) => m.fullName)).toEqual(["Anita Rao", "Bala Iyer", "Chitra Das", "Zed Viewer"]);
    expect((await api().get(`${base}?batchYear=2010`).set(viewer.headers)).body.data).toHaveLength(2);
    expect((await api().get(`${base}?city=mumbai`).set(viewer.headers)).body.data).toHaveLength(2);
    expect((await api().get(`${base}?country=gb`).set(viewer.headers)).body.data.map((m: { fullName: string }) => m.fullName)).toEqual(["Bala Iyer"]);
    expect((await api().get(`${base}?professionType=FOUNDER`).set(viewer.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?company=goog`).set(viewer.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?q=rao`).set(viewer.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?q=infosys`).set(viewer.headers)).body.data).toHaveLength(1);

    const p1 = await api().get(`${base}?limit=2`).set(viewer.headers);
    expect(p1.body.data).toHaveLength(2);
    const p2 = await api().get(`${base}?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`).set(viewer.headers);
    expect(p2.body.data.map((m: { fullName: string }) => m.fullName)).toEqual(["Chitra Das", "Zed Viewer"]);
    expect(p2.body.nextCursor).toBeNull();

    const facets = await api().get(`${base}/filters`).set(viewer.headers);
    expect(facets.body.data).toMatchObject({ batchYears: [2015, 2010, 2001], countries: ["GB", "IN"] });
    expect(facets.body.data.cities).toEqual(expect.arrayContaining(["Mumbai", "London", "Delhi"]));
  });

  it("finds members by their profile details: q in headlines and skills, and filters and facets for industry, skill, field of study and Open to", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}/directory`;
    const viewer = await memberSession(ctx, tenant.id, { fullName: "Zed Viewer" });
    const member = async (fullName: string, details: Partial<typeof memberships.$inferInsert>, status: "APPROVED" | "PENDING" = "APPROVED") => {
      const m = await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName, status });
      await ctx.db.update(memberships).set(details).where(eq(memberships.id, m.id));
    };
    await member("Asha Rao", { headline: "Builds payments at Zylo", industry: "BANKING_FINANCE", skills: ["Go", "PostgreSQL", "Kubernetes"], fieldOfStudy: "Computer Science", openTo: ["HIRING"] });
    await member("Bala Iyer", { headline: "Data scientist", industry: "SOFTWARE_INTERNET", skills: ["go", "Python"], fieldOfStudy: "computer science" });
    await member("Chitra Das", { industry: "SOFTWARE_INTERNET", skills: ["Go", "Design_systems 100%"], fieldOfStudy: "Mechanical Engineering", openTo: ["COLLABORATING", "INVESTING"] });
    await member("Pending Person", { headline: "Payments lawyer", industry: "LAW", skills: ["Rust"], fieldOfStudy: "Law", openTo: ["HIRING"] }, "PENDING");
    const names = async (query: string) => {
      const res = await api().get(`${base}?${query}`).set(viewer.headers);
      expect(res.status, query).toBe(200);
      return (res.body.data as Array<{ fullName: string }>).map((m) => m.fullName);
    };

    // q: part of a headline or a skill, regardless of case, as well as of a name, company or role. Wildcards are text.
    expect(await names("q=payments")).toEqual(["Asha Rao"]);
    expect(await names("q=KUBER")).toEqual(["Asha Rao"]);
    expect(await names("q=python")).toEqual(["Bala Iyer"]);
    expect(await names(`q=${encodeURIComponent("%")}`)).toEqual(["Chitra Das"]);
    // skill: one whole skill, regardless of case and spacing.
    expect(await names("skill=GO")).toEqual(["Asha Rao", "Bala Iyer", "Chitra Das"]);
    expect(await names(`skill=${encodeURIComponent("  postgresql ")}`)).toEqual(["Asha Rao"]);
    expect(await names("skill=Post")).toEqual([]);
    expect(await names("skill=Rust")).toEqual([]); // only a pending member lists it
    expect(await names("industry=SOFTWARE_INTERNET")).toEqual(["Bala Iyer", "Chitra Das"]);
    expect(await names("industry=SOFTWARE_INTERNET&skill=python")).toEqual(["Bala Iyer"]);
    // fieldOfStudy: the whole field, regardless of case, as city is.
    expect(await names(`fieldOfStudy=${encodeURIComponent("COMPUTER SCIENCE")}`)).toEqual(["Asha Rao", "Bala Iyer"]);
    expect(await names("fieldOfStudy=computer")).toEqual([]);
    expect(await names("openTo=HIRING")).toEqual(["Asha Rao"]);
    expect(await names("openTo=INVESTING")).toEqual(["Chitra Das"]);
    for (const bad of ["industry=FARMING", "openTo=WORK", `skill=${"x".repeat(41)}`]) expect((await api().get(`${base}?${bad}`).set(viewer.headers)).status, bad).toBe(400);

    // Many skills: the filters offer the 50 most listed.
    await member("Many Skills", { skills: Array.from({ length: 60 }, (_, i) => `Skill ${String(i).padStart(2, "0")}`) });
    const facets = (await api().get(`${base}/filters`).set(viewer.headers)).body.data;
    // In INDUSTRIES order, and only approved members': nobody approved is in law.
    expect(facets.industries).toEqual(["SOFTWARE_INTERNET", "BANKING_FINANCE"]);
    // "Go" and "go" are one skill, listed by three members and spelled as most of them spell it; then the rest by name.
    expect(facets.skills).toHaveLength(50);
    expect(facets.skills.slice(0, 6)).toEqual(["Go", "Design_systems 100%", "Kubernetes", "PostgreSQL", "Python", "Skill 00"]);
    expect(facets.skills).not.toContain("Rust");
    expect(facets.fieldsOfStudy.map((f: string) => f.toLowerCase())).toEqual(["computer science", "mechanical engineering"]);
  });

  it("shows profiles with phone only when the member opted in", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const viewer = await memberSession(ctx, tenant.id);
    const target = await memberSession(ctx, tenant.id, { fullName: "Target T" });
    const hidden = await api().get(`${base}/directory/${target.membership.id}`).set(viewer.headers);
    expect(hidden.body.data).toMatchObject({ fullName: "Target T", phone: null, isOpenToWork: false });
    await api().patch(`${base}/memberships/me`).set(target.headers).send({ isPhoneVisible: true, bio: "Hi", linkedinUrl: "https://linkedin.com/in/t" });
    const shown = await api().get(`${base}/directory/${target.membership.id}`).set(viewer.headers);
    expect(shown.body.data).toMatchObject({ phone: target.user.phoneE164, bio: "Hi", linkedinUrl: "https://linkedin.com/in/t" });
    expect(shown.body.data).not.toHaveProperty("dateOfBirth");
    const pending = await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { status: "PENDING" });
    expect((await api().get(`${base}/directory/${pending.id}`).set(viewer.headers)).status).toBe(404);
  });

  it("shows the profile details: the headline and Open to on cards, everything on the profile", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const viewer = await memberSession(ctx, tenant.id, { fullName: "Viewer V" });
    const target = await memberSession(ctx, tenant.id, { fullName: "Asha Rao" });
    const details = {
      headline: "Builds payments at Zylo",
      industry: "BANKING_FINANCE",
      careerStartYear: 2014,
      skills: ["Go", "SQL"],
      degree: "B.Tech",
      fieldOfStudy: "Computer Science",
      linkedinUrl: "https://www.linkedin.com/in/asha",
      websiteUrl: "https://asha.dev/",
      githubUrl: "https://github.com/asha",
      instagramUrl: "https://www.instagram.com/asha",
      xUrl: "https://x.com/asha",
      openTo: ["HIRING"],
      experiences: [{ company: "Acme", title: "Intern", startYear: 2013, endYear: 2014 }],
      education: [{ institution: "IIM Ahmedabad", degree: "MBA", fieldOfStudy: null, startYear: 2016, endYear: 2018 }],
    };
    expect((await api().patch(`${base}/memberships/me`).set(target.headers).send({ ...details, maritalStatus: "MARRIED", kidsCount: 2 })).status).toBe(200);

    const card = ((await api().get(`${base}/directory`).set(viewer.headers)).body.data as Array<{ id: string }>).find((m) => m.id === target.membership.id);
    expect(card).toMatchObject({ headline: details.headline, openTo: ["HIRING"], isMentor: false });
    // Cards stay compact: the rest is the profile's.
    expect(card).not.toHaveProperty("skills");
    expect(card).not.toHaveProperty("linkedinUrl");

    const profile = (await api().get(`${base}/directory/${target.membership.id}`).set(viewer.headers)).body.data;
    expect(profile).toMatchObject({ ...details, isMentor: false });
    for (const key of ["maritalStatus", "kidsCount", "profileNudgeDismissedAt", "dateOfBirth"]) expect(profile, key).not.toHaveProperty(key);
  });

  it("shows nobody but the pupil themself a current pupil's links or Open to", async () => {
    const { tenant } = await createTenant(ctx, { type: "SCHOOL" });
    const base = `/api/v1/t/${tenant.slug}`;
    const alum = await memberSession(ctx, tenant.id, { batchYear: 2000, fullName: "Alum A" });
    const pupil = await memberSession(ctx, tenant.id, { batchYear: new Date().getFullYear() + 2, fullName: "Pupil P" });
    const links = { linkedinUrl: "https://www.linkedin.com/in/pupil", websiteUrl: "https://pupil.dev/", githubUrl: "https://github.com/pupil", instagramUrl: "https://instagram.com/pupil", xUrl: "https://x.com/pupil" };
    expect((await api().patch(`${base}/memberships/me`).set(pupil.headers).send({ ...links, headline: "Chess club captain", skills: ["Chess"] })).status).toBe(200);
    // Saving clears a pupil's Open to; one stored anyway (from before the rule) still doesn't show.
    await ctx.db.update(memberships).set({ openTo: ["HIRING"] }).where(eq(memberships.id, pupil.membership.id));

    const seen = (await api().get(`${base}/directory/${pupil.membership.id}`).set(alum.headers)).body.data;
    expect(seen).toMatchObject({ headline: "Chess club captain", skills: ["Chess"], openTo: [], linkedinUrl: null, websiteUrl: null, githubUrl: null, instagramUrl: null, xUrl: null });
    const card = ((await api().get(`${base}/directory`).set(alum.headers)).body.data as Array<{ id: string; openTo: string[] }>).find((m) => m.id === pupil.membership.id);
    expect(card?.openTo).toEqual([]);

    const own = (await api().get(`${base}/directory/${pupil.membership.id}`).set(pupil.headers)).body.data;
    expect(own).toMatchObject({ ...links, openTo: ["HIRING"] });
    // Nor does the Open-to filter find them by it.
    const openTo = async (value: string) => ((await api().get(`${base}/directory?openTo=${value}`).set(alum.headers)).body.data as Array<{ fullName: string }>).map((m) => m.fullName);
    expect(await openTo("HIRING")).toEqual([]);

    // An alum's are shown.
    await api().patch(`${base}/memberships/me`).set(alum.headers).send({ githubUrl: "https://github.com/alum", openTo: ["INVESTING"] });
    expect((await api().get(`${base}/directory/${alum.membership.id}`).set(pupil.headers)).body.data).toMatchObject({ githubUrl: "https://github.com/alum", openTo: ["INVESTING"] });
    expect(await openTo("INVESTING")).toEqual(["Alum A"]);
  });

  it("leaves out a link stored under an older, looser rule, and shows the rest as they'd be saved now", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const viewer = await memberSession(ctx, tenant.id);
    const target = await memberSession(ctx, tenant.id);
    // The old LinkedIn check took any text with "linkedin.com/" in it.
    await ctx.db
      .update(memberships)
      .set({ linkedinUrl: "https://evil.com/?linkedin.com/", websiteUrl: "https://user:pw@asha.dev/", githubUrl: "https://GitHub.com/Asha", xUrl: "https://x.com\\@evil.com" })
      .where(eq(memberships.id, target.membership.id));
    const profile = (await api().get(`${base}/directory/${target.membership.id}`).set(viewer.headers)).body.data;
    expect(profile).toMatchObject({ linkedinUrl: null, websiteUrl: null, githubUrl: "https://github.com/Asha", xUrl: "https://x.com/@evil.com" });
  });

  it("clears every degree and field of study when an institution becomes a school, and any save there clears them too", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const platform = auth((await loginAs(ctx, "+919999999999")).accessToken);
    const viewer = await memberSession(ctx, tenant.id, { batchYear: 2000 });
    const neha = await memberSession(ctx, tenant.id, { batchYear: 2010 });
    const kiran = await memberSession(ctx, tenant.id, { batchYear: 2011 });
    await api().patch(`${base}/memberships/me`).set(neha.headers).send({ degree: "B.E.", fieldOfStudy: "Computer Engineering", headline: "Architect" }).expect(200);
    await api().patch(`${base}/memberships/me`).set(kiran.headers).send({ fieldOfStudy: "Mechanical Engineering" }).expect(200);
    const filters = async () => (await api().get(`${base}/directory/filters`).set(viewer.headers)).body.data.fieldsOfStudy as string[];
    // Also fills the filters' cache.
    expect((await filters()).sort()).toEqual(["Computer Engineering", "Mechanical Engineering"]);
    const updatedAt = async (id: string) => (await ctx.db.select().from(memberships).where(eq(memberships.id, id)))[0]!.updatedAt;
    const before = await updatedAt(neha.membership.id);

    await api().patch(`/api/v1/platform/tenants/${tenant.id}`).set(platform).send({ type: "SCHOOL" }).expect(200);
    const [audit] = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenant.id), eq(auditLog.action, "platform.tenant.update")));
    expect(audit?.metadata).toMatchObject({ clearedDegrees: 2 });
    expect((await api().get(`${base}/directory/${neha.membership.id}`).set(viewer.headers)).body.data).toMatchObject({ degree: null, fieldOfStudy: null, headline: "Architect" });
    expect((await api().get(`${base}/directory?fieldOfStudy=${encodeURIComponent("Computer Engineering")}`).set(viewer.headers)).body.data).toEqual([]);
    expect(await filters()).toEqual([]);
    // The members changed nothing, so which profile is copied elsewhere doesn't change either.
    expect(await updatedAt(neha.membership.id)).toEqual(before);

    // One written since (by a request that still saw the old type) goes with the member's next save, whatever it sends.
    await ctx.db.update(memberships).set({ degree: "B.E." }).where(eq(memberships.id, neha.membership.id));
    expect((await api().patch(`${base}/memberships/me`).set(neha.headers).send({ city: "Pune" })).body.data).toMatchObject({ degree: null, fieldOfStudy: null, city: "Pune" });
  });

  describe("isMentor", () => {
    const mentorsIn = async (slug: string, viewer: { headers: Record<string, string> }) =>
      ((await api().get(`/api/v1/t/${slug}/directory`).set(viewer.headers)).body.data as Array<{ fullName: string; isMentor: boolean }>).filter((m) => m.isMentor).map((m) => m.fullName);

    it("marks the mentors the Mentors list would show this viewer, on cards and profiles alike", async () => {
      const { tenant } = await createTenant(ctx);
      const viewer = await memberSession(ctx, tenant.id, { fullName: "Viewer V" });
      const mentor = await memberSession(ctx, tenant.id, { fullName: "Active Mentor" });
      const stopped = await memberSession(ctx, tenant.id, { fullName: "Stopped Mentor" });
      const blocked = await memberSession(ctx, tenant.id, { fullName: "Blocked Mentor" });
      const blocker = await memberSession(ctx, tenant.id, { fullName: "Blocking Mentor" });
      await memberSession(ctx, tenant.id, { fullName: "Not A Mentor" });
      for (const s of [mentor, stopped, blocked, blocker]) await offerToMentor(ctx, tenant.slug, s);
      await mentorshipApi(ctx, tenant.slug, stopped).stop();
      await chatApi(ctx, tenant.slug, viewer).block(blocked.membership.id);
      await chatApi(ctx, tenant.slug, blocker).block(viewer.membership.id);

      expect(await mentorsIn(tenant.slug, viewer)).toEqual(["Active Mentor", "Blocking Mentor"]);
      // A profile follows the same rule.
      const profileOf = async (s: { membership: { id: string } }) => (await api().get(`/api/v1/t/${tenant.slug}/directory/${s.membership.id}`).set(viewer.headers)).body.data.isMentor;
      expect(await profileOf(mentor)).toBe(true);
      expect(await profileOf(blocker)).toBe(true);
      expect(await profileOf(blocked)).toBe(false);
      expect(await profileOf(stopped)).toBe(false);
    });

    it("is false for everyone while mentorship is off here, or for a viewer who can't use it", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true, mentorship: true } });
      const alum = await memberSession(ctx, tenant.id, { batchYear: 2000 });
      const pupil = await memberSession(ctx, tenant.id, { batchYear: new Date().getFullYear() + 2 });
      const mentor = await memberSession(ctx, tenant.id, { batchYear: 1999, fullName: "School Mentor" });
      await offerToMentor(ctx, tenant.slug, mentor);
      const profileSays = async (viewer: { headers: Record<string, string> }) => (await api().get(`/api/v1/t/${tenant.slug}/directory/${mentor.membership.id}`).set(viewer.headers)).body.data.isMentor;
      expect(await mentorsIn(tenant.slug, alum)).toEqual(["School Mentor"]);
      expect(await profileSays(alum)).toBe(true);
      expect(await mentorsIn(tenant.slug, pupil)).toEqual([]);
      expect(await profileSays(pupil)).toBe(false);

      await ctx.db.update(tenantSettings).set({ features: { messaging: true, mentorship: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      expect(await mentorsIn(tenant.slug, alum)).toEqual([]);
      expect(await profileSays(alum)).toBe(false);
      await ctx.db.update(tenantSettings).set({ features: { messaging: false, mentorship: true } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      expect(await mentorsIn(tenant.slug, alum)).toEqual([]);
      // Back on, and the profile was kept all along.
      await ctx.db.update(tenantSettings).set({ features: { messaging: true, mentorship: true } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      expect(await mentorsIn(tenant.slug, alum)).toEqual(["School Mentor"]);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, mentor.membership.id));
      expect(await mentorsIn(tenant.slug, alum)).toEqual([]);
    });
  });
});
