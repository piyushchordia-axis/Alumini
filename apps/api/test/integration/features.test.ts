import { changedFeatures, defaultFeaturesFor, SCHOOL_OFF_FEATURES, TENANT_FEATURES, type TenantFeature, type TenantFeatures } from "@illuminize/shared";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, tenantSettings } from "../../src/db/schema";
import { seedCore, SEED } from "../../src/db/seed";
import { runInTransaction } from "../../src/lib/transaction";
import { auth, createTenant, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

const allOn = (): TenantFeatures => defaultFeaturesFor("COLLEGE");
const school = (): TenantFeatures => defaultFeaturesFor("SCHOOL");

describe.skipIf(!dbAvailable)("tenant features", () => {
  let ctx: TestContext;
  let platform: Record<string, string>;
  // Borrows a key that isn't in the table, so these keep proving the rules whichever keys later slices add.
  const schoolOff = SCHOOL_OFF_FEATURES as TenantFeature[];

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    platform = auth((await loginAs(ctx, "+919999999999")).accessToken);
    schoolOff.push("funding");
  });
  afterEach(() => {
    schoolOff.pop();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const api = () => request(ctx.app);
  const storedFeatures = async (tenantId: string) => (await ctx.db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)))[0]!.features;

  describe("a new tenant", () => {
    const create = (slug: string, body: object) => api().post("/api/v1/platform/tenants").set(platform).send({ slug, name: `Tenant ${slug}`, ...body });

    it("stores its type's complete defaults", async () => {
      const college = await create("new-college", { type: "COLLEGE" });
      expect(college.body.data.settings.features).toEqual(allOn());
      expect(await storedFeatures(college.body.data.tenant.id)).toEqual(allOn());

      const created = await create("new-school", { type: "SCHOOL" });
      expect(created.status).toBe(201);
      expect(created.body.data.settings.features.funding).toBe(false);
      expect(created.body.data.settings.features).toEqual(school());
      expect(await storedFeatures(created.body.data.tenant.id)).toEqual(school());
    });

    it("applies the features it was created with on top of the defaults, including when other settings come along", async () => {
      const on = await create("school-on", { type: "SCHOOL", settings: { features: { funding: true, jobs: false } } });
      expect(on.body.data.settings.features).toEqual({ ...school(), funding: true, jobs: false });
      const other = await create("school-other", { type: "SCHOOL", settings: { allowSelfRegistration: false } });
      expect(other.body.data.settings).toMatchObject({ allowSelfRegistration: false, features: school() });
    });

    it("has no database default to fall back on", async () => {
      const { tenant } = await createTenant(ctx);
      await ctx.db.delete(tenantSettings).where(eq(tenantSettings.tenantId, tenant.id));
      await expect(ctx.db.execute(sql`insert into tenant_settings (tenant_id) values (${tenant.id})`)).rejects.toThrow();
    });
  });

  describe("reseeding", () => {
    it("seeds each type's defaults and never overrides an admin's choice", async () => {
      const { tenantIds } = await seedCore(ctx.db, ["+919999999999"]);
      const schoolId = tenantIds[SEED.tenants.find((t) => t.type === "SCHOOL")!.slug]!;
      const collegeId = tenantIds[SEED.tenants.find((t) => t.type === "COLLEGE")!.slug]!;
      expect(await storedFeatures(schoolId)).toEqual(school());
      expect(await storedFeatures(collegeId)).toEqual(allOn());

      const chosen = { ...school(), funding: true, jobs: false };
      await ctx.db.update(tenantSettings).set({ features: chosen }).where(eq(tenantSettings.tenantId, schoolId));
      await seedCore(ctx.db, ["+919999999999"]);
      expect(await storedFeatures(schoolId)).toEqual(chosen);
    });
  });

  describe("a partial PATCH", () => {
    it("from a tenant admin changes only the named keys", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { feed: true } });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const res = await api().patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ features: { jobs: false } });
      expect(res.status).toBe(200);
      expect(res.body.data.features).toEqual({ ...school(), jobs: false });
      expect(await storedFeatures(tenant.id)).toEqual({ ...school(), jobs: false });
    });

    it("from platform staff changes only the named keys", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { feed: true } });
      const res = await api().patch(`/api/v1/platform/tenants/${tenant.id}/settings`).set(platform).send({ features: { jobs: false } });
      expect(res.status).toBe(200);
      expect(res.body.data.features).toEqual({ ...school(), jobs: false });
      expect(await storedFeatures(tenant.id)).toEqual({ ...school(), jobs: false });
    });

    it("lets a school's admin turn on a key that starts off", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const member = await memberSession(ctx, tenant.id);
      expect((await api().get(`/api/v1/t/${tenant.slug}/funding`).set(member.headers)).status).toBe(403);
      await api().patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ features: { funding: true } }).expect(200);
      expect((await api().get(`/api/v1/t/${tenant.slug}/funding`).set(member.headers)).status).toBe(200);
    });

    it("that names no features leaves the stored row alone", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { feed: true } });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      await api().patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ allowSelfRegistration: false }).expect(200);
      expect(await storedFeatures(tenant.id)).toEqual({ feed: true });
    });
  });

  describe("the messaging key", () => {
    it("reads off at a school whose row was stripped to {feed: true}, and on anywhere else", async () => {
      const stripped = { feed: true };
      const { tenant: school } = await createTenant(ctx, { type: "SCHOOL", features: stripped });
      const { tenant: college } = await createTenant(ctx, { type: "COLLEGE", features: stripped });
      const atSchool = await memberSession(ctx, school.id);
      const atCollege = await memberSession(ctx, college.id);
      const refused = await api().get(`/api/v1/t/${school.slug}/chat/conversations`).set(atSchool.headers);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("FEATURE_DISABLED");
      expect((await api().get(`/api/v1/t/${college.slug}/chat/conversations`).set(atCollege.headers)).status).toBe(200);
      expect((await api().get(`/api/v1/tenants/${school.slug}`)).body.data.settings.features.messaging).toBe(false);
      expect((await api().get(`/api/v1/tenants/${college.slug}`)).body.data.settings.features.messaging).toBe(true);
    });

    it("refuses a school's existing threads once off, and comes straight back when on again", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true } });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const a = await memberSession(ctx, tenant.id);
      const b = await memberSession(ctx, tenant.id);
      const base = `/api/v1/t/${tenant.slug}/chat`;
      const opened = await api().post(`${base}/direct`).set(a.headers).send({ membershipId: b.membership.id, body: "Hello", clientKey: "existing-thread-1" });
      expect(opened.status).toBe(201);
      const thread = `${base}/conversations/${opened.body.data.conversation.id}`;
      const toggle = (messaging: boolean) => api().patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ features: { messaging } }).expect(200);

      await toggle(false);
      for (const res of [await api().get(thread).set(b.headers), await api().get(`${thread}/messages`).set(b.headers), await api().post(`${thread}/accept`).set(b.headers)]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FEATURE_DISABLED");
      }
      await toggle(true);
      expect((await api().get(thread).set(b.headers)).status).toBe(200);
    });
  });

  describe("a row stripped to {feed: true}", () => {
    async function strippedSchool() {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL" });
      await ctx.db.execute(sql`update tenant_settings set features = '{"feed":true}'::jsonb where tenant_id = ${tenant.id}`);
      return tenant;
    }

    it("gates routes through requireFeature by the type's default, on the cold and the cached read", async () => {
      const tenant = await strippedSchool();
      const member = await memberSession(ctx, tenant.id);
      const base = `/api/v1/t/${tenant.slug}`;
      for (let i = 0; i < 2; i++) {
        const blocked = await api().get(`${base}/funding`).set(member.headers);
        expect(blocked.status).toBe(403);
        expect(blocked.body.error.code).toBe("FEATURE_DISABLED");
        expect((await api().get(`${base}/jobs`).set(member.headers)).status).toBe(200);
        expect((await api().get(`${base}/posts`).set(member.headers)).status).toBe(200);
      }
    });

    it("honours what it does store", async () => {
      const { tenant } = await createTenant(ctx, { features: { feed: false } });
      const member = await memberSession(ctx, tenant.id);
      const base = `/api/v1/t/${tenant.slug}`;
      expect((await api().get(`${base}/posts`).set(member.headers)).status).toBe(403);
      expect((await api().get(`${base}/funding`).set(member.headers)).status).toBe(200);
    });

    it("returns a complete map from every DTO", async () => {
      const tenant = await strippedSchool();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const complete = (f: Record<string, unknown>) => {
        expect(Object.keys(f).sort()).toEqual([...TENANT_FEATURES].sort());
        expect(f).toEqual(school());
      };

      complete((await api().get(`/api/v1/tenants/${tenant.slug}`)).body.data.settings.features);
      const settings = await api().get(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers);
      complete(settings.body.data.settings.features);
      complete(settings.body.data.branding.settings.features);
      const staff = await api().get(`/api/v1/platform/tenants/${tenant.id}`).set(platform);
      complete(staff.body.data.settings.features);
      complete(staff.body.data.tenant.settings.features);

      const branding = await api().patch(`/api/v1/t/${tenant.slug}/admin/branding`).set(admin.headers).send({ tagline: "Hello" });
      complete(branding.body.data.settings.features);
      const save = await api().patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ allowSelfRegistration: false });
      complete(save.body.data.features);
      const staffSave = await api().patch(`/api/v1/platform/tenants/${tenant.id}/settings`).set(platform).send({ allowSelfRegistration: true });
      complete(staffSave.body.data.features);
    });
  });

  describe("saves that send changed keys only", () => {
    it("don't undo a change another admin made from a tab that is now stale", async () => {
      const { tenant } = await createTenant(ctx);
      const first = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const second = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const url = `/api/v1/t/${tenant.slug}/admin/settings`;

      // Both admins open the form while everything is on.
      const staleTab: TenantFeatures = (await api().get(url).set(second.headers)).body.data.settings.features;
      await api().patch(url).set(first.headers).send({ features: { jobs: false } }).expect(200);

      const change = changedFeatures(staleTab, { ...staleTab, funding: false });
      expect(change).toEqual({ funding: false });
      const res = await api().patch(url).set(second.headers).send({ features: change });
      expect(res.body.data.features).toEqual({ ...allOn(), jobs: false, funding: false });

      // The same stale tab saving with nothing toggled sends no features and changes none.
      const untouched = await api().patch(url).set(second.headers).send({ allowSelfRegistration: false });
      expect(untouched.body.data.features).toEqual({ ...allOn(), jobs: false, funding: false });
    });
  });

  describe("overlapping writes", () => {
    /**
     * Starts `send` while another transaction holds the settings row and has `features` written but not committed, then
     * commits once `send` is waiting on that lock (or has finished). Code that reads the row outside the lock sees the
     * old features here, every time, rather than only when the timing is unlucky.
     */
    async function whileAnotherWriteIsInFlight(tenantId: string, features: Partial<TenantFeatures>, send: () => PromiseLike<request.Response>) {
      let response!: Promise<request.Response>;
      await runInTransaction(ctx, async (tx) => {
        await tx.update(tenantSettings).set({ features }).where(eq(tenantSettings.tenantId, tenantId));
        let finished = false;
        response = Promise.resolve(send()).finally(() => {
          finished = true;
        });
        const deadline = Date.now() + 10_000;
        while (!finished) {
          if (Date.now() > deadline) throw new Error("The request neither finished nor reached the settings row");
          // Not through tx: inside a transaction pg_stat_activity keeps showing the backends and queries of its first read.
          const waiting = await ctx.db.execute(sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%tenant_settings%'`);
          if (waiting.rows.length > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      });
      return response;
    }

    it("keep a tenant admin's save from undoing a change that committed while it was running", async () => {
      const { tenant } = await createTenant(ctx);
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const res = await whileAnotherWriteIsInFlight(tenant.id, { ...allOn(), jobs: false }, () => api().patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ features: { funding: false } }));
      expect(res.status).toBe(200);
      expect(res.body.data.features).toEqual({ ...allOn(), jobs: false, funding: false });
      expect(await storedFeatures(tenant.id)).toEqual({ ...allOn(), jobs: false, funding: false });
    });

    it("keep a staff save from undoing a change that committed while it was running", async () => {
      const { tenant } = await createTenant(ctx);
      const res = await whileAnotherWriteIsInFlight(tenant.id, { ...allOn(), jobs: false }, () => api().patch(`/api/v1/platform/tenants/${tenant.id}/settings`).set(platform).send({ features: { funding: false } }));
      expect(res.status).toBe(200);
      expect(await storedFeatures(tenant.id)).toEqual({ ...allOn(), jobs: false, funding: false });
    });

    it("force a school-off key off when a save turning it on commits while the retype is running", async () => {
      const { tenant } = await createTenant(ctx, { features: { ...allOn(), funding: false } });
      const res = await whileAnotherWriteIsInFlight(tenant.id, allOn(), () => api().patch(`/api/v1/platform/tenants/${tenant.id}`).set(platform).send({ type: "SCHOOL" }));
      expect(res.status).toBe(200);
      expect((await storedFeatures(tenant.id)).funding).toBe(false);
      const [audit] = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenant.id), eq(auditLog.action, "platform.tenant.update")));
      expect(audit?.metadata).toMatchObject({ forcedOff: expect.arrayContaining(["funding"]) });
    });
  });

  describe("retyping a tenant", () => {
    const retype = (tenantId: string, type: string) => api().patch(`/api/v1/platform/tenants/${tenantId}`).set(platform).send({ type });
    const audits = (tenantId: string) => ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, "platform.tenant.update")));

    it("stands when its audit row can't be written, rather than reporting success for an update that rolled back", async () => {
      const { tenant } = await createTenant(ctx);
      await ctx.db.execute(sql`alter table audit_log add constraint test_refuse_tenant_update check (action <> 'platform.tenant.update') not valid`);
      try {
        const res = await api().patch(`/api/v1/platform/tenants/${tenant.id}`).set(platform).send({ type: "SCHOOL", status: "SUSPENDED" });
        expect(res.status).toBe(200);
        expect(res.body.data.tenant).toMatchObject({ type: "SCHOOL", status: "SUSPENDED" });
        expect((await storedFeatures(tenant.id)).funding).toBe(false);
        expect(await audits(tenant.id)).toEqual([]);
      } finally {
        await ctx.db.execute(sql`alter table audit_log drop constraint test_refuse_tenant_update`);
      }
    });

    it("to SCHOOL forces the school-off keys off, audits it and takes effect at once", async () => {
      const { tenant } = await createTenant(ctx, { features: { ...allOn(), jobs: false } });
      const member = await memberSession(ctx, tenant.id);
      // Primes the tenant cache with funding on.
      expect((await api().get(`/api/v1/t/${tenant.slug}/funding`).set(member.headers)).status).toBe(200);

      const res = await retype(tenant.id, "SCHOOL");
      expect(res.status).toBe(200);
      expect(res.body.data.tenant.type).toBe("SCHOOL");
      expect(res.body.data.settings.features).toEqual({ ...school(), jobs: false });
      expect(await storedFeatures(tenant.id)).toEqual({ ...school(), jobs: false });
      expect((await api().get(`/api/v1/t/${tenant.slug}/funding`).set(member.headers)).status).toBe(403);

      const [audit] = await audits(tenant.id);
      expect(audit?.metadata).toMatchObject({ fields: ["type"], forcedOff: [...SCHOOL_OFF_FEATURES] });
    });

    it("to SCHOOL records an empty list when nothing was on", async () => {
      const { tenant } = await createTenant(ctx, { features: school() });
      await retype(tenant.id, "SCHOOL").expect(200);
      expect((await audits(tenant.id))[0]?.metadata).toMatchObject({ forcedOff: [] });
    });

    it("away from SCHOOL leaves stored values alone", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL" });
      const res = await retype(tenant.id, "COLLEGE");
      expect(res.body.data.settings.features).toEqual(school());
      expect(await storedFeatures(tenant.id)).toEqual(school());
      expect((await audits(tenant.id))[0]?.metadata).not.toHaveProperty("forcedOff");
    });

    it("to the same type, or changing anything else, forces nothing", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { ...school(), funding: true } });
      await retype(tenant.id, "SCHOOL").expect(200);
      await api().patch(`/api/v1/platform/tenants/${tenant.id}`).set(platform).send({ tagline: "Hi" }).expect(200);
      expect((await storedFeatures(tenant.id)).funding).toBe(true);
      for (const row of await audits(tenant.id)) expect(row.metadata).not.toHaveProperty("forcedOff");
    });
  });
});
