import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { memberships, uploads } from "../../src/db/schema";
import { runInTransaction } from "../../src/lib/transaction";
import { updateMembership } from "../../src/repositories/memberships.repo";
import { updateMyProfile } from "../../src/services/membership.service";
import { S3Storage } from "../../src/services/storage";
import { loadTenantContext } from "../../src/services/tenant.service";
import { UNSAVED_AVATAR_GRACE_MS, applyAvatarChange, removeAvatarsIfUnused, sweepUnusedAvatars } from "../../src/services/uploads.service";
import { PROFILE, auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { testPng } from "../helpers/images";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const PNG = await testPng();

describe.skipIf(!dbAvailable)("membership + approval", () => {
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

  it("auto-approves registration in AUTO_APPROVE tenants", async () => {
    const { tenant } = await createTenant(ctx, { slug: "auto-u", memberApprovalMode: "AUTO_APPROVE" });
    const user = await createUser(ctx);
    const session = await loginAs(ctx, user.phoneE164);

    const before = await api().get(`/api/v1/t/${tenant.slug}/memberships/me`).set(auth(session.accessToken));
    expect(before.status).toBe(404);
    expect(before.body.error.code).toBe("NOT_A_MEMBER");

    const reg = await api().post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    expect(reg.status).toBe(201);
    expect(reg.body.data).toMatchObject({ status: "APPROVED", role: "MEMBER", fullName: "Test Member" });

    const me = await api().get(`/api/v1/t/${tenant.slug}/memberships/me`).set(auth(session.accessToken));
    expect(me.body.data.status).toBe("APPROVED");

    const notifications = await api().get(`/api/v1/t/${tenant.slug}/notifications`).set(auth(session.accessToken));
    expect(notifications.status).toBe(200);

    const globalMe = await api().get("/api/v1/me").set(auth(session.accessToken));
    expect(globalMe.body.data.memberships[0]).toMatchObject({ status: "APPROVED", tenant: { slug: "auto-u" } });
    expect(globalMe.body.data.user.displayName).toBe("Test Member");

    const dup = await api().post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    expect(dup.status).toBe(409);
  });

  it("holds registrations for admin approval, notifies admins and unlocks on approval", async () => {
    const { tenant } = await createTenant(ctx, { slug: "manual-c", memberApprovalMode: "ADMIN_APPROVAL" });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const user = await createUser(ctx);
    const session = await loginAs(ctx, user.phoneE164);

    const reg = await api().post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    expect(reg.status).toBe(201);
    expect(reg.body.data.status).toBe("PENDING");
    const membershipId = reg.body.data.id as string;

    // Member areas stay closed while pending; their own notifications stay readable.
    const blocked = await api().get(`/api/v1/t/${tenant.slug}/posts`).set(auth(session.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("MEMBERSHIP_PENDING");
    expect((await api().get(`/api/v1/t/${tenant.slug}/notifications`).set(auth(session.accessToken))).status).toBe(200);

    const adminNotifs = await api().get(`/api/v1/t/${tenant.slug}/notifications`).set(admin.headers);
    expect(adminNotifs.body.data[0]).toMatchObject({ type: "NEW_MEMBER_PENDING", data: { membershipId } });

    const dashboard = await api().get(`/api/v1/t/${tenant.slug}/admin/dashboard`).set(admin.headers);
    expect(dashboard.body.data).toMatchObject({ pendingMembers: 1, approvedMembers: 1 });

    const pending = await api().get(`/api/v1/t/${tenant.slug}/admin/members?status=PENDING`).set(admin.headers);
    expect(pending.body.total).toBe(1);
    expect(pending.body.data[0]).toMatchObject({ id: membershipId, phone: user.phoneE164 });

    const approve = await api().post(`/api/v1/t/${tenant.slug}/admin/members/${membershipId}/approve`).set(admin.headers);
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("APPROVED");

    const unlocked = await api().get(`/api/v1/t/${tenant.slug}/notifications`).set(auth(session.accessToken));
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.data[0]).toMatchObject({ type: "MEMBERSHIP_APPROVED", readAt: null });

    const unread = await api().get(`/api/v1/t/${tenant.slug}/notifications/unread-count`).set(auth(session.accessToken));
    expect(unread.body.data.count).toBe(1);

    const detail = await api().get(`/api/v1/t/${tenant.slug}/admin/members/${membershipId}`).set(admin.headers);
    expect(detail.body.data.audit.map((a: { action: string }) => a.action)).toContain("membership.approve");

    const again = await api().post(`/api/v1/t/${tenant.slug}/admin/members/${membershipId}/approve`).set(admin.headers);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("supports reject → reapply, suspend → reinstate, and reasons", async () => {
    const { tenant } = await createTenant(ctx, { slug: "manual-c", memberApprovalMode: "ADMIN_APPROVAL" });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const user = await createUser(ctx);
    const session = await loginAs(ctx, user.phoneE164);
    const base = `/api/v1/t/${tenant.slug}`;

    const reg = await api().post(`${base}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    const id = reg.body.data.id;

    const noReason = await api().post(`${base}/admin/members/${id}/reject`).set(admin.headers).send({});
    expect(noReason.status).toBe(400);

    const reject = await api().post(`${base}/admin/members/${id}/reject`).set(admin.headers).send({ reason: "Batch could not be verified" });
    expect(reject.body.data).toMatchObject({ status: "REJECTED", statusReason: "Batch could not be verified" });

    const blocked = await api().get(`${base}/posts`).set(auth(session.accessToken));
    expect(blocked.body.error).toMatchObject({ code: "MEMBERSHIP_REJECTED", details: { statusReason: "Batch could not be verified" } });
    // The rejection, with its reason, is waiting in their notifications.
    const own = await api().get(`${base}/notifications`).set(auth(session.accessToken));
    expect(own.body.data[0]).toMatchObject({ type: "MEMBERSHIP_REJECTED" });

    const reapply = await api().post(`${base}/memberships`).set(auth(session.accessToken)).send({ ...PROFILE, batchYear: 2013 });
    expect(reapply.status).toBe(201);
    expect(reapply.body.data).toMatchObject({ id, status: "PENDING", batchYear: 2013, statusReason: null });

    await api().post(`${base}/admin/members/${id}/approve`).set(admin.headers);
    const suspend = await api().post(`${base}/admin/members/${id}/suspend`).set(admin.headers).send({ reason: "Spam" });
    expect(suspend.body.data.status).toBe("SUSPENDED");
    const suspended = await api().get(`${base}/posts`).set(auth(session.accessToken));
    expect(suspended.body.error.code).toBe("MEMBERSHIP_SUSPENDED");
    const notice = await api().get(`${base}/notifications`).set(auth(session.accessToken));
    expect(notice.body.data[0]).toMatchObject({ type: "MEMBERSHIP_SUSPENDED" });

    const reinstate = await api().post(`${base}/admin/members/${id}/reinstate`).set(admin.headers);
    expect(reinstate.body.data.status).toBe("APPROVED");
    expect((await api().get(`${base}/posts`).set(auth(session.accessToken))).status).toBe(200);
  });

  it("bulk-approves pending members", async () => {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    for (let i = 0; i < 3; i++) {
      const user = await createUser(ctx);
      const session = await loginAs(ctx, user.phoneE164);
      await api().post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    }
    const res = await api().post(`/api/v1/t/${tenant.slug}/admin/members/approve-all-pending`).set(admin.headers);
    expect(res.body.data.approved).toBe(3);
    const dashboard = await api().get(`/api/v1/t/${tenant.slug}/admin/dashboard`).set(admin.headers);
    expect(dashboard.body.data).toMatchObject({ pendingMembers: 0, approvedMembers: 4 });
  });

  it("enforces role and tenant boundaries", async () => {
    const { tenant: a } = await createTenant(ctx, { slug: "tenant-a" });
    const { tenant: b } = await createTenant(ctx, { slug: "tenant-b" });
    const member = await memberSession(ctx, a.id);
    const admin = await memberSession(ctx, a.id, { role: "TENANT_ADMIN" });

    // member cannot use admin routes
    expect((await api().get(`/api/v1/t/${a.slug}/admin/members`).set(member.headers)).status).toBe(403);
    // membership in A grants nothing in B
    const crossed = await api().get(`/api/v1/t/${b.slug}/notifications`).set(member.headers);
    expect(crossed.body.error.code).toBe("NOT_A_MEMBER");
    expect((await api().get(`/api/v1/t/${b.slug}/admin/members`).set(admin.headers)).status).toBe(403);
    // admin cannot act on themselves
    const self = await api().post(`/api/v1/t/${a.slug}/admin/members/${admin.membership.id}/suspend`).set(admin.headers).send({ reason: "self test" });
    expect(self.status).toBe(403);
    // admin promotes member, member can now access admin routes
    const promote = await api().patch(`/api/v1/t/${a.slug}/admin/members/${member.membership.id}/role`).set(admin.headers).send({ role: "TENANT_ADMIN" });
    expect(promote.body.data.role).toBe("TENANT_ADMIN");
    expect((await api().get(`/api/v1/t/${a.slug}/admin/members`).set(member.headers)).status).toBe(200);
    // platform admin can use admin routes without a membership
    const platform = await loginAs(ctx, "+919999999999");
    expect((await api().get(`/api/v1/t/${b.slug}/admin/members`).set(auth(platform.accessToken))).status).toBe(200);
    // unknown tenant
    expect((await api().get(`/api/v1/t/nope/memberships/me`).set(member.headers)).status).toBe(404);
  });

  it("validates registration input against tenant settings", async () => {
    const { tenant } = await createTenant(ctx, { slug: "closed", allowSelfRegistration: false });
    const user = await createUser(ctx);
    const session = await loginAs(ctx, user.phoneE164);
    const closed = await api().post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    expect(closed.status).toBe(403);
    expect(closed.body.error.code).toBe("REGISTRATION_CLOSED");

    const { tenant: open } = await createTenant(ctx, { slug: "open" });
    const badYear = await api().post(`/api/v1/t/${open.slug}/memberships`).set(auth(session.accessToken)).send({ ...PROFILE, batchYear: 1900 });
    expect(badYear.status).toBe(400);
    const badBody = await api().post(`/api/v1/t/${open.slug}/memberships`).set(auth(session.accessToken)).send({ fullName: "x" });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error.code).toBe("VALIDATION_ERROR");

    const { tenant: suspended } = await createTenant(ctx, { slug: "gone", status: "SUSPENDED" });
    const inactive = await api().post(`/api/v1/t/${suspended.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    expect(inactive.status).toBe(403);
    expect(inactive.body.error.code).toBe("TENANT_INACTIVE");
  });

  it("lets members update their own profile", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    const res = await api()
      .patch(`/api/v1/t/${tenant.slug}/memberships/me`)
      .set(member.headers)
      // An unknown `extra` key is stripped rather than stored (custom profile fields replaced it).
      .send({ city: "Pune", bio: "Hello", interests: ["chess"], linkedinUrl: "https://www.linkedin.com/in/test", isPhoneVisible: true, extra: { hobby: "trekking" } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ city: "Pune", bio: "Hello", interests: ["chess"], isPhoneVisible: true, fields: [] });
    expect(res.body.data).not.toHaveProperty("extra");
    const bad = await api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers).send({ linkedinUrl: "https://example.com/x" });
    expect(bad.status).toBe(400);
  });

  describe("profile photos", () => {
    type Headers = Record<string, string>;
    const uploadPhoto = async (slug: string, headers: Headers, purpose: "avatar" | "image" = "avatar") => {
      const res = await api().post(`/api/v1/t/${slug}/uploads?purpose=${purpose}`).set(headers).attach("file", PNG, { filename: "me.png", contentType: "image/png" });
      expect(res.status).toBe(201);
      return res.body.data.url as string;
    };
    const keyOf = (url: string) => ctx.storage.keyFromUrl(url)!;
    const stored = (url: string) => existsSync(join(ctx.config.uploadDirAbsolute, keyOf(url)));
    const ledgerRow = async (url: string) => (await ctx.db.select().from(uploads).where(eq(uploads.storageKey, keyOf(url))))[0];
    const expectPhotoRefused = (res: request.Response) => {
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: "avatarUrl", message: expect.any(String) }]);
    };

    it("takes only the member's own avatar upload here as a new photo, and keeps an unchanged older one", async () => {
      const { tenant: a } = await createTenant(ctx);
      const { tenant: b } = await createTenant(ctx);
      const member = await memberSession(ctx, a.id);
      await createMembership(ctx, b.id, member.user.id);
      const other = await memberSession(ctx, a.id);
      const patch = (body: object) => api().patch(`/api/v1/t/${a.slug}/memberships/me`).set(member.headers).send(body);

      // A photo saved before the rule (an outside URL) survives edits that send it back unchanged...
      const legacy = "https://cdn.example.com/photos/old.jpg";
      await ctx.db.update(memberships).set({ avatarUrl: legacy }).where(eq(memberships.id, member.membership.id));
      const unchanged = await patch({ city: "Pune", avatarUrl: legacy });
      expect(unchanged.status).toBe(200);
      expect(unchanged.body.data).toMatchObject({ city: "Pune", avatarUrl: legacy });
      // ...but nothing outside can replace it.
      expectPhotoRefused(await patch({ avatarUrl: "https://tracker.example.com/pixel.jpg" }));
      expectPhotoRefused(await patch({ avatarUrl: await uploadPhoto(b.slug, member.headers) })); // their own, at another institution
      expectPhotoRefused(await patch({ avatarUrl: await uploadPhoto(a.slug, other.headers) })); // someone else's
      expectPhotoRefused(await patch({ avatarUrl: await uploadPhoto(a.slug, member.headers, "image") })); // not uploaded as a photo
      expect((await api().get(`/api/v1/t/${a.slug}/memberships/me`).set(member.headers)).body.data.avatarUrl).toBe(legacy);

      const mine = await uploadPhoto(a.slug, member.headers);
      const changed = await patch({ avatarUrl: mine });
      expect(changed.status).toBe(200);
      expect(changed.body.data.avatarUrl).toBe(mine);

      // Registering follows the same rule.
      const newcomer = auth((await loginAs(ctx, (await createUser(ctx)).phoneE164)).accessToken);
      expectPhotoRefused(await api().post(`/api/v1/t/${a.slug}/memberships`).set(newcomer).send({ ...PROFILE, avatarUrl: "https://tracker.example.com/pixel.jpg" }));
      const own = await uploadPhoto(a.slug, newcomer);
      expect((await api().post(`/api/v1/t/${a.slug}/memberships`).set(newcomer).send({ ...PROFILE, avatarUrl: own })).body.data.avatarUrl).toBe(own);
    });

    it("lets an admin give a member a photo the admin or the member uploaded, and no one else's", async () => {
      const { tenant } = await createTenant(ctx);
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const member = await memberSession(ctx, tenant.id);
      const third = await memberSession(ctx, tenant.id);
      const edit = (avatarUrl: string) => api().patch(`/api/v1/t/${tenant.slug}/admin/members/${member.membership.id}/profile`).set(admin.headers).send({ avatarUrl });

      expectPhotoRefused(await edit(await uploadPhoto(tenant.slug, third.headers)));
      const byAdmin = await uploadPhoto(tenant.slug, admin.headers);
      const res = await edit(byAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.avatarUrl).toBe(byAdmin);
      const byMember = await uploadPhoto(tenant.slug, member.headers);
      expect((await edit(byMember)).body.data.avatarUrl).toBe(byMember);
      // The admin's photo it replaced is gone.
      expect(stored(byAdmin)).toBe(false);
    });

    it("deletes a replaced or removed photo once no profile shows it", async () => {
      const { tenant } = await createTenant(ctx);
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const member = await memberSession(ctx, tenant.id);
      const patch = (headers: Headers, avatarUrl: string | null) => api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(headers).send({ avatarUrl });

      const first = await uploadPhoto(tenant.slug, member.headers);
      expect((await patch(member.headers, first)).status).toBe(200);
      const second = await uploadPhoto(tenant.slug, member.headers);
      expect((await patch(member.headers, second)).status).toBe(200);
      expect(stored(first)).toBe(false);
      expect(await ledgerRow(first)).toBeUndefined();
      expect(stored(second)).toBe(true);
      expect(await ledgerRow(second)).toBeDefined();

      expect((await patch(member.headers, null)).body.data.avatarUrl).toBeNull();
      expect(stored(second)).toBe(false);
      expect(await ledgerRow(second)).toBeUndefined();

      // An image that was never uploaded as a photo (a profile from before the rule) is left alone when replaced.
      const postImage = await uploadPhoto(tenant.slug, member.headers, "image");
      await ctx.db.update(memberships).set({ avatarUrl: postImage }).where(eq(memberships.id, member.membership.id));
      expect((await patch(member.headers, await uploadPhoto(tenant.slug, member.headers))).status).toBe(200);
      expect(stored(postImage)).toBe(true);

      // A photo two profiles show stays until neither does.
      const shared = await uploadPhoto(tenant.slug, admin.headers);
      const other = await memberSession(ctx, tenant.id);
      for (const target of [member, other]) {
        const res = await api().patch(`/api/v1/t/${tenant.slug}/admin/members/${target.membership.id}/profile`).set(admin.headers).send({ avatarUrl: shared });
        expect(res.status).toBe(200);
      }
      await patch(member.headers, null);
      expect(stored(shared)).toBe(true);
      expect(await ledgerRow(shared)).toBeDefined();
      await patch(other.headers, null);
      expect(stored(shared)).toBe(false);
      expect(await ledgerRow(shared)).toBeUndefined();
    });

    it("deletes a person's photos with their account, except one another profile shows", async () => {
      const { tenant: a } = await createTenant(ctx);
      const { tenant: b } = await createTenant(ctx);
      const leaving = await memberSession(ctx, a.id, { role: "TENANT_ADMIN" });
      await createMembership(ctx, b.id, leaving.user.id);
      const adminB = await memberSession(ctx, b.id, { role: "TENANT_ADMIN" });
      const colleague = await memberSession(ctx, a.id);

      const shown = await uploadPhoto(a.slug, leaving.headers);
      await api().patch(`/api/v1/t/${a.slug}/memberships/me`).set(leaving.headers).send({ avatarUrl: shown });
      const neverUsed = await uploadPhoto(a.slug, leaving.headers);
      const postImage = await uploadPhoto(a.slug, leaving.headers, "image");
      // At B, the photo was set by an admin.
      const setByAdmin = await uploadPhoto(b.slug, adminB.headers);
      const leavingAtB = (await ctx.db.select().from(memberships).where(eq(memberships.tenantId, b.id))).find((m) => m.userId === leaving.user.id)!;
      expect((await api().patch(`/api/v1/t/${b.slug}/admin/members/${leavingAtB.id}/profile`).set(adminB.headers).send({ avatarUrl: setByAdmin })).status).toBe(200);
      // As an admin at A, they gave a colleague a photo they uploaded.
      const forColleague = await uploadPhoto(a.slug, leaving.headers);
      expect((await api().patch(`/api/v1/t/${a.slug}/admin/members/${colleague.membership.id}/profile`).set(leaving.headers).send({ avatarUrl: forColleague })).status).toBe(200);

      expect((await api().post("/api/v1/me/delete").set(leaving.headers).send({ confirm: true })).status).toBe(204);

      for (const url of [shown, neverUsed, setByAdmin]) {
        expect(stored(url)).toBe(false);
        expect(await ledgerRow(url)).toBeUndefined();
      }
      expect(stored(postImage)).toBe(true);
      expect(await ledgerRow(postImage)).toMatchObject({ userId: null, purpose: "image" });
      expect(stored(forColleague)).toBe(true);
      expect(await ledgerRow(forColleague)).toMatchObject({ userId: null, purpose: "avatar" });
    });

    it("deletes a replaced photo from S3-compatible storage; a refused delete fails nothing and the sweep retries it", async () => {
      const commands: Array<{ input: { Key?: string } }> = [];
      let refuseDeletes = false;
      const s3 = new S3Storage({ bucket: "photos", region: "auto", forcePathStyle: true, publicBaseUrl: "https://photos.example.com" }, {
        send: async (command: { input: { Key?: string } }) => {
          if (refuseDeletes && command instanceof DeleteObjectCommand) throw new Error("S3 is unavailable");
          commands.push(command);
        },
      } as never);
      const previous = ctx.storage;
      ctx.storage = s3;
      try {
        const { tenant } = await createTenant(ctx);
        const member = await memberSession(ctx, tenant.id);
        const patch = (avatarUrl: string) => api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers).send({ avatarUrl });
        const deletedKeys = () => commands.filter((c) => c instanceof DeleteObjectCommand).map((c) => c.input.Key);

        const first = await uploadPhoto(tenant.slug, member.headers);
        expect(first).toMatch(/^https:\/\/photos\.example\.com\//);
        expect((await patch(first)).status).toBe(200);
        const second = await uploadPhoto(tenant.slug, member.headers);
        expect((await patch(second)).status).toBe(200);
        expect(deletedKeys()).toEqual([keyOf(first)]);
        expect(await ledgerRow(first)).toBeUndefined();

        // Storage refusing the delete doesn't fail the save. The old photo stays recorded, so it isn't lost track of.
        refuseDeletes = true;
        const third = await uploadPhoto(tenant.slug, member.headers);
        const saved = await patch(third);
        expect(saved.status).toBe(200);
        expect(saved.body.data.avatarUrl).toBe(third);
        expect(await ledgerRow(second)).toBeDefined();

        refuseDeletes = false;
        await ctx.db.update(uploads).set({ createdAt: new Date(Date.now() - UNSAVED_AVATAR_GRACE_MS - 60_000) });
        await ctx.jobs.runScheduled("avatar-sweep");
        expect(deletedKeys()).toEqual([keyOf(first), keyOf(second)]);
        expect(await ledgerRow(second)).toBeUndefined();
        expect(await ledgerRow(third)).toBeDefined();
      } finally {
        ctx.storage = previous;
      }
    });

    it("sweeps away photos that were picked but never saved, once they are old enough", async () => {
      const { tenant } = await createTenant(ctx);
      const member = await memberSession(ctx, tenant.id);
      const saved = await uploadPhoto(tenant.slug, member.headers);
      expect((await api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers).send({ avatarUrl: saved })).status).toBe(200);
      const unsaved = await uploadPhoto(tenant.slug, member.headers);
      const postImage = await uploadPhoto(tenant.slug, member.headers, "image");

      // Someone may still be filling in the form.
      expect(await sweepUnusedAvatars(ctx)).toEqual({ removed: 0 });
      expect(stored(unsaved)).toBe(true);

      expect(await sweepUnusedAvatars(ctx, new Date(Date.now() + UNSAVED_AVATAR_GRACE_MS + 60_000))).toEqual({ removed: 1 });
      expect(stored(unsaved)).toBe(false);
      expect(await ledgerRow(unsaved)).toBeUndefined();
      for (const url of [saved, postImage]) {
        expect(stored(url)).toBe(true);
        expect(await ledgerRow(url)).toBeDefined();
      }
    });

    it("keeps a photo that a save still in flight is about to show", async () => {
      const { tenant } = await createTenant(ctx);
      const member = await memberSession(ctx, tenant.id);
      const photo = await uploadPhoto(tenant.slug, member.headers);
      let cleanup: Promise<number> | undefined;
      await runInTransaction(ctx, async (tx) => {
        await applyAvatarChange(ctx, tx, tenant.id, { membershipId: member.membership.id, next: photo, uploaderIds: [member.user.id] });
        await updateMembership(tx, tenant.id, member.membership.id, { avatarUrl: photo });
        // Another request lets go of the same photo meanwhile, and its clean-up starts before this save commits.
        cleanup = removeAvatarsIfUnused(ctx, [keyOf(photo)]);
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      // It waited for the save, then saw the photo in use.
      expect(await cleanup).toBe(0);
      expect(stored(photo)).toBe(true);
      expect(await ledgerRow(photo)).toBeDefined();
    });

    it("checks a photo against the one saved now, not the one a request read before a change committed", async () => {
      const { tenant } = await createTenant(ctx);
      const member = await memberSession(ctx, tenant.id);
      const tenantCtx = await loadTenantContext(ctx, tenant.slug);
      const first = await uploadPhoto(tenant.slug, member.headers);
      const patch = (avatarUrl: string) => api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers).send({ avatarUrl });
      expect((await patch(first)).status).toBe(200);
      // A request that loaded the profile while it showed `first`...
      const loadedEarlier = { ...member.membership, avatarUrl: first };
      // ...saves after another one replaced it (and deleted `first`), sending `first` back unchanged as the form had it.
      expect((await patch(await uploadPhoto(tenant.slug, member.headers))).status).toBe(200);
      expect(stored(first)).toBe(false);
      await expect(updateMyProfile(ctx, tenantCtx, loadedEarlier, { city: "Pune", avatarUrl: first })).rejects.toMatchObject({ status: 400 });
      const now = (await api().get(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers)).body.data;
      expect(now.avatarUrl).not.toBe(first);
      expect(now.city).not.toBe("Pune");
    });
  });

  it("manages notifications read state", async () => {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    for (let i = 0; i < 2; i++) {
      const user = await createUser(ctx);
      const session = await loginAs(ctx, user.phoneE164);
      await api().post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    }
    const base = `/api/v1/t/${tenant.slug}/notifications`;
    const list = await api().get(`${base}?limit=1`).set(admin.headers);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.nextCursor).toBeTypeOf("string");
    const page2 = await api().get(`${base}?limit=1&cursor=${encodeURIComponent(list.body.nextCursor)}`).set(admin.headers);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].id).not.toBe(list.body.data[0].id);
    expect(page2.body.nextCursor).toBeNull();

    expect((await api().post(`${base}/${list.body.data[0].id}/read`).set(admin.headers)).status).toBe(204);
    expect((await api().get(`${base}/unread-count`).set(admin.headers)).body.data.count).toBe(1);
    expect((await api().get(`${base}?unreadOnly=true`).set(admin.headers)).body.data).toHaveLength(1);
    expect((await api().post(`${base}/read-all`).set(admin.headers)).status).toBe(204);
    expect((await api().get(`${base}/unread-count`).set(admin.headers)).body.data.count).toBe(0);
  });
});
