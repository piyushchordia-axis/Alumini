import { jobCreateSchema } from "@illuminize/shared";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobs } from "../../src/db/schema";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

const JOB = {
  title: "Backend Engineer",
  companyName: "Acme",
  location: "Mumbai",
  workMode: "REMOTE",
  jobType: "FULL_TIME",
  description: "Build services with Node.js and Postgres.",
  applyUrl: "https://example.com/apply",
};

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** Every field a job takes, each set to something other than its default. */
const FULL = {
  title: "Platform Engineer",
  companyName: "Zylo Labs",
  location: "Mumbai",
  workMode: "HYBRID",
  jobType: "CONTRACT",
  seniority: "SENIOR",
  experienceMin: 4,
  experienceMax: 8,
  skills: ["Node.js", "PostgreSQL", "Kubernetes"],
  educationRequirement: "A computer science degree, or the same experience",
  openings: 2,
  description: "Run the platform every team ships on.\n\n- Kubernetes\n- Postgres",
  responsibilities: "- Keep deploys boring\n- Own the on-call tooling",
  requirements: "- 4+ years running production systems",
  benefits: "- ESOPs\n- Health cover",
  howToApply: "Apply at https://example.com/apply with your CV.",
  applyUrl: "https://example.com/apply",
  contactEmail: "jobs@example.com",
  contactPhone: "+91 98765 43210",
  salaryMinMinor: 1_000_000,
  salaryMaxMinor: 1_500_000,
  salaryCurrency: "USD",
  salaryPeriod: "MONTH",
  salaryNote: "Plus ESOPs",
  companyLogoUrl: "https://example.com/logo.png",
  companyWebsite: "https://example.com/zylo",
  companyIndustry: "SOFTWARE_INTERNET",
  companySize: "SIZE_51_200",
  aboutCompany: "Lending software for small marketplaces.",
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
};

/** What a list's job card carries, and nothing else: no contact details, apply link, sections, company "about", openings or education. */
const CARD_KEYS = [
  "author",
  "canRefer",
  "companyLogoUrl",
  "companyName",
  "createdAt",
  "experienceMax",
  "experienceMin",
  "expiresAt",
  "id",
  "isClosed",
  "isMine",
  "jobType",
  "location",
  "moderatedAt",
  "moderationNote",
  "moderationStatus",
  "salaryCurrency",
  "salaryMaxMinor",
  "salaryMinMinor",
  "salaryNote",
  "salaryPeriod",
  "seniority",
  "skills",
  "summary",
  "title",
  "updatedAt",
  "workMode",
];
const CONTACT_KEYS = ["applyUrl", "contactEmail", "contactPhone", "howToApply"] as const;

const pick = (from: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, from[k]]));
const paths = (res: request.Response) => (res.body.error?.details ?? []).map((d: { path: string }) => d.path);

describe.skipIf(!dbAvailable)("jobs + seekers", () => {
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

  async function setup(opts: Parameters<typeof createTenant>[1] = {}) {
    const { tenant } = await createTenant(ctx, opts);
    const base = `/api/v1/t/${tenant.slug}/jobs`;
    const author = await memberSession(ctx, tenant.id);
    const other = await memberSession(ctx, tenant.id);
    return { tenant, base, author, other };
  }
  const ids = (res: request.Response) => res.body.data.map((j: { id: string }) => j.id).sort();

  it("creates, lists, filters, edits, closes and deletes jobs with author checks", async () => {
    const { base, author, other } = await setup();

    const created = await api().post(base).set(author.headers).send(JOB);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: "Backend Engineer", workMode: "REMOTE", moderationStatus: "APPROVED", isMine: true, author: { id: author.membership.id } });
    const id = created.body.data.id;
    await api().post(base).set(other.headers).send({ ...JOB, title: "Designer", jobType: "CONTRACT", workMode: undefined, location: "Pune" });

    const list = await api().get(base).set(other.headers);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0]).toMatchObject({ isMine: true, workMode: "ON_SITE" });
    expect((await api().get(`${base}?jobType=CONTRACT`).set(author.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?workMode=REMOTE`).set(author.headers)).body.data.map((j: { id: string }) => j.id)).toEqual([id]);
    // The old flag is gone: unknown keys are ignored rather than refused.
    expect((await api().get(`${base}?remote=true`).set(author.headers)).body.data).toHaveLength(2);
    expect((await api().get(`${base}?q=designer`).set(author.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?location=pun`).set(author.headers)).body.data).toHaveLength(1);

    const detail = await api().get(`${base}/${id}`).set(other.headers);
    expect(detail.body.data.author.fullName).toBe(author.membership.fullName);

    expect((await api().patch(`${base}/${id}`).set(other.headers).send({ title: "Hacked" })).status).toBe(403);
    const edited = await api().patch(`${base}/${id}`).set(author.headers).send({ title: "Senior Backend Engineer", expiresAt: inDays(1) });
    expect(edited.body.data).toMatchObject({ title: "Senior Backend Engineer", moderationStatus: "APPROVED", workMode: "REMOTE", location: "Mumbai", applyUrl: "https://example.com/apply" });

    const closed = await api().post(`${base}/${id}/close`).set(author.headers);
    expect(closed.body.data.isClosed).toBe(true);
    expect((await api().get(base).set(other.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?includeClosed=true`).set(other.headers)).body.data).toHaveLength(2);
    expect((await api().get(`${base}?mine=true`).set(author.headers)).body.data).toHaveLength(1);

    expect((await api().delete(`${base}/${id}`).set(other.headers)).status).toBe(403);
    expect((await api().delete(`${base}/${id}`).set(author.headers)).status).toBe(204);
    expect((await api().get(`${base}/${id}`).set(author.headers)).status).toBe(404);
  });

  it("keeps every field of a job through create and edit, and lists it as a card with a summary and no contact details or sections", async () => {
    const { base, author, other } = await setup();
    const keys = Object.keys(FULL);

    const created = await api().post(base).set(author.headers).send(FULL);
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(pick(created.body.data, keys)).toEqual(FULL);
    expect(pick((await api().get(`${base}/${id}`).set(other.headers)).body.data, keys)).toEqual(FULL);

    // An edit of every field, each to something else, round-trips too.
    const changed = {
      ...FULL,
      title: "Staff Platform Engineer",
      companyName: "Zylo",
      location: "Pune",
      workMode: "REMOTE",
      jobType: "FULL_TIME",
      seniority: "LEAD",
      experienceMin: 8,
      experienceMax: 12,
      skills: ["Go"],
      educationRequirement: "Any degree",
      openings: 1,
      description: "Lead the platform team and its roadmap.",
      responsibilities: "- Set the roadmap",
      requirements: "- 8+ years",
      benefits: "- A sabbatical after four years",
      howToApply: "Email us.",
      applyUrl: "https://example.com/apply/staff",
      contactEmail: "staff@example.com",
      contactPhone: "+91 99999 00000",
      salaryMinMinor: 5_000_000,
      salaryMaxMinor: 7_000_000,
      salaryCurrency: "GBP",
      salaryPeriod: "YEAR",
      salaryNote: "Relocation paid",
      companyLogoUrl: "https://example.com/logo2.png",
      companyWebsite: "https://example.com/zylo2",
      companyIndustry: "BANKING_FINANCE",
      companySize: "SIZE_201_1000",
      aboutCompany: "Payments for marketplaces.",
      expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    };
    expect(keys.filter((k) => JSON.stringify(changed[k as keyof typeof changed]) === JSON.stringify(FULL[k as keyof typeof FULL]))).toEqual([]);
    const edited = await api().patch(`${base}/${id}`).set(author.headers).send(changed);
    expect(edited.status).toBe(200);
    expect(pick((await api().get(`${base}/${id}`).set(author.headers)).body.data, keys)).toEqual(changed);

    const [card] = (await api().get(base).set(other.headers)).body.data;
    expect(Object.keys(card).sort()).toEqual(CARD_KEYS);
    expect(card).toMatchObject({ id, summary: "Lead the platform team and its roadmap.", skills: ["Go"], salaryCurrency: "GBP", companyLogoUrl: "https://example.com/logo2.png" });
  });

  it("sums up the role on a card as one plain line of at most 200 characters", async () => {
    const { base, author } = await setup();
    await api().post(base).set(author.headers).send(FULL);
    await api().post(base).set(author.headers).send({ ...JOB, title: "Long one", description: `Intro line.\n\n- ${"word ".repeat(80)}` });
    const [long, full] = (await api().get(base).set(author.headers)).body.data;
    expect(full.summary).toBe("Run the platform every team ships on. Kubernetes · Postgres");
    expect(long.summary.length).toBeLessThanOrEqual(200);
    expect(long.summary).toMatch(/^Intro line\. word word .*…$/);
  });

  it("validates input", async () => {
    const { base, author } = await setup();
    const res = await api().post(base).set(author.headers).send({ ...JOB, jobType: "GIG", description: "short" });
    expect(res.status).toBe(400);
    expect(paths(res)).toEqual(expect.arrayContaining(["jobType", "description"]));

    const refused = async (body: Record<string, unknown>, path: string) => {
      const r = await api().post(base).set(author.headers).send({ ...JOB, ...body });
      expect(r.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(paths(r)).toContain(path);
    };
    await refused({ experienceMin: 6, experienceMax: 3 }, "experienceMax");
    await refused({ experienceMin: 51 }, "experienceMin");
    await refused({ experienceMax: -1 }, "experienceMax");
    await refused({ experienceMin: 2.5 }, "experienceMin");
    await refused({ salaryMinMinor: 500, salaryMaxMinor: 400 }, "salaryMaxMinor");
    await refused({ salaryMinMinor: -1 }, "salaryMinMinor");
    await refused({ openings: 0 }, "openings");
    await refused({ openings: 1001 }, "openings");
    await refused({ salaryCurrency: "XYZ" }, "salaryCurrency");
    await refused({ salaryPeriod: "WEEK" }, "salaryPeriod");
    await refused({ workMode: "SOMETIMES" }, "workMode");
    await refused({ seniority: "INTERN" }, "seniority");
    await refused({ companyLogoUrl: "javascript:alert(1)" }, "companyLogoUrl");
    await refused({ companyWebsite: "ftp://example.com" }, "companyWebsite");
    await refused({ applyUrl: `https://example.com/${"a".repeat(2048)}` }, "applyUrl");
    // A user name or password in a link hides where it goes: this one opens evil.example.
    await refused({ applyUrl: "https://careers.google.com@evil.example/apply" }, "applyUrl");
    await refused({ companyWebsite: "https://user:secret@example.com" }, "companyWebsite");
    await refused({ companyLogoUrl: "https://:secret@example.com/logo.png" }, "companyLogoUrl");
    await refused({ companyIndustry: "SPACE" }, "companyIndustry");
    await refused({ companySize: "HUGE" }, "companySize");
    await refused({ responsibilities: "x".repeat(3001) }, "responsibilities");
    await refused({ howToApply: "x".repeat(3001) }, "howToApply");
    await refused({ aboutCompany: "x".repeat(1501) }, "aboutCompany");
    await refused({ educationRequirement: "x".repeat(121) }, "educationRequirement");
    await refused({ salaryNote: "x".repeat(81) }, "salaryNote");

    // At the limits, and a currency in lower case, are fine.
    const ok = await api()
      .post(base)
      .set(author.headers)
      .send({ ...JOB, experienceMin: 0, experienceMax: 50, salaryMinMinor: 0, salaryMaxMinor: 0, openings: 1000, salaryCurrency: " usd ", responsibilities: "x".repeat(3000), aboutCompany: "x".repeat(1500) });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ experienceMin: 0, experienceMax: 50, salaryMinMinor: 0, salaryMaxMinor: 0, openings: 1000, salaryCurrency: "USD" });
  });

  it("normalises skills and refuses too many or too long, saying which", async () => {
    const { base, author } = await setup();
    const created = await api()
      .post(base)
      .set(author.headers)
      .send({ ...JOB, skills: [" node.js ", "Node.js", "  Machine   learning ", "", "ＮＯＤＥ.JS", "SQL"] });
    expect(created.status).toBe(201);
    expect(created.body.data.skills).toEqual(["node.js", "Machine learning", "SQL"]);

    // Repeats don't count towards the limit; sixteen different skills do.
    const fifteen = Array.from({ length: 15 }, (_, i) => `Skill ${i}`);
    expect((await api().post(base).set(author.headers).send({ ...JOB, skills: [...fifteen, "skill 0"] })).status).toBe(201);
    const many = await api().post(base).set(author.headers).send({ ...JOB, skills: [...fifteen, "Skill 15"] });
    expect(many.status).toBe(400);
    expect(paths(many)).toEqual(["skills"]);
    const long = await api().post(base).set(author.headers).send({ ...JOB, skills: ["Go", "x".repeat(41)] });
    expect(long.status).toBe(400);
    expect(paths(long)).toEqual(["skills.1"]);
  });

  it("checks an edit of one end of a range against the other end as stored", async () => {
    const { base, author } = await setup();
    const id = (await api().post(base).set(author.headers).send({ ...JOB, experienceMin: 3, experienceMax: 6, salaryMinMinor: 1_000_000, salaryMaxMinor: 2_000_000 })).body.data.id;

    // The error is on the field the edit sent.
    const salary = await api().patch(`${base}/${id}`).set(author.headers).send({ salaryMaxMinor: 999_999 });
    expect(salary.status).toBe(400);
    expect(salary.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: [{ path: "salaryMaxMinor", message: "Maximum pay must be at least the minimum" }] });
    const experience = await api().patch(`${base}/${id}`).set(author.headers).send({ experienceMin: 7, title: "Still checked" });
    expect(experience.status).toBe(400);
    expect(experience.body.error.details).toEqual([{ path: "experienceMin", message: "Minimum experience must be at most the maximum" }]);
    // Both ends sent are checked by the schema, on the upper end.
    const both = await api().patch(`${base}/${id}`).set(author.headers).send({ experienceMin: 7, experienceMax: 5 });
    expect(paths(both)).toEqual(["experienceMax"]);
    const job = (await api().get(`${base}/${id}`).set(author.headers)).body.data;
    expect(job.title).toBe(JOB.title);
    expect(job).toMatchObject({ experienceMin: 3, experienceMax: 6, salaryMinMinor: 1_000_000, salaryMaxMinor: 2_000_000 });

    // Moving both ends together, or opening one, is fine.
    expect((await api().patch(`${base}/${id}`).set(author.headers).send({ salaryMinMinor: 100, salaryMaxMinor: 200 })).status).toBe(200);
    expect((await api().patch(`${base}/${id}`).set(author.headers).send({ experienceMax: null })).status).toBe(200);
    expect((await api().patch(`${base}/${id}`).set(author.headers).send({ experienceMin: 20 })).body.data).toMatchObject({ experienceMin: 20, experienceMax: null });
  });

  it("keeps a bad range out of the table whatever writes it", async () => {
    const { tenant, author } = await setup();
    const row = { tenantId: tenant.id, authorMembershipId: author.membership.id, title: "Direct", companyName: "X", jobType: "FULL_TIME" as const, description: "Written straight to the table", moderationStatus: "APPROVED" as const };
    await expect(ctx.db.insert(jobs).values({ ...row, experienceMin: 5, experienceMax: 2 })).rejects.toThrow();
    await expect(ctx.db.insert(jobs).values({ ...row, salaryMinMinor: 5, salaryMaxMinor: 2 })).rejects.toThrow();
    await expect(ctx.db.insert(jobs).values({ ...row, openings: 0 })).rejects.toThrow();
    await expect(ctx.db.insert(jobs).values({ ...row, experienceMin: 51 })).rejects.toThrow();
  });

  it("clears a field sent as null, or the skills sent as []", async () => {
    const { base, author } = await setup();
    const id = (await api().post(base).set(author.headers).send(FULL)).body.data.id;
    const cleared = await api()
      .patch(`${base}/${id}`)
      .set(author.headers)
      .send({
        location: null,
        seniority: null,
        experienceMin: null,
        experienceMax: null,
        skills: [],
        educationRequirement: "",
        openings: null,
        responsibilities: null,
        requirements: null,
        benefits: null,
        howToApply: null,
        applyUrl: null,
        contactEmail: null,
        contactPhone: null,
        salaryMinMinor: null,
        salaryMaxMinor: null,
        salaryNote: null,
        companyLogoUrl: null,
        companyWebsite: null,
        companyIndustry: null,
        companySize: null,
        aboutCompany: null,
        expiresAt: null,
      });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({
      location: null,
      seniority: null,
      experienceMin: null,
      experienceMax: null,
      skills: [],
      educationRequirement: null,
      openings: null,
      responsibilities: null,
      requirements: null,
      benefits: null,
      howToApply: null,
      applyUrl: null,
      contactEmail: null,
      contactPhone: null,
      salaryMinMinor: null,
      salaryMaxMinor: null,
      salaryNote: null,
      companyLogoUrl: null,
      companyWebsite: null,
      companyIndustry: null,
      companySize: null,
      aboutCompany: null,
      expiresAt: null,
      // Required fields, which null can't clear, are kept.
      workMode: "HYBRID",
      salaryCurrency: "USD",
      salaryPeriod: "MONTH",
      description: FULL.description,
    });
    const refused = await api().patch(`${base}/${id}`).set(author.headers).send({ workMode: null, salaryCurrency: null, skills: null });
    expect(refused.status).toBe(400);
    expect(paths(refused).sort()).toEqual(["salaryCurrency", "skills", "workMode"]);
  });

  it("keeps the fields an app's job form doesn't show when it saves an edit", async () => {
    const { base, author } = await setup();
    const id = (await api().post(base).set(author.headers).send(FULL)).body.data.id;
    // What the web and mobile forms send: their own fields, validated with the create schema, as JSON.
    const shown = ["title", "companyName", "location", "workMode", "jobType", "description", "applyUrl", "contactEmail", "contactPhone", "salaryNote", "expiresAt"];
    const sent = JSON.parse(JSON.stringify(jobCreateSchema.parse({ ...pick(FULL, shown), title: "Platform Engineer II", canRefer: undefined }))) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([...shown].sort());

    const saved = await api().patch(`${base}/${id}`).set(author.headers).send(sent);
    expect(saved.status).toBe(200);
    expect(pick(saved.body.data, Object.keys(FULL))).toEqual({ ...FULL, title: "Platform Engineer II" });
  });

  it("filters by work mode, seniority, the years of experience a job fits, and a skill", async () => {
    const { base, author } = await setup();
    const post = async (body: Record<string, unknown>) => (await api().post(base).set(author.headers).send({ ...JOB, workMode: "ON_SITE", ...body })).body.data.id as string;
    const mid = await post({ title: "Mid", experienceMin: 3, experienceMax: 6, seniority: "MID", workMode: "HYBRID" });
    const junior = await post({ title: "Junior", experienceMax: 2, seniority: "ENTRY" });
    const fresher = await post({ title: "Fresher", experienceMin: 0, workMode: "REMOTE" });
    const any = await post({ title: "Any", skills: ["Kubernetes", "PostgreSQL"] });
    const q = async (query: string) => ids(await api().get(`${base}?${query}`).set(author.headers));

    expect(await q("workMode=HYBRID")).toEqual([mid]);
    expect(await q("workMode=REMOTE")).toEqual([fresher]);
    expect(await q("workMode=ON_SITE")).toEqual([junior, any].sort());
    expect(await q("seniority=ENTRY")).toEqual([junior]);
    expect(await q("experience=0")).toEqual([junior, fresher, any].sort());
    expect(await q("experience=2")).toEqual([junior, fresher, any].sort());
    expect(await q("experience=4")).toEqual([mid, fresher, any].sort());
    expect(await q("experience=6")).toEqual([mid, fresher, any].sort());
    expect(await q("experience=7")).toEqual([fresher, any].sort());
    expect(await q("experience=4&workMode=HYBRID&seniority=MID")).toEqual([mid]);
    // A blank box is no filter, not 0 years.
    const all = [mid, junior, fresher, any].sort();
    expect(await q("")).toEqual(all);
    expect(await q("experience=")).toEqual(all);
    expect(await q("experience=%20")).toEqual(all);
    // q matches one skill at a time, in part and in any case.
    expect(await q("q=kubernetes")).toEqual([any]);
    expect(await q("q=postgre")).toEqual([any]);
    expect(await q("q=kubernetes%20postgre")).toEqual([]);

    const bad = await api().get(`${base}?experience=51&workMode=SOMETIMES&seniority=X`).set(author.headers);
    expect(bad.status).toBe(400);
    expect(paths(bad).sort()).toEqual(["experience", "seniority", "workMode"]);
  });

  it("hides a closed or expired job's apply link, contacts and how to apply from everyone but its poster and admins", async () => {
    const { tenant, base, author, other } = await setup();
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const contacts = { applyUrl: FULL.applyUrl, contactEmail: FULL.contactEmail, contactPhone: FULL.contactPhone, howToApply: FULL.howToApply };
    const masked = { applyUrl: null, contactEmail: null, contactPhone: null, howToApply: null };
    const seenBy = async (session: { headers: Record<string, string> }, id: string) => pick((await api().get(`${base}/${id}`).set(session.headers)).body.data, [...CONTACT_KEYS, "description", "benefits"]);
    const adminPreview = async (id: string) => pick((await api().get(`/api/v1/t/${tenant.slug}/admin/moderation/JOB/${id}`).set(admin.headers)).body.data, [...CONTACT_KEYS]);

    const open = (await api().post(base).set(author.headers).send(FULL)).body.data.id;
    expect(await seenBy(other, open)).toEqual({ ...contacts, description: FULL.description, benefits: FULL.benefits });

    await api().post(`${base}/${open}/close`).set(author.headers);
    // The rest of the job still shows.
    expect(await seenBy(other, open)).toEqual({ ...masked, description: FULL.description, benefits: FULL.benefits });
    expect(pick(await seenBy(author, open), [...CONTACT_KEYS])).toEqual(contacts);
    expect(pick(await seenBy(admin, open), [...CONTACT_KEYS])).toEqual(contacts);
    expect(await adminPreview(open)).toEqual(contacts);
    // A list never carries them, closed or not.
    const [card] = (await api().get(`${base}?includeClosed=true`).set(other.headers)).body.data;
    expect(CONTACT_KEYS.filter((k) => k in card)).toEqual([]);

    const expired = (await api().post(base).set(author.headers).send({ ...FULL, expiresAt: new Date(Date.now() - 60_000).toISOString() })).body.data.id;
    expect(pick(await seenBy(other, expired), [...CONTACT_KEYS])).toEqual(masked);
    expect(pick(await seenBy(author, expired), [...CONTACT_KEYS])).toEqual(contacts);
    expect(await adminPreview(expired)).toEqual(contacts);
    // Given a new closing date, it shows them again.
    await api().patch(`${base}/${expired}`).set(author.headers).send({ expiresAt: inDays(7) });
    expect(pick(await seenBy(other, expired), [...CONTACT_KEYS])).toEqual(contacts);
  });

  it("sends a published job back for review when only one of its new fields changes", async () => {
    const { tenant, base, author, other } = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const id = (await api().post(base).set(author.headers).send(FULL)).body.data.id;
    expect((await api().post(`/api/v1/t/${tenant.slug}/admin/moderation/JOB/${id}/approve`).set(admin.headers).send({})).status).toBe(200);
    expect(ids(await api().get(base).set(other.headers))).toEqual([id]);

    const edited = await api().patch(`${base}/${id}`).set(author.headers).send({ benefits: "- ESOPs\n- Health cover\n- Unlimited leave" });
    expect(edited.body.data).toMatchObject({ moderationStatus: "PENDING", benefits: "- ESOPs\n- Health cover\n- Unlimited leave" });
    expect((await api().get(base).set(other.headers)).body.data).toEqual([]);
    const [row] = await ctx.db.select({ status: jobs.moderationStatus }).from(jobs).where(and(eq(jobs.tenantId, tenant.id), eq(jobs.id, id)));
    expect(row!.status).toBe("PENDING");
  });

  it("manages the 'looking for work' flag and reflects it in the directory", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const seeker = await memberSession(ctx, tenant.id, { fullName: "Seeker One" });
    const viewer = await memberSession(ctx, tenant.id);

    expect((await api().get(`${base}/jobs/seekers/me`).set(seeker.headers)).body.data).toBeNull();
    const put = await api().put(`${base}/jobs/seekers/me`).set(seeker.headers).send({ note: "Open to backend roles", preferredLocations: "Remote" });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ note: "Open to backend roles", isActive: true, member: { id: seeker.membership.id, isOpenToWork: true } });

    const list = await api().get(`${base}/jobs/seekers`).set(viewer.headers);
    expect(list.body.data).toHaveLength(1);
    const dir = await api().get(`${base}/directory?q=Seeker`).set(viewer.headers);
    expect(dir.body.data[0]).toMatchObject({ id: seeker.membership.id, isOpenToWork: true });

    await api().put(`${base}/jobs/seekers/me`).set(seeker.headers).send({ note: "Paused", isActive: false });
    expect((await api().get(`${base}/jobs/seekers`).set(viewer.headers)).body.data).toHaveLength(0);
    expect((await api().delete(`${base}/jobs/seekers/me`).set(seeker.headers)).status).toBe(204);
    expect((await api().get(`${base}/jobs/seekers/me`).set(seeker.headers)).body.data).toBeNull();
  });

  it("respects feature flags set by the tenant admin (and busts the tenant cache)", async () => {
    const { tenant } = await createTenant(ctx);
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const member = await memberSession(ctx, tenant.id);
    expect((await api().get(`/api/v1/t/${tenant.slug}/jobs`).set(member.headers)).status).toBe(200);
    const upd = await api().patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ features: { jobs: false } });
    expect(upd.status).toBe(200);
    expect(upd.body.data.features).toMatchObject({ jobs: false, feed: true });
    const blocked = await api().get(`/api/v1/t/${tenant.slug}/jobs`).set(member.headers);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("FEATURE_DISABLED");
    expect((await api().get(`/api/v1/tenants/${tenant.slug}`)).body.data.settings.features.jobs).toBe(false);
  });
});
