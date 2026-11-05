import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memberships, uploads } from "../../src/db/schema";
import { UNSAVED_AVATAR_GRACE_MS, sweepUnusedAvatars } from "../../src/services/uploads.service";
import { withTrigger } from "../helpers/db";
import { PROFILE, auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { testPng } from "../helpers/images";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const PNG = await testPng();

type Headers = Record<string, string>;

describe.skipIf(!dbAvailable)("a member's background", () => {
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

  const upload = async (slug: string, headers: Headers, purpose: "backdrop" | "avatar" | "image" = "backdrop", file = PNG) => {
    const res = await api().post(`/api/v1/t/${slug}/uploads?purpose=${purpose}`).set(headers).attach("file", file, { filename: "wall.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    return res.body.data.url as string;
  };
  const setAppearance = (slug: string, headers: Headers, body: object) => api().patch(`/api/v1/t/${slug}/memberships/me/appearance`).set(headers).send(body);
  const me = async (slug: string, headers: Headers) => (await api().get(`/api/v1/t/${slug}/memberships/me`).set(headers)).body.data;
  const keyOf = (url: string) => ctx.storage.keyFromUrl(url)!;
  const stored = (url: string) => existsSync(join(ctx.config.uploadDirAbsolute, keyOf(url)));
  const ledgerRow = async (url: string) => (await ctx.db.select().from(uploads).where(eq(uploads.storageKey, keyOf(url))))[0];
  const storedAppearance = async (membershipId: string) => (await ctx.db.select().from(memberships).where(eq(memberships.id, membershipId)))[0]!.appearance;
  const expectRefused = (res: request.Response, message?: string) => {
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "photoUrl", message: message ?? expect.any(String) }]);
  };

  it("starts plain, and saves only what's sent, per institution, without counting as a profile change", async () => {
    const { tenant } = await createTenant(ctx);
    const { tenant: other } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    await createMembership(ctx, other.id, member.user.id);
    const before = await me(tenant.slug, member.headers);
    expect(before.appearance).toEqual({ backdrop: "PLAIN", photoUrl: null });

    const brand = await setAppearance(tenant.slug, member.headers, { backdrop: "BRAND" });
    expect(brand.status).toBe(200);
    expect(brand.body.data.appearance).toEqual({ backdrop: "BRAND", photoUrl: null });
    // Only they see it, so it doesn't make this the profile "Use details from …" offers next.
    expect(brand.body.data.updatedAt).toBe(before.updatedAt);
    expect((await me(tenant.slug, member.headers)).appearance).toEqual({ backdrop: "BRAND", photoUrl: null });
    expect((await me(other.slug, member.headers)).appearance).toEqual({ backdrop: "PLAIN", photoUrl: null });

    // A photo on its own keeps the backdrop, and a backdrop on its own keeps the photo for later.
    const photo = await upload(tenant.slug, member.headers);
    expect((await setAppearance(tenant.slug, member.headers, { photoUrl: photo })).body.data.appearance).toEqual({ backdrop: "BRAND", photoUrl: photo });
    expect((await setAppearance(tenant.slug, member.headers, { backdrop: "PHOTO" })).body.data.appearance).toEqual({ backdrop: "PHOTO", photoUrl: photo });
    expect((await setAppearance(tenant.slug, member.headers, { backdrop: "COVER" })).body.data.appearance).toEqual({ backdrop: "COVER", photoUrl: photo });
    expect(stored(photo)).toBe(true);
    expect((await me(tenant.slug, member.headers)).appearance).toEqual({ backdrop: "COVER", photoUrl: photo });

    // A key a newer version stored stays too.
    await ctx.db.update(memberships).set({ appearance: { backdrop: "COVER", photoUrl: photo, tint: "warm" } as never }).where(eq(memberships.id, member.membership.id));
    expect((await setAppearance(tenant.slug, member.headers, { backdrop: "PLAIN" })).status).toBe(200);
    expect(await storedAppearance(member.membership.id)).toEqual({ backdrop: "PLAIN", photoUrl: photo, tint: "warm" });
  });

  it("refuses Your photo without a photo, and anything but a backdrop and a photo", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);

    expectRefused(await setAppearance(tenant.slug, member.headers, { backdrop: "PHOTO" }), "Upload a photo first");
    expectRefused(await setAppearance(tenant.slug, member.headers, { backdrop: "PHOTO", photoUrl: null }), "Upload a photo first");
    expect(await storedAppearance(member.membership.id)).toEqual({});

    const photo = await upload(tenant.slug, member.headers);
    expect((await setAppearance(tenant.slug, member.headers, { backdrop: "PHOTO", photoUrl: photo })).status).toBe(200);
    // Taking the photo away while it is the background leaves both as they were.
    expectRefused(await setAppearance(tenant.slug, member.headers, { photoUrl: null }), "Upload a photo first");
    expect(stored(photo)).toBe(true);
    expect((await me(tenant.slug, member.headers)).appearance).toEqual({ backdrop: "PHOTO", photoUrl: photo });

    for (const body of [{ backdrop: "DARK" }, { backdrop: "PLAIN", theme: "dark" }, { photoUrl: "https://me:secret@cdn.example.com/a.jpg" }, { photoUrl: "file:///etc/passwd" }]) {
      const res = await setAppearance(tenant.slug, member.headers, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("takes only a background the member uploaded here as a new photo, and keeps an unchanged older one", async () => {
    const { tenant: a } = await createTenant(ctx);
    const { tenant: b } = await createTenant(ctx);
    const member = await memberSession(ctx, a.id);
    await createMembership(ctx, b.id, member.user.id);
    const other = await memberSession(ctx, a.id);
    const choose = (photoUrl: string) => setAppearance(a.slug, member.headers, { backdrop: "PHOTO", photoUrl });

    expectRefused(await choose("https://tracker.example.com/pixel.jpg"));
    expectRefused(await choose(await upload(b.slug, member.headers))); // their own, at another institution
    expectRefused(await choose(await upload(a.slug, other.headers))); // someone else's
    expectRefused(await choose(await upload(a.slug, member.headers, "avatar"))); // uploaded as a profile photo
    expectRefused(await choose(await upload(a.slug, member.headers, "image"))); // uploaded for a post
    expect((await me(a.slug, member.headers)).appearance).toEqual({ backdrop: "PLAIN", photoUrl: null });

    const mine = await upload(a.slug, member.headers);
    const saved = await choose(mine);
    expect(saved.status).toBe(200);
    expect(saved.body.data.appearance).toEqual({ backdrop: "PHOTO", photoUrl: mine });

    // A background can't be anyone's profile photo either.
    const asAvatar = await api().patch(`/api/v1/t/${a.slug}/memberships/me`).set(member.headers).send({ avatarUrl: mine });
    expect(asAvatar.status).toBe(400);
    expect(asAvatar.body.error.details).toEqual([{ path: "avatarUrl", message: expect.any(String) }]);

    // A photo saved some other way (before a switch of storage provider) survives a save that sends it back unchanged.
    const legacy = "https://cdn.example.com/backdrops/old.jpg";
    await ctx.db.update(memberships).set({ appearance: { backdrop: "PHOTO", photoUrl: legacy } }).where(eq(memberships.id, member.membership.id));
    expect((await setAppearance(a.slug, member.headers, { backdrop: "BRAND", photoUrl: legacy })).body.data.appearance).toEqual({ backdrop: "BRAND", photoUrl: legacy });
  });

  it("deletes a replaced or removed photo once the change commits, and keeps it through a save that fails", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    const choose = (body: object) => setAppearance(tenant.slug, member.headers, body);

    const first = await upload(tenant.slug, member.headers);
    expect((await choose({ backdrop: "PHOTO", photoUrl: first })).status).toBe(200);
    const second = await upload(tenant.slug, member.headers);
    expect((await choose({ photoUrl: second })).status).toBe(200);
    expect(stored(first)).toBe(false);
    expect(await ledgerRow(first)).toBeUndefined();
    expect(stored(second)).toBe(true);

    // A save that fails after letting go of the photo deletes nothing.
    const refuseAppearance = "if new.appearance is distinct from old.appearance then raise exception 'refused'; end if; return new;";
    await withTrigger(ctx, "before update on memberships", refuseAppearance, async () => {
      expect((await choose({ backdrop: "PLAIN", photoUrl: null })).status).toBe(500);
    });
    expect(stored(second)).toBe(true);
    expect(await ledgerRow(second)).toBeDefined();
    expect((await me(tenant.slug, member.headers)).appearance).toEqual({ backdrop: "PHOTO", photoUrl: second });

    // Remove photo: back to plain, and the photo goes.
    const removed = await choose({ backdrop: "PLAIN", photoUrl: null });
    expect(removed.body.data.appearance).toEqual({ backdrop: "PLAIN", photoUrl: null });
    expect(stored(second)).toBe(false);
    expect(await ledgerRow(second)).toBeUndefined();
  });

  it("deletes a person's background photos with their account, and sweeps away ones never saved", async () => {
    const { tenant } = await createTenant(ctx);
    const leaving = await memberSession(ctx, tenant.id);
    const staying = await memberSession(ctx, tenant.id);

    const shown = await upload(tenant.slug, leaving.headers);
    // Kept for later while the institution colour is the background.
    expect((await setAppearance(tenant.slug, leaving.headers, { backdrop: "BRAND", photoUrl: shown })).status).toBe(200);
    const neverSaved = await upload(tenant.slug, leaving.headers);
    const kept = await upload(tenant.slug, staying.headers);
    expect((await setAppearance(tenant.slug, staying.headers, { backdrop: "COVER", photoUrl: kept })).status).toBe(200);
    const unsaved = await upload(tenant.slug, staying.headers);

    expect((await api().post("/api/v1/me/delete").set(leaving.headers).send({ confirm: true })).status).toBe(204);
    for (const url of [shown, neverSaved]) {
      expect(stored(url)).toBe(false);
      expect(await ledgerRow(url)).toBeUndefined();
    }

    // Someone may still be choosing.
    expect(await sweepUnusedAvatars(ctx)).toEqual({ removed: 0 });
    expect(await sweepUnusedAvatars(ctx, new Date(Date.now() + UNSAVED_AVATAR_GRACE_MS + 60_000))).toEqual({ removed: 1 });
    expect(stored(unsaved)).toBe(false);
    expect(await ledgerRow(unsaved)).toBeUndefined();
    // A photo kept for later is still theirs, even with another backdrop chosen.
    expect(stored(kept)).toBe(true);
    expect(await ledgerRow(kept)).toBeDefined();
  });

  it("stores a background photo as a JPEG of at most 1600 pixels on white, recorded as a backdrop", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    const wide = await sharp({ create: { width: 3200, height: 1200, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 0.5 } } })
      .png()
      .toBuffer();
    const url = await upload(tenant.slug, member.headers, "backdrop", wide);
    expect(url).toMatch(/\.jpg$/);
    const served = await api().get(new URL(url).pathname).buffer(true);
    expect(served.headers["content-type"]).toContain("image/jpeg");
    expect(await sharp(served.body as Buffer).metadata()).toMatchObject({ format: "jpeg", width: 1600, height: 600, hasAlpha: false });
    expect(await ledgerRow(url)).toMatchObject({ userId: member.user.id, purpose: "backdrop", contentType: "image/jpeg" });
  });

  it("is only for approved members", async () => {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    const applicant = auth((await loginAs(ctx, (await createUser(ctx)).phoneE164)).accessToken);
    const outsider = await setAppearance(tenant.slug, applicant, { backdrop: "BRAND" });
    expect(outsider.status).toBe(403);
    expect(outsider.body.error.code).toBe("NOT_A_MEMBER");
    await api().post(`/api/v1/t/${tenant.slug}/memberships`).set(applicant).send(PROFILE);
    const pending = await setAppearance(tenant.slug, applicant, { backdrop: "BRAND" });
    expect(pending.status).toBe(403);
    expect(pending.body.error.code).toBe("MEMBERSHIP_PENDING");
  });

  it("shows the background to nobody else: not admins, not the directory, not another institution's registration", async () => {
    const { tenant } = await createTenant(ctx);
    const { tenant: joining } = await createTenant(ctx);
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const viewer = await memberSession(ctx, tenant.id);
    const member = await memberSession(ctx, tenant.id, { fullName: "Asha Rao" });
    const photo = await upload(tenant.slug, member.headers);
    expect((await setAppearance(tenant.slug, member.headers, { backdrop: "PHOTO", photoUrl: photo })).status).toBe(200);
    const base = `/api/v1/t/${tenant.slug}`;

    // Each view, and what shows it is about this member: "Use details from …" never carries the name.
    const views: Array<[string, request.Response, string]> = [
      ["admin list", await api().get(`${base}/admin/members`).set(admin.headers), "Asha Rao"],
      ["admin detail", await api().get(`${base}/admin/members/${member.membership.id}`).set(admin.headers), "Asha Rao"],
      ["directory", await api().get(`${base}/directory`).set(viewer.headers), "Asha Rao"],
      ["profile", await api().get(`${base}/directory/${member.membership.id}`).set(viewer.headers), "Asha Rao"],
      ["use details from", await api().get(`/api/v1/me/profile-copy?exclude=${joining.slug}`).set(member.headers), tenant.slug],
      ["their institutions", await api().get("/api/v1/me").set(member.headers), "Asha Rao"],
    ];
    for (const [name, res, about] of views) {
      expect(res.status, name).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body, name).toContain(about);
      expect(body, name).not.toContain("appearance");
      expect(body, name).not.toContain(keyOf(photo));
    }
    // Their own view has it.
    expect((await me(tenant.slug, member.headers)).appearance).toEqual({ backdrop: "PHOTO", photoUrl: photo });
  });
});
