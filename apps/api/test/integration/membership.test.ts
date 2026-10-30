import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROFILE, auth, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

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

    const blocked = await api().get(`/api/v1/t/${tenant.slug}/notifications`).set(auth(session.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("MEMBERSHIP_PENDING");

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

    const blocked = await api().get(`${base}/notifications`).set(auth(session.accessToken));
    expect(blocked.body.error).toMatchObject({ code: "MEMBERSHIP_REJECTED", details: { statusReason: "Batch could not be verified" } });

    const reapply = await api().post(`${base}/memberships`).set(auth(session.accessToken)).send({ ...PROFILE, batchYear: 2013 });
    expect(reapply.status).toBe(201);
    expect(reapply.body.data).toMatchObject({ id, status: "PENDING", batchYear: 2013, statusReason: null });

    await api().post(`${base}/admin/members/${id}/approve`).set(admin.headers);
    const suspend = await api().post(`${base}/admin/members/${id}/suspend`).set(admin.headers).send({ reason: "Spam" });
    expect(suspend.body.data.status).toBe("SUSPENDED");
    const suspended = await api().get(`${base}/notifications`).set(auth(session.accessToken));
    expect(suspended.body.error.code).toBe("MEMBERSHIP_SUSPENDED");

    const reinstate = await api().post(`${base}/admin/members/${id}/reinstate`).set(admin.headers);
    expect(reinstate.body.data.status).toBe("APPROVED");
    expect((await api().get(`${base}/notifications`).set(auth(session.accessToken))).status).toBe(200);
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
      .send({ city: "Pune", bio: "Hello", interests: ["chess"], linkedinUrl: "https://www.linkedin.com/in/test", isPhoneVisible: true, extra: { hobby: "trekking" } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ city: "Pune", bio: "Hello", interests: ["chess"], isPhoneVisible: true, extra: { hobby: "trekking" } });
    const bad = await api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers).send({ linkedinUrl: "https://example.com/x" });
    expect(bad.status).toBe(400);
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
