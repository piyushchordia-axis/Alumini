import { and, count, eq, ne } from "drizzle-orm";
import { BUSINESS_CATEGORIES, defaultFeaturesFor, MAX_BUSINESS_LISTINGS } from "@illuminize/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Tx } from "../../src/db/client";
import { businessListings, contentReports, fundingListings, invitations } from "../../src/db/schema";
import { seedConnections, seedCore, seedMembers } from "../../src/db/seed";
import { toBusinessCardDto, toBusinessDto } from "../../src/dto/content.dto";
import { runInTransaction } from "../../src/lib/transaction";
import { keys } from "../../src/redis/keys";
import { escapeLike } from "../../src/repositories/content.common";
import { withTrigger as withTestTrigger } from "../helpers/db";
import { auth, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

const listing = (overrides: Record<string, unknown> = {}) => ({ name: "Acme Foods", category: "FOOD_BEVERAGE", description: "Snacks made in Pune since 1999.", ...overrides });
const withContact = (overrides: Record<string, unknown> = {}) => listing({ contactEmail: "hello@acme.example", contactPhone: "+91 20 5550 0100", ...overrides });

/** Every key anywhere in a JSON value, however deep. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
  return [];
}
const expectNoContactKeys = (value: unknown) => expect(allKeys(value).filter((k) => /email|phone/i.test(k))).toEqual([]);

describe.skipIf(!dbAvailable)("business directory", () => {
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
  const names = (res: { body: { data: Array<{ name: string }> } }) => res.body.data.map((b) => b.name).sort();

  const withTrigger = <T>(when: string, body: string, fn: () => Promise<T>) => withTestTrigger(ctx, when, body, fn);

  async function setup(opts: Parameters<typeof createTenant>[1] = {}) {
    const { tenant } = await createTenant(ctx, opts);
    const base = `/api/v1/t/${tenant.slug}/businesses`;
    const author = await memberSession(ctx, tenant.id, { fullName: "Asha Author" });
    const other = await memberSession(ctx, tenant.id);
    return { tenant, base, author, other };
  }

  describe("create, read, edit and delete", () => {
    it("runs the whole lifecycle for the author and keeps others out of the writes", async () => {
      const { base, author, other } = await setup();

      const created = await api().post(base).set(author.headers).send(withContact({ city: "Pune", websiteUrl: "https://acme.example", logoUrl: "https://cdn.example/logo.png" }));
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        name: "Acme Foods",
        category: "FOOD_BEVERAGE",
        city: "Pune",
        websiteUrl: "https://acme.example",
        logoUrl: "https://cdn.example/logo.png",
        contactEmail: "hello@acme.example",
        contactPhone: "+91 20 5550 0100",
        moderationStatus: "APPROVED",
        isMine: true,
        author: { fullName: "Asha Author" },
      });
      const id = created.body.data.id as string;

      const seen = await api().get(`${base}/${id}`).set(other.headers);
      expect(seen.status).toBe(200);
      expect(seen.body.data).toMatchObject({ id, isMine: false, contactEmail: "hello@acme.example" });
      expect(names(await api().get(base).set(other.headers))).toEqual(["Acme Foods"]);

      const edited = await api().patch(`${base}/${id}`).set(author.headers).send({ name: "Acme Snacks", contactPhone: null });
      expect(edited.status).toBe(200);
      // A partial edit changes the named fields only.
      expect(edited.body.data).toMatchObject({ name: "Acme Snacks", contactPhone: null, contactEmail: "hello@acme.example", city: "Pune", websiteUrl: "https://acme.example", moderationStatus: "APPROVED" });

      expect((await api().patch(`${base}/${id}`).set(other.headers).send({ name: "Hijacked" })).status).toBe(403);
      expect((await api().delete(`${base}/${id}`).set(other.headers)).status).toBe(403);

      expect((await api().delete(`${base}/${id}`).set(author.headers)).status).toBe(204);
      expect((await api().get(`${base}/${id}`).set(author.headers)).status).toBe(404);
      expect((await api().delete(`${base}/${id}`).set(author.headers)).status).toBe(404);
      expect((await api().get(base).set(author.headers)).body.data).toEqual([]);
    });

    it("refuses invalid listings", async () => {
      const { base, author } = await setup();
      for (const bad of [{ name: "A" }, { category: "PETS" }, { category: undefined }, { description: "Short" }, { contactEmail: "not-an-email" }, { contactPhone: "1".repeat(25) }, { city: "x".repeat(81) }]) {
        expect((await api().post(base).set(author.headers).send(listing(bad))).status, JSON.stringify(bad)).toBe(400);
      }
      expect((await api().post(base).set(author.headers).send(listing({ category: "" }))).body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ message: "Choose a category" })]));
      expect((await api().get(`${base}?category=PETS`).set(author.headers)).status).toBe(400);
      expect((await api().get(`${base}?author=not-a-uuid`).set(author.headers)).status).toBe(400);
    });

    it("limits the length of the website, logo and email, as it does every other field", async () => {
      const { base, author } = await setup();
      const url = (length: number) => `https://acme.example/${"a".repeat(length - "https://acme.example/".length)}`;
      const email = (length: number) => `${"a".repeat(length - "@example.com".length)}@example.com`;
      const atLimit = await api().post(base).set(author.headers).send(listing({ websiteUrl: url(2048), logoUrl: url(2048), contactEmail: email(254) }));
      expect(atLimit.status).toBe(201);
      for (const over of [{ websiteUrl: url(2049) }, { logoUrl: url(2049) }, { contactEmail: email(255) }]) {
        const field = Object.keys(over)[0];
        expect((await api().post(base).set(author.headers).send(listing(over))).status, `POST ${field}`).toBe(400);
        expect((await api().patch(`${base}/${atLimit.body.data.id}`).set(author.headers).send(over)).status, `PATCH ${field}`).toBe(400);
      }
    });

    it("stores every category, so the constant and the migration can't drift apart unseen", async () => {
      const { base, author } = await setup();
      expect(BUSINESS_CATEGORIES).toHaveLength(14);
      for (const category of BUSINESS_CATEGORIES) {
        const created = await api().post(base).set(author.headers).send(listing({ category }));
        expect(created.status, category).toBe(201);
        const found = await api().get(`${base}?category=${category}`).set(author.headers);
        expect(found.body.data.map((b: { id: string }) => b.id), category).toEqual([created.body.data.id]);
        await api().delete(`${base}/${created.body.data.id}`).set(author.headers).expect(204);
      }
    });

    it("never fills contact details from the account", async () => {
      const { base, author } = await setup();
      const created = await api().post(base).set(author.headers).send(listing());
      expect(created.body.data).toMatchObject({ contactEmail: null, contactPhone: null, city: null, websiteUrl: null, logoUrl: null });
      expect(JSON.stringify(created.body.data)).not.toContain(author.user.phoneE164);
    });

    it("keeps only http and https in the website and logo, on create and on edit", async () => {
      const { base, author } = await setup();
      const bad = ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "javascript://example.com/%0Aalert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "ftp://example.com/x", "//example.com/x", "file:///etc/passwd"];
      const { body } = await api().post(base).set(author.headers).send(listing());
      for (const url of bad) {
        for (const field of ["websiteUrl", "logoUrl"]) {
          expect((await api().post(base).set(author.headers).send(listing({ [field]: url }))).status, `POST ${field} ${url}`).toBe(400);
          expect((await api().patch(`${base}/${body.data.id}`).set(author.headers).send({ [field]: url })).status, `PATCH ${field} ${url}`).toBe(400);
        }
      }
      const stored = await api().get(`${base}/${body.data.id}`).set(author.headers);
      expect(stored.body.data).toMatchObject({ websiteUrl: null, logoUrl: null });
      const good = await api().patch(`${base}/${body.data.id}`).set(author.headers).send({ websiteUrl: "http://acme.example", logoUrl: "HTTPS://cdn.example/a.png" });
      expect(good.body.data).toMatchObject({ websiteUrl: "http://acme.example", logoUrl: "HTTPS://cdn.example/a.png" });
    });
  });

  describe("an edit overtaken by another write", () => {
    /**
     * Commits `write` while the author's edit is in flight. The row is locked first, so wherever the edit has got to it
     * is waiting on that row when the write lands: at its read if it locks one, or else at its update, having already
     * decided what to write from a read that is about to be out of date.
     */
    async function editDuring(url: string, headers: Record<string, string>, id: string, write: (tx: Tx) => Promise<unknown>) {
      const { pending } = await runInTransaction(ctx, async (tx) => {
        await tx.select({ id: businessListings.id }).from(businessListings).where(eq(businessListings.id, id)).for("update");
        const pending = api().patch(url).set(headers).send({ city: "Pune" }).then((res) => res);
        for (let i = 0; i < 200; i++) {
          const { rows } = await ctx.pool.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()");
          if (rows[0].n > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await write(tx);
        // Wrapped, or returning it here would wait for the edit, which is waiting for this transaction to commit.
        return { pending };
      });
      return pending;
    }

    it("doesn't bring back a listing an admin removed meanwhile", async () => {
      const { base, author, other } = await setup();
      const { body } = await api().post(base).set(author.headers).send(listing());
      const id = body.data.id as string;

      const res = await editDuring(`${base}/${id}`, author.headers, id, (tx) => tx.update(businessListings).set({ moderationStatus: "REMOVED", moderationNote: "Off topic" }).where(eq(businessListings.id, id)));

      expect(res.status).toBe(403);
      const [row] = await ctx.db.select().from(businessListings).where(eq(businessListings.id, id));
      expect(row).toMatchObject({ moderationStatus: "REMOVED", moderationNote: "Off topic", city: null });
      expect((await api().get(base).set(other.headers)).body.data).toEqual([]);
    });

    it("answers 404 when the listing was deleted meanwhile", async () => {
      const { base, author } = await setup();
      const { body } = await api().post(base).set(author.headers).send(listing());
      const id = body.data.id as string;

      const res = await editDuring(`${base}/${id}`, author.headers, id, (tx) => tx.delete(businessListings).where(eq(businessListings.id, id)));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("the feature switch", () => {
    it("refuses every route when it is off", async () => {
      const { tenant, base, author } = await setup({ features: { ...defaultFeaturesFor("COLLEGE"), businesses: false } });
      const id = "00000000-0000-4000-8000-000000000000";
      const calls = [api().get(base), api().post(base).send(listing()), api().get(`${base}/${id}`), api().patch(`${base}/${id}`).send({ name: "Nope" }), api().delete(`${base}/${id}`)];
      for (const call of calls) {
        const res = await call.set(author.headers);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FEATURE_DISABLED");
      }
      const [row] = await ctx.db.select({ n: count() }).from(businessListings).where(eq(businessListings.tenantId, tenant.id));
      expect(row!.n).toBe(0);
    });

    it("can be turned off and on by the institution's admin, which takes effect at once", async () => {
      const { tenant, base, author } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const settings = `/api/v1/t/${tenant.slug}/admin/settings`;
      const publicFeatures = async () => (await api().get(`/api/v1/tenants/${tenant.slug}`)).body.data.settings.features.businesses;
      expect((await api().get(base).set(author.headers)).status).toBe(200);
      expect(await publicFeatures()).toBe(true);

      const off = await api().patch(settings).set(admin.headers).send({ features: { businesses: false } });
      expect(off.body.data.features).toEqual({ ...defaultFeaturesFor("COLLEGE"), businesses: false });
      expect((await api().get(base).set(author.headers)).status).toBe(403);
      expect(await publicFeatures()).toBe(false);

      await api().patch(settings).set(admin.headers).send({ features: { businesses: true } }).expect(200);
      expect((await api().get(base).set(author.headers)).status).toBe(200);
    });

    it("is on for a school, and for a row stored before the key existed", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { feed: true } });
      const member = await memberSession(ctx, tenant.id);
      expect((await api().get(`/api/v1/t/${tenant.slug}/businesses`).set(member.headers)).status).toBe(200);
      expect((await api().get(`/api/v1/tenants/${tenant.slug}`)).body.data.settings.features.businesses).toBe(true);
    });

    it("needs an approved member", async () => {
      const { tenant, base } = await setup();
      const pending = await memberSession(ctx, tenant.id, { status: "PENDING" });
      expect((await api().get(base).set(pending.headers)).status).toBe(403);
      expect((await api().post(base).set(pending.headers).send(listing())).status).toBe(403);
      expect((await api().get(base)).status).toBe(401);
    });
  });

  describe("the listing cap", () => {
    const fill = async (base: string, headers: Record<string, string>, n: number) => {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) ids.push((await api().post(base).set(headers).send(listing({ name: `Shop ${i}` }))).body.data.id);
      return ids;
    };

    it("stops at the cap per member, and deleting frees a place", async () => {
      const { base, author, other } = await setup();
      const ids = await fill(base, author.headers, MAX_BUSINESS_LISTINGS);
      const over = await api().post(base).set(author.headers).send(listing({ name: "One too many" }));
      expect(over.status).toBe(409);
      expect(over.body.error.message).toMatch(/up to 5/);
      expect((await api().post(base).set(other.headers).send(listing())).status).toBe(201);

      await api().delete(`${base}/${ids[0]}`).set(author.headers).expect(204);
      expect((await api().post(base).set(author.headers).send(listing({ name: "Back under" }))).status).toBe(201);
    });

    it("counts pending and rejected listings, but not removed ones", async () => {
      const { tenant, base, author } = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const moderation = `/api/v1/t/${tenant.slug}/admin/moderation/BUSINESS`;
      const ids = await fill(base, author.headers, MAX_BUSINESS_LISTINGS);
      await api().post(`${moderation}/${ids[0]}/reject`).set(admin.headers).send({ note: "Not yet" }).expect(200);
      expect((await api().post(base).set(author.headers).send(listing())).status).toBe(409);

      await api().post(`${moderation}/${ids[1]}/approve`).set(admin.headers).send({}).expect(200);
      await api().post(`${moderation}/${ids[1]}/remove`).set(admin.headers).send({ note: "Off topic" }).expect(200);
      expect((await api().post(base).set(author.headers).send(listing())).status).toBe(201);
      expect((await api().post(base).set(author.headers).send(listing())).status).toBe(409);
    });

    const liveCount = async (authorMembershipId: string) => {
      const [row] = await ctx.db.select({ n: count() }).from(businessListings).where(and(eq(businessListings.authorMembershipId, authorMembershipId), ne(businessListings.moderationStatus, "REMOVED")));
      return row!.n;
    };

    it("holds when an admin restores a listing whose place has been taken", async () => {
      const { tenant, base, author } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const moderation = `/api/v1/t/${tenant.slug}/admin/moderation/BUSINESS`;
      const ids = await fill(base, author.headers, MAX_BUSINESS_LISTINGS);
      await api().post(`${moderation}/${ids[0]}/remove`).set(admin.headers).send({}).expect(200);
      await api().post(base).set(author.headers).send(listing({ name: "Replacement" })).expect(201);

      const refused = await api().post(`${moderation}/${ids[0]}/restore`).set(admin.headers).send({});
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/already has 5/);
      const [row] = await ctx.db.select().from(businessListings).where(eq(businessListings.id, ids[0]!));
      expect(row!.moderationStatus).toBe("REMOVED");
      expect(await liveCount(author.membership.id)).toBe(MAX_BUSINESS_LISTINGS);

      await api().delete(`${base}/${ids[1]}`).set(author.headers).expect(204);
      await api().post(`${moderation}/${ids[0]}/restore`).set(admin.headers).send({}).expect(200);
      expect(await liveCount(author.membership.id)).toBe(MAX_BUSINESS_LISTINGS);
    });

    it("lets only one of two parallel restores take the last place", async () => {
      const { tenant, base, author } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const moderation = `/api/v1/t/${tenant.slug}/admin/moderation/BUSINESS`;
      const ids = await fill(base, author.headers, MAX_BUSINESS_LISTINGS);
      await api().post(`${moderation}/${ids[0]}/remove`).set(admin.headers).send({}).expect(200);
      await api().post(base).set(author.headers).send(listing({ name: "Replacement" })).expect(201);
      await api().post(`${moderation}/${ids[1]}/remove`).set(admin.headers).send({}).expect(200);
      expect(await liveCount(author.membership.id)).toBe(MAX_BUSINESS_LISTINGS - 1);

      // A slow update keeps each request's transaction open, so without the lock both would count four.
      const results = await withTrigger("before update on business_listings", "perform pg_sleep(0.2); return new;", () =>
        Promise.all(ids.slice(0, 2).map((id) => api().post(`${moderation}/${id}/restore`).set(admin.headers).send({}))),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await liveCount(author.membership.id)).toBe(MAX_BUSINESS_LISTINGS);
    });

    it("can't be passed by creating in parallel", async () => {
      const { tenant, base, author } = await setup();
      await fill(base, author.headers, MAX_BUSINESS_LISTINGS - 2);
      // A slow insert keeps each request's transaction open, so without the lock all of them count before any commits.
      const results = await withTrigger("before insert on business_listings", "perform pg_sleep(0.2); return new;", () =>
        Promise.all(Array.from({ length: 8 }, (_, i) => api().post(base).set(author.headers).send(listing({ name: `Parallel ${i}` })))),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 409, 409, 409, 409, 409, 409]);
      const [row] = await ctx.db.select({ n: count() }).from(businessListings).where(and(eq(businessListings.tenantId, tenant.id), eq(businessListings.authorMembershipId, author.membership.id)));
      expect(row!.n).toBe(MAX_BUSINESS_LISTINGS);
    });
  });

  describe("contact details", () => {
    it("never appear in a list, at any depth, and do on the detail", async () => {
      const { tenant, base, author, other } = await setup();
      const created = await api().post(base).set(author.headers).send(withContact());
      const lists = await Promise.all([api().get(base).set(other.headers), api().get(`${base}?mine=true`).set(author.headers), api().get(`${base}?q=acme`).set(other.headers), api().get(`${base}?author=${author.membership.id}`).set(other.headers)]);
      for (const list of lists) {
        expect(list.body.data).toHaveLength(1);
        expectNoContactKeys(list.body);
        expect(JSON.stringify(list.body)).not.toContain("hello@acme.example");
        expect(JSON.stringify(list.body)).not.toContain("5550 0100");
      }
      const detail = await api().get(`${base}/${created.body.data.id}`).set(other.headers);
      expect(detail.body.data).toMatchObject({ contactEmail: "hello@acme.example", contactPhone: "+91 20 5550 0100" });

      // Admins' queue shows what lists show.
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const queue = await api().get(`/api/v1/t/${tenant.slug}/admin/moderation?status=APPROVED`).set(admin.headers);
      expect(JSON.stringify(queue.body)).not.toContain("hello@acme.example");
    });

    it("are left out by the card mapper however complete the row is", async () => {
      const { base, author } = await setup();
      const { body } = await api().post(base).set(author.headers).send(withContact());
      const [row] = await ctx.db.select().from(businessListings).where(eq(businessListings.id, body.data.id));
      const viewer = { membershipId: author.membership.id, isAdmin: true };
      expectNoContactKeys(toBusinessCardDto({ listing: row!, author: author.membership }, viewer));
      expect(toBusinessDto({ listing: row!, author: author.membership }, viewer)).toMatchObject({ contactEmail: "hello@acme.example", contactPhone: "+91 20 5550 0100" });
    });
  });

  describe("search and filters", () => {
    async function seeded() {
      const s = await setup();
      const add = (headers: Record<string, string>, values: Record<string, unknown>) => api().post(s.base).set(headers).send(listing(values)).expect(201);
      await add(s.author.headers, { name: "Fair Trade Tea", description: "100% organic leaves from Assam.", category: "FOOD_BEVERAGE", city: "Pune" });
      await add(s.author.headers, { name: "Snack_Bar", description: "Quick bites near the campus.", category: "FOOD_BEVERAGE", city: "Mumbai" });
      await add(s.other.headers, { name: "Slash Studio", description: "Design with a C:\\temp sense of humour.", category: "MEDIA_DESIGN", city: "Navi Mumbai" });
      await add(s.other.headers, { name: "Plain Consulting", description: "Plain advice for plain people.", category: "CONSULTING", city: null });
      return s;
    }
    const q = (value: string) => `?q=${encodeURIComponent(value)}`;

    it("finds name and description, case-insensitively", async () => {
      const { base, other } = await seeded();
      expect(names(await api().get(`${base}${q("TEA")}`).set(other.headers))).toEqual(["Fair Trade Tea"]);
      expect(names(await api().get(`${base}${q("organic")}`).set(other.headers))).toEqual(["Fair Trade Tea"]);
      expect(names(await api().get(`${base}${q("plain")}`).set(other.headers))).toEqual(["Plain Consulting"]);
      expect(names(await api().get(`${base}${q("nothing like this")}`).set(other.headers))).toEqual([]);
    });

    it("treats %, _ and backslash as themselves", async () => {
      const { base, other } = await seeded();
      expect(names(await api().get(`${base}${q("%")}`).set(other.headers))).toEqual(["Fair Trade Tea"]);
      expect(names(await api().get(`${base}${q("100%")}`).set(other.headers))).toEqual(["Fair Trade Tea"]);
      expect(names(await api().get(`${base}${q("_")}`).set(other.headers))).toEqual(["Snack_Bar"]);
      expect(names(await api().get(`${base}${q("Snack_B")}`).set(other.headers))).toEqual(["Snack_Bar"]);
      expect(names(await api().get(`${base}${q("\\")}`).set(other.headers))).toEqual(["Slash Studio"]);
      expect(names(await api().get(`${base}${q("C:\\temp")}`).set(other.headers))).toEqual(["Slash Studio"]);
      expect(names(await api().get(`${base}${q("Plain\\")}`).set(other.headers))).toEqual([]);
    });

    it("filters by category, city and author, alone and together", async () => {
      const { base, author, other } = await seeded();
      expect(names(await api().get(`${base}?category=FOOD_BEVERAGE`).set(other.headers))).toEqual(["Fair Trade Tea", "Snack_Bar"]);
      expect(names(await api().get(`${base}?city=mumbai`).set(other.headers))).toEqual(["Slash Studio", "Snack_Bar"]);
      expect(names(await api().get(`${base}?author=${other.membership.id}`).set(author.headers))).toEqual(["Plain Consulting", "Slash Studio"]);
      expect(names(await api().get(`${base}?category=FOOD_BEVERAGE&city=mumbai`).set(other.headers))).toEqual(["Snack_Bar"]);
      expect(names(await api().get(`${base}?category=MEDIA_DESIGN&author=${author.membership.id}`).set(other.headers))).toEqual([]);
      expect(names(await api().get(`${base}?city=${encodeURIComponent("%")}`).set(other.headers))).toEqual([]);
      expect(names(await api().get(`${base}?city=${encodeURIComponent("\\")}`).set(other.headers))).toEqual([]);
    });

    it("pages through a long list without repeats", async () => {
      const { tenant, base, author } = await setup();
      const values = Array.from({ length: 7 }, (_, i) => ({ tenantId: tenant.id, authorMembershipId: author.membership.id, name: `Shop ${i}`, category: "RETAIL" as const, description: "Things for sale.", moderationStatus: "APPROVED" as const }));
      await ctx.db.insert(businessListings).values(values);
      const first = await api().get(`${base}?limit=4`).set(author.headers);
      const second = await api().get(`${base}?limit=4&cursor=${encodeURIComponent(first.body.nextCursor)}`).set(author.headers);
      expect(second.body.nextCursor).toBeNull();
      expect(new Set([...names(first), ...names(second)]).size).toBe(7);
    });
  });

  describe("every caller of escapeLike", () => {
    it("escapes the three special characters in one pass", () => {
      expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
      expect(escapeLike("\\%")).toBe("\\\\\\%");
      expect(escapeLike("plain")).toBe("plain");
    });

    it("answers a lone backslash, which would end an exact-match pattern on a bare escape and fail", async () => {
      const { tenant } = await setup();
      const t = `/api/v1/t/${tenant.slug}`;
      const member = await memberSession(ctx, tenant.id);
      // Postgres only trips on the bad pattern when it has a row to compare.
      const startAt = new Date(Date.now() + 86_400_000).toISOString();
      await api().post(`${t}/events`).set(member.headers).send({ title: "Meet", description: "d", kind: "CASUAL_MEETUP", city: "Pune", startAt, timezone: "Asia/Kolkata" }).expect(201);
      await api().post(`${t}/jobs`).set(member.headers).send({ title: "Role", companyName: "Co", location: "Pune", jobType: "FULL_TIME", description: "Ten chars plus" }).expect(201);
      await api().post(`${t}/funding`).set(member.headers).send({ kind: "OFFERING", title: "Cheques", pitch: "Investing in alumni." }).expect(201);
      await api().post(`${t}/businesses`).set(member.headers).send(listing({ city: "Pune" })).expect(201);
      const slash = encodeURIComponent("\\");
      for (const path of [`/directory?q=${slash}`, `/directory?city=${slash}`, `/directory?company=${slash}`, `/jobs?q=${slash}`, `/jobs?location=${slash}`, `/funding?q=${slash}`, `/events?city=${slash}`, `/businesses?q=${slash}`, `/businesses?city=${slash}`]) {
        const res = await api().get(`${t}${path}`).set(member.headers);
        expect(res.status, path).toBe(200);
        expect(res.body.data, path).toEqual([]);
      }
    });

    it("finds a backslash in the admin and console searches, which escape the same way", async () => {
      const { tenant } = await createTenant(ctx, { name: "C:\\Campus" });
      await createTenant(ctx, { name: "Plain Campus" });
      const t = `/api/v1/t/${tenant.slug}`;
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const member = await memberSession(ctx, tenant.id, { companyName: "C:\\Labs" });
      await memberSession(ctx, tenant.id, { companyName: "Plain Labs" });
      const inviteRow = { tenantId: tenant.id, expiresAt: new Date(Date.now() + 86_400_000) };
      await ctx.db.insert(invitations).values([
        { ...inviteRow, phoneE164: "+919800000001", fullName: "C:\\Invitee", token: "backslash-invite" },
        { ...inviteRow, phoneE164: "+919800000002", fullName: "Plain Invitee", token: "plain-invite" },
      ]);
      const staffUser = await createUser(ctx, { isPlatformAdmin: true });
      const staff = auth((await loginAs(ctx, staffUser.phoneE164)).accessToken);
      const oddUser = await createUser(ctx, { phone: "+91C:\\7" });

      const needle = encodeURIComponent("C:\\");
      const ids = (res: { body: { data: Array<{ id: string }> } }) => res.body.data.map((row) => row.id);
      expect(ids(await api().get(`${t}/admin/members?q=${needle}`).set(admin.headers))).toEqual([member.membership.id]);
      const invited = await api().get(`${t}/admin/invitations?q=${needle}`).set(admin.headers);
      expect(invited.body.data.map((row: { fullName: string }) => row.fullName)).toEqual(["C:\\Invitee"]);
      expect(ids(await api().get(`/api/v1/tenants?q=${needle}`))).toEqual([tenant.id]);
      expect(ids(await api().get(`/api/v1/platform/tenants?q=${needle}`).set(staff))).toEqual([tenant.id]);
      expect(ids(await api().get(`/api/v1/platform/users?phone=${needle}`).set(staff))).toEqual([oddUser.id]);
    });

    it("keeps the exact, case-insensitive city match of the directory and events", async () => {
      const { tenant } = await setup();
      const t = `/api/v1/t/${tenant.slug}`;
      const member = await memberSession(ctx, tenant.id, { city: "Navi Mumbai", fullName: "Exact Match" });
      const inCity = (res: { body: { data: Array<{ id: string }> } }) => res.body.data.map((m) => m.id);
      expect(inCity(await api().get(`${t}/directory?city=navi%20mumbai`).set(member.headers))).toEqual([member.membership.id]);
      expect(inCity(await api().get(`${t}/directory?city=mumbai`).set(member.headers))).not.toContain(member.membership.id);
      expect(inCity(await api().get(`${t}/directory?city=${encodeURIComponent("navi%")}`).set(member.headers))).toEqual([]);

      const startAt = new Date(Date.now() + 86_400_000).toISOString();
      const event = await api().post(`${t}/events`).set(member.headers).send({ title: "Meet", description: "d", kind: "CASUAL_MEETUP", city: "Navi Mumbai", startAt, timezone: "Asia/Kolkata" });
      expect(inCity(await api().get(`${t}/events?city=NAVI%20MUMBAI`).set(member.headers))).toEqual([event.body.data.id]);
      expect(inCity(await api().get(`${t}/events?city=${encodeURIComponent("n_vi mumbai")}`).set(member.headers))).toEqual([]);
    });
  });

  describe("under the moderation setting", () => {
    it("holds a member's listing, and only they and admins see it until it is approved", async () => {
      const { tenant, base, author, other } = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const t = `/api/v1/t/${tenant.slug}`;

      const created = await api().post(base).set(author.headers).send(withContact());
      expect(created.body.data).toMatchObject({ moderationStatus: "PENDING", moderatedAt: null });
      const id = created.body.data.id as string;

      expect((await api().get(base).set(other.headers)).body.data).toEqual([]);
      expect((await api().get(`${base}?author=${author.membership.id}`).set(other.headers)).body.data).toEqual([]);
      expect((await api().get(`${base}?author=${author.membership.id}`).set(author.headers)).body.data).toEqual([]);
      expect((await api().get(`${base}/${id}`).set(other.headers)).status).toBe(404);
      expect((await api().get(`${base}/${id}`).set(author.headers)).body.data.moderationStatus).toBe("PENDING");
      expect((await api().get(`${base}?mine=true`).set(author.headers)).body.data[0].moderationStatus).toBe("PENDING");

      expect((await api().get(`${t}/notifications`).set(admin.headers)).body.data[0]).toMatchObject({ type: "CONTENT_PENDING", title: "New business listing awaiting approval", data: { contentType: "BUSINESS", contentId: id } });
      const queue = await api().get(`${t}/admin/moderation?contentType=BUSINESS`).set(admin.headers);
      expect(queue.body.total).toBe(1);
      expect(queue.body.data[0]).toMatchObject({ contentType: "BUSINESS", id, title: "Acme Foods", excerpt: "Snacks made in Pune since 1999.", author: { fullName: "Asha Author" } });
      expect((await api().get(`${t}/admin/moderation/BUSINESS/${id}`).set(admin.headers)).body.data).toMatchObject({ name: "Acme Foods", contactEmail: "hello@acme.example" });
      expect((await api().get(`${t}/admin/dashboard`).set(admin.headers)).body.data.pendingContent).toBe(1);

      // Rejected: the author sees the note, nobody else sees the listing, and editing asks again.
      await api().post(`${t}/admin/moderation/BUSINESS/${id}/reject`).set(admin.headers).send({ note: "Add your city" }).expect(200);
      expect((await api().get(`${base}/${id}`).set(author.headers)).body.data).toMatchObject({ moderationStatus: "REJECTED", moderationNote: "Add your city" });
      expect((await api().get(`${base}/${id}`).set(other.headers)).status).toBe(404);
      expect((await api().get(`${t}/notifications`).set(author.headers)).body.data[0]).toMatchObject({ type: "CONTENT_REJECTED", title: "Your business listing was not approved" });
      const reworked = await api().patch(`${base}/${id}`).set(author.headers).send({ city: "Pune" });
      expect(reworked.body.data).toMatchObject({ moderationStatus: "PENDING", moderationNote: null });

      // Approved: everyone. The note never reaches another member.
      await api().post(`${t}/admin/moderation/BUSINESS/${id}/approve`).set(admin.headers).send({ note: "Thanks" }).expect(200);
      expect((await api().get(`${t}/notifications`).set(author.headers)).body.data[0]).toMatchObject({ type: "CONTENT_APPROVED", title: "Your business listing is live" });
      expect(names(await api().get(base).set(other.headers))).toEqual(["Acme Foods"]);
      expect((await api().get(`${base}/${id}`).set(other.headers)).body.data.moderationNote).toBeNull();

      // Edited after approval: back to pending and out of the list.
      await api().patch(`${base}/${id}`).set(author.headers).send({ name: "Acme Snacks" }).expect(200);
      expect((await api().get(base).set(other.headers)).body.data).toEqual([]);
      await api().post(`${t}/admin/moderation/BUSINESS/${id}/approve`).set(admin.headers).send({}).expect(200);

      // Removed: gone even for the author, except from My posts, and it can't be edited back.
      await api().post(`${t}/admin/moderation/BUSINESS/${id}/remove`).set(admin.headers).send({ note: "Off topic" }).expect(200);
      expect((await api().get(`${base}/${id}`).set(author.headers)).status).toBe(404);
      expect((await api().get(base).set(other.headers)).body.data).toEqual([]);
      expect((await api().get(`${base}?mine=true`).set(author.headers)).body.data[0]).toMatchObject({ moderationStatus: "REMOVED", moderationNote: "Off topic" });
      expect((await api().patch(`${base}/${id}`).set(author.headers).send({ name: "Back" })).status).toBe(403);

      await api().post(`${t}/admin/moderation/BUSINESS/${id}/restore`).set(admin.headers).send({}).expect(200);
      expect(names(await api().get(base).set(other.headers))).toEqual(["Acme Snacks"]);
    });

    it("shows a member only their own listings under mine, however it is asked", async () => {
      const { tenant, base, author, other } = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const third = await memberSession(ctx, tenant.id);
      const moderation = `/api/v1/t/${tenant.slug}/admin/moderation/BUSINESS`;
      const add = async (session: { headers: Record<string, string> }, name: string) => (await api().post(base).set(session.headers).send(listing({ name })).expect(201)).body.data.id as string;
      const mine = (session: { headers: Record<string, string> }, extra = "") => api().get(`${base}?mine=true${extra}`).set(session.headers);

      await add(author, "Author pending");
      const rejected = await add(author, "Author rejected");
      const removed = await add(author, "Author removed");
      await api().post(`${moderation}/${rejected}/reject`).set(admin.headers).send({ note: "No" }).expect(200);
      await api().post(`${moderation}/${removed}/approve`).set(admin.headers).send({}).expect(200);
      await api().post(`${moderation}/${removed}/remove`).set(admin.headers).send({ note: "No" }).expect(200);
      await add(other, "Other pending");

      expect(names(await mine(author))).toEqual(["Author pending", "Author rejected", "Author removed"]);
      expect(names(await mine(other))).toEqual(["Other pending"]);
      expect((await mine(third)).body.data).toEqual([]);
      // Naming someone else as the author doesn't open their unapproved listings.
      expect((await mine(other, `&author=${author.membership.id}`)).body.data).toEqual([]);
      expect((await mine(third, `&author=${author.membership.id}`)).body.data).toEqual([]);
    });

    it("publishes an admin's own listing straight away, and a member's when moderation is off", async () => {
      const { tenant, base, author } = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      expect((await api().post(base).set(admin.headers).send(listing())).body.data.moderationStatus).toBe("APPROVED");
      expect((await api().post(base).set(author.headers).send(listing())).body.data.moderationStatus).toBe("PENDING");
      const open = await setup();
      const created = await api().post(open.base).set(open.author.headers).send(listing());
      expect(created.body.data.moderationStatus).toBe("APPROVED");
      expect(created.body.data.moderatedAt).not.toBeNull();
    });

    it("hides a suspended author's listings from other members", async () => {
      const { tenant, base, author, other } = await setup();
      const created = await api().post(base).set(author.headers).send(listing());
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      await api().post(`/api/v1/t/${tenant.slug}/admin/members/${author.membership.id}/suspend`).set(admin.headers).send({ reason: "Spam" }).expect(200);
      expect((await api().get(base).set(other.headers)).body.data).toEqual([]);
      expect((await api().get(`${base}/${created.body.data.id}`).set(other.headers)).status).toBe(404);
    });
  });

  describe("reports", () => {
    it("go through the existing flow, and removing the content resolves them", async () => {
      const { tenant, base, author, other } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const t = `/api/v1/t/${tenant.slug}`;
      const { body } = await api().post(base).set(author.headers).send(listing());
      const id = body.data.id as string;

      expect((await api().post(`${t}/reports`).set(author.headers).send({ contentType: "BUSINESS", contentId: id, reason: "SPAM" })).status).toBe(400);
      const report = await api().post(`${t}/reports`).set(other.headers).send({ contentType: "BUSINESS", contentId: id, reason: "SPAM", details: "Fake shop" });
      expect(report.status).toBe(201);
      expect((await api().post(`${t}/reports`).set(other.headers).send({ contentType: "BUSINESS", contentId: id, reason: "SPAM" })).status).toBe(409);
      expect((await api().get(`${t}/notifications`).set(admin.headers)).body.data[0]).toMatchObject({ type: "REPORT_FILED", title: "business listing reported: spam", body: "Acme Foods" });

      const queue = await api().get(`${t}/admin/reports`).set(admin.headers);
      expect(queue.body.data[0]).toMatchObject({ contentType: "BUSINESS", content: { title: "Acme Foods", moderationStatus: "APPROVED", authorMembershipId: author.membership.id } });
      expect((await api().get(`${t}/admin/moderation?status=APPROVED&contentType=BUSINESS`).set(admin.headers)).body.data[0].reportCount).toBe(1);

      await api().post(`${t}/admin/reports/${report.body.data.id}/resolve`).set(admin.headers).send({ action: "REMOVE_CONTENT", note: "Confirmed" }).expect(200);
      expect((await api().get(`${base}/${id}`).set(other.headers)).status).toBe(404);
      expect((await api().get(`${t}/admin/reports`).set(admin.headers)).body.total).toBe(0);
      expect((await api().get(`${t}/notifications`).set(author.headers)).body.data[0].type).toBe("CONTENT_REMOVED");
    });

    it("are resolved when the author deletes the listing, so none stays open pointing at nothing", async () => {
      const { tenant, base, author, other } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const third = await memberSession(ctx, tenant.id);
      const t = `/api/v1/t/${tenant.slug}`;
      const { body } = await api().post(base).set(author.headers).send(listing());
      const { body: kept } = await api().post(base).set(author.headers).send(listing({ name: "Still here" }));
      for (const reporter of [other, third]) await api().post(`${t}/reports`).set(reporter.headers).send({ contentType: "BUSINESS", contentId: body.data.id, reason: "SPAM" }).expect(201);
      await api().post(`${t}/reports`).set(other.headers).send({ contentType: "BUSINESS", contentId: kept.data.id, reason: "SPAM" }).expect(201);

      await api().delete(`${base}/${body.data.id}`).set(author.headers).expect(204);

      const open = await api().get(`${t}/admin/reports`).set(admin.headers);
      expect(open.body.total).toBe(1);
      expect(open.body.data[0].content).toMatchObject({ title: "Still here" });
      expect((await api().get(`${t}/admin/dashboard`).set(admin.headers)).body.data.openReports).toBe(1);
      const resolved = await api().get(`${t}/admin/reports?status=RESOLVED`).set(admin.headers);
      expect(resolved.body.total).toBe(2);
      for (const r of resolved.body.data) expect(r).toMatchObject({ resolutionNote: "auto: author deleted", content: null });
    });

    it("closes one filed just as the listing goes, which the delete couldn't see", async () => {
      const { tenant, base, author, other } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const t = `/api/v1/t/${tenant.slug}`;
      const { body } = await api().post(base).set(author.headers).send(listing());
      // Stands in for the author's delete committing after the report's first check and before its insert.
      const res = await withTrigger("before insert on content_reports", "delete from business_listings where id = new.content_id; return new;", () =>
        api().post(`${t}/reports`).set(other.headers).send({ contentType: "BUSINESS", contentId: body.data.id, reason: "SPAM" }),
      );
      expect(res.status).toBe(404);

      expect((await api().get(`${t}/admin/reports`).set(admin.headers)).body.total).toBe(0);
      expect((await api().get(`${t}/admin/dashboard`).set(admin.headers)).body.data.openReports).toBe(0);
      const resolved = await api().get(`${t}/admin/reports?status=RESOLVED`).set(admin.headers);
      expect(resolved.body.data).toEqual([expect.objectContaining({ contentId: body.data.id, resolutionNote: "auto: author deleted", content: null })]);
      const bell = await api().get(`${t}/notifications`).set(admin.headers);
      expect(bell.body.data.filter((n: { type: string }) => n.type === "REPORT_FILED")).toEqual([]);
    });

    it("leaves the listing and its reports alone when the delete can't finish", async () => {
      const { tenant, base, author, other } = await setup();
      const t = `/api/v1/t/${tenant.slug}`;
      const { body } = await api().post(base).set(author.headers).send(listing());
      await api().post(`${t}/reports`).set(other.headers).send({ contentType: "BUSINESS", contentId: body.data.id, reason: "SPAM" }).expect(201);
      // Failing the report update stands in for anything going wrong after the delete.
      await withTrigger("before update on content_reports", "raise exception 'forced';", () => api().delete(`${base}/${body.data.id}`).set(author.headers).expect(500));
      expect((await api().get(`${base}/${body.data.id}`).set(author.headers)).status).toBe(200);
      const [report] = await ctx.db.select().from(contentReports).where(eq(contentReports.contentId, body.data.id));
      expect(report!.status).toBe("OPEN");
    });
  });

  describe("account deletion", () => {
    it("removes the member's listings, as it does funding, and resolves the reports on them", async () => {
      const { tenant, base, author, other } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const t = `/api/v1/t/${tenant.slug}`;
      const { body } = await api().post(base).set(author.headers).send(listing());
      const { body: others } = await api().post(base).set(other.headers).send(listing({ name: "Not theirs" }));
      await api().post(`${t}/funding`).set(author.headers).send({ kind: "OFFERING", title: "Cheques", pitch: "Investing in alumni." }).expect(201);
      await api().post(`${t}/reports`).set(other.headers).send({ contentType: "BUSINESS", contentId: body.data.id, reason: "SPAM" }).expect(201);
      await api().post(`${t}/reports`).set(admin.headers).send({ contentType: "BUSINESS", contentId: others.data.id, reason: "SPAM" }).expect(201);

      await api().post("/api/v1/me/delete").set(author.headers).send({ confirm: true }).expect(204);

      const listingsLeft = await ctx.db.select({ id: businessListings.id }).from(businessListings).where(eq(businessListings.tenantId, tenant.id));
      expect(listingsLeft.map((r) => r.id)).toEqual([others.data.id]);
      const [funding] = await ctx.db.select({ n: count() }).from(fundingListings).where(eq(fundingListings.tenantId, tenant.id));
      expect(funding!.n).toBe(0);

      const open = await api().get(`${t}/admin/reports`).set(admin.headers);
      expect(open.body.data.map((r: { contentId: string }) => r.contentId)).toEqual([others.data.id]);
      const resolved = await api().get(`${t}/admin/reports?status=RESOLVED`).set(admin.headers);
      expect(resolved.body.data).toEqual([expect.objectContaining({ contentId: body.data.id, resolutionNote: "auto: author deleted", content: null })]);
    });
  });

  describe("tenant isolation", () => {
    it("404s another institution's listing, however it is reached", async () => {
      const a = await setup();
      const b = await setup();
      const adminB = await memberSession(ctx, b.tenant.id, { role: "TENANT_ADMIN" });
      const { body } = await api().post(a.base).set(a.author.headers).send(withContact());
      const id = body.data.id as string;
      const t = `/api/v1/t/${b.tenant.slug}`;

      expect((await api().get(`${b.base}/${id}`).set(b.author.headers)).status).toBe(404);
      expect((await api().patch(`${b.base}/${id}`).set(b.author.headers).send({ name: "Hijacked" })).status).toBe(404);
      expect((await api().delete(`${b.base}/${id}`).set(b.author.headers)).status).toBe(404);
      expect((await api().post(`${t}/reports`).set(b.author.headers).send({ contentType: "BUSINESS", contentId: id, reason: "SPAM" })).status).toBe(404);
      expect((await api().get(`${t}/admin/moderation/BUSINESS/${id}`).set(adminB.headers)).status).toBe(404);
      expect((await api().post(`${t}/admin/moderation/BUSINESS/${id}/remove`).set(adminB.headers).send({})).status).toBe(404);
      expect((await api().get(b.base).set(b.author.headers)).body.data).toEqual([]);
      expect((await api().get(`${b.base}?author=${a.author.membership.id}`).set(b.author.headers)).body.data).toEqual([]);
      // A member of one institution isn't a member of the other, even with a valid session.
      expect((await api().get(`${a.base}/${id}`).set(b.author.headers)).status).toBe(403);
      expect((await api().get(`${a.base}/${id}`).set(a.author.headers)).body.data.name).toBe("Acme Foods");
    });

    it("counts the cap per institution", async () => {
      const a = await setup();
      const { tenant: otherTenant } = await createTenant(ctx);
      for (let i = 0; i < MAX_BUSINESS_LISTINGS; i++) await api().post(a.base).set(a.author.headers).send(listing()).expect(201);
      const member = await memberSession(ctx, otherTenant.id);
      expect((await api().post(`/api/v1/t/${otherTenant.slug}/businesses`).set(member.headers).send(listing())).status).toBe(201);
    });
  });

  describe("demo data", () => {
    it("is added once, with a pending listing in the college and a report only in the university", async () => {
      const { tenantIds } = await seedCore(ctx.db, ["+919999999999"]);
      const membershipIds = await seedMembers(ctx.db, tenantIds);
      const uni = tenantIds["demo-university"]!;
      const college = tenantIds["demo-college"]!;
      const listingsOf = async (tenantId: string) => ctx.db.select().from(businessListings).where(eq(businessListings.tenantId, tenantId));

      await seedConnections(ctx.db, tenantIds, membershipIds);
      const [uniListings, collegeListings] = [await listingsOf(uni), await listingsOf(college)];
      for (const listings of [uniListings, collegeListings]) {
        expect(new Set(listings.map((l) => l.category)).size).toBeGreaterThan(2);
        expect(new Set(listings.map((l) => l.city)).size).toBeGreaterThan(2);
      }
      expect(uniListings.every((l) => l.moderationStatus === "APPROVED")).toBe(true);
      expect(collegeListings.filter((l) => l.moderationStatus === "PENDING")).toHaveLength(1);

      // The admin e2e expects demo-college to end on "No open reports".
      expect(await ctx.db.select().from(contentReports).where(eq(contentReports.tenantId, college))).toEqual([]);
      const reports = await ctx.db.select().from(contentReports).where(eq(contentReports.tenantId, uni));
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ contentType: "BUSINESS", status: "OPEN" });
      const reported = uniListings.find((l) => l.id === reports[0]!.contentId);
      expect(reported).toBeDefined();
      expect(reported!.authorMembershipId).not.toBe(reports[0]!.reporterMembershipId);

      await seedConnections(ctx.db, tenantIds, membershipIds);
      expect(await listingsOf(uni)).toHaveLength(uniListings.length);
      expect(await listingsOf(college)).toHaveLength(collegeListings.length);
      expect(await ctx.db.select().from(contentReports)).toHaveLength(1);
    });
  });

  describe("rate limits", () => {
    it("limits creating to 10 an hour per member, in its own bucket", async () => {
      const { tenant, base, author, other } = await setup();
      const created = await api().post(base).set(author.headers).send(listing());
      process.env.RATE_LIMIT_IN_TESTS = "1";
      try {
        // The cap refuses most of these, and they still count: a rejected attempt costs the server the same.
        for (let i = 0; i < 10; i++) {
          const res = await api().post(base).set(author.headers).send(listing());
          expect(res.status, `attempt ${i + 1}`).toBe(i < MAX_BUSINESS_LISTINGS - 1 ? 201 : 409);
          expect(res.headers["x-ratelimit-limit"]).toBe("10");
        }
        const limited = await api().post(base).set(author.headers).send(listing());
        expect(limited.status).toBe(429);
        expect(limited.body.error.code).toBe("RATE_LIMITED");
        expect((await api().post(base).set(other.headers).send(listing())).status).toBe(201);
        expect(await ctx.redis.get(keys.rateLimit("business-create", author.membership.id))).toBe("11");
        // Edits and posts have buckets of their own, so neither is out yet.
        expect((await api().patch(`${base}/${created.body.data.id}`).set(author.headers).send({ city: "Pune" })).status).toBe(200);
        expect((await api().post(`/api/v1/t/${tenant.slug}/posts`).set(author.headers).send({ body: "Still fine" })).status).toBe(201);
      } finally {
        delete process.env.RATE_LIMIT_IN_TESTS;
      }
    });

    it("limits editing to 30 an hour per member", async () => {
      const { base, author, other } = await setup();
      const { body } = await api().post(base).set(author.headers).send(listing());
      const { body: others } = await api().post(base).set(other.headers).send(listing());
      process.env.RATE_LIMIT_IN_TESTS = "1";
      try {
        for (let i = 0; i < 30; i++) expect((await api().patch(`${base}/${body.data.id}`).set(author.headers).send({ city: `City ${i}` })).status).toBe(200);
        const limited = await api().patch(`${base}/${body.data.id}`).set(author.headers).send({ city: "One more" });
        expect(limited.status).toBe(429);
        expect((await api().patch(`${base}/${others.data.id}`).set(other.headers).send({ city: "Pune" })).status).toBe(200);
        expect(await ctx.redis.get(keys.rateLimit("business-edit", author.membership.id))).toBe("31");
        // Creating has its own bucket, and reading and deleting aren't edits.
        expect((await api().post(base).set(author.headers).send(listing())).status).toBe(201);
        expect((await api().get(`${base}/${body.data.id}`).set(author.headers)).body.data.city).toBe("City 29");
        expect((await api().delete(`${base}/${body.data.id}`).set(author.headers)).status).toBe(204);
      } finally {
        delete process.env.RATE_LIMIT_IN_TESTS;
      }
    });
  });
});
