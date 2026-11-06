import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { auditLog, memberships, notifications, uploads } from "../../src/db/schema";
import { runInTransaction } from "../../src/lib/transaction";
import { updateMembership } from "../../src/repositories/memberships.repo";
import { updateMyProfile } from "../../src/services/membership.service";
import { S3Storage } from "../../src/services/storage";
import { loadTenantContext } from "../../src/services/tenant.service";
import { UNSAVED_AVATAR_GRACE_MS, applyAvatarChange, removeAvatarsIfUnused, sweepUnusedAvatars } from "../../src/services/uploads.service";
import { refusingAudit } from "../helpers/db";
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

  it("changes a member's status or role only together with its audit row", async () => {
    const { tenant } = await createTenant(ctx);
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const member = await memberSession(ctx, tenant.id);
    const base = `/api/v1/t/${tenant.slug}/admin/members/${member.membership.id}`;
    await refusingAudit(ctx, "membership.suspend", async () => {
      expect((await api().post(`${base}/suspend`).set(admin.headers).send({ reason: "Spam" })).status).toBe(500);
    });
    await refusingAudit(ctx, "membership.role_change", async () => {
      expect((await api().patch(`${base}/role`).set(admin.headers).send({ role: "TENANT_ADMIN" })).status).toBe(500);
    });
    const [row] = await ctx.db.select().from(memberships).where(eq(memberships.id, member.membership.id));
    expect(row).toMatchObject({ status: "APPROVED", role: "MEMBER", statusReason: null });
    expect(await ctx.db.select().from(notifications).where(eq(notifications.recipientMembershipId, member.membership.id))).toEqual([]);

    expect((await api().post(`${base}/suspend`).set(admin.headers).send({ reason: "Spam" })).status).toBe(200);
    const [audit] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "membership.suspend"));
    expect(audit).toMatchObject({ targetId: member.membership.id, actorMembershipId: admin.membership.id, metadata: { from: "APPROVED", to: "SUSPENDED", reason: "Spam" } });
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

  it("pages the members list in one fixed order, so members created in the same instant each show once", async () => {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const user = await createUser(ctx);
      ids.push((await createMembership(ctx, tenant.id, user.id, { status: "PENDING" })).id);
    }
    // One createdAt for all, as rows inserted by one statement have, so only the tiebreak orders them.
    await ctx.db.update(memberships).set({ createdAt: new Date("2026-01-01T00:00:00.000Z") }).where(inArray(memberships.id, ids));

    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await api().get(`/api/v1/t/${tenant.slug}/admin/members?status=PENDING&page=${page}&pageSize=2`).set(admin.headers);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(7);
      seen.push(...res.body.data.map((m: { id: string }) => m.id));
    }
    // Every member once across the pages, newest first and then by id, the same however Postgres reads the rows.
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toEqual([...ids].sort().reverse());
  });

  it("names who acted in a member's recent activity: the admin and the member by their names here, staff by none", async () => {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", fullName: "Asha Admin" });
    const staff = await createUser(ctx, { isPlatformAdmin: true });
    const user = await createUser(ctx);
    const session = await loginAs(ctx, user.phoneE164);
    const base = `/api/v1/t/${tenant.slug}`;
    const id = (await api().post(`${base}/memberships`).set(auth(session.accessToken)).send(PROFILE)).body.data.id as string;
    expect((await api().post(`${base}/admin/members/${id}/approve`).set(admin.headers)).status).toBe(200);
    // As Illuminize staff act at an institution they aren't a member of: a user, and no membership to name them by.
    await ctx.db.insert(auditLog).values({ tenantId: tenant.id, actorUserId: staff.id, action: "membership.role_change", targetType: "membership", targetId: id, metadata: { from: "MEMBER", to: "TENANT_ADMIN" } });

    const detail = await api().get(`${base}/admin/members/${id}`).set(admin.headers);
    expect(detail.status).toBe(200);
    const byAction = new Map((detail.body.data.audit as Array<{ action: string; actorName: string | null }>).map((a) => [a.action, a]));
    expect(byAction.get("membership.approve")).toMatchObject({ actorName: "Asha Admin", actorMembershipId: admin.membership.id });
    expect(byAction.get("membership.create")).toMatchObject({ actorName: "Test Member", actorMembershipId: id });
    expect(byAction.get("membership.role_change")).toMatchObject({ actorName: null, actorUserId: staff.id, actorMembershipId: null });
  });

  it("pages the audit log in one fixed order, so rows written in the same instant each show once", async () => {
    const { tenant } = await createTenant(ctx);
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    // One createdAt for all, as rows written in one transaction can have, so only the tiebreak orders them.
    const at = new Date("2026-01-01T00:00:00.000Z");
    const written = await ctx.db
      .insert(auditLog)
      .values(Array.from({ length: 7 }, (_, i) => ({ tenantId: tenant.id, actorMembershipId: admin.membership.id, action: "invitation.send", metadata: { count: i }, createdAt: at })))
      .returning({ id: auditLog.id });
    const ids = written.map((r) => r.id);

    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await api().get(`/api/v1/t/${tenant.slug}/admin/audit?action=invitation.&page=${page}&pageSize=2`).set(admin.headers);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(7);
      seen.push(...res.body.data.map((a: { id: string }) => a.id));
    }
    // Every row once across the pages, newest first and then by id, the same however Postgres reads the rows.
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toEqual([...ids].sort().reverse());
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

  describe("profile details", () => {
    const thisYear = new Date().getFullYear();
    const DETAILS = {
      headline: "  Builds payments\n at Zylo ",
      industry: "SOFTWARE_INTERNET",
      careerStartYear: 2014,
      skills: ["Go", " go ", "Distributed   systems", "SQL"],
      degree: "B.Tech",
      fieldOfStudy: "Computer Science",
      linkedinUrl: "https://www.linkedin.com/in/asha",
      websiteUrl: "https://asha.dev",
      githubUrl: "https://github.com/asha",
      instagramUrl: "https://www.instagram.com/asha",
      xUrl: "https://twitter.com/asha",
      openTo: ["INVESTING", "HIRING", "INVESTING"],
      experiences: [
        { company: "Acme", title: "Intern", startYear: 2013, endYear: 2014 },
        { company: "Blank Co", title: "Volunteer" },
        { company: "Zylo", title: "Engineer", startYear: 2018, endYear: 2022 },
      ],
      education: [
        { institution: "Coursera", degree: "" },
        { institution: "IIM Ahmedabad", degree: "MBA", fieldOfStudy: "Finance", startYear: 2022, endYear: 2024 },
      ],
    };
    // As stored: tidied, de-duplicated, newest first, blanks as null.
    const SAVED = {
      headline: "Builds payments at Zylo",
      industry: "SOFTWARE_INTERNET",
      careerStartYear: 2014,
      skills: ["Go", "Distributed systems", "SQL"],
      degree: "B.Tech",
      fieldOfStudy: "Computer Science",
      linkedinUrl: "https://www.linkedin.com/in/asha",
      // As the URL parser reads it.
      websiteUrl: "https://asha.dev/",
      githubUrl: "https://github.com/asha",
      instagramUrl: "https://www.instagram.com/asha",
      xUrl: "https://twitter.com/asha",
      openTo: ["HIRING", "INVESTING"],
      experiences: [
        { company: "Zylo", title: "Engineer", startYear: 2018, endYear: 2022 },
        { company: "Acme", title: "Intern", startYear: 2013, endYear: 2014 },
        { company: "Blank Co", title: "Volunteer", startYear: null, endYear: null },
      ],
      education: [
        { institution: "IIM Ahmedabad", degree: "MBA", fieldOfStudy: "Finance", startYear: 2022, endYear: 2024 },
        { institution: "Coursera", degree: null, fieldOfStudy: null, startYear: null, endYear: null },
      ],
    };
    const CLEARED = { headline: null, industry: null, careerStartYear: null, skills: [], openTo: [], experiences: [], education: [], githubUrl: null };

    it("round-trips every detail for the member and an admin, and leaves out what isn't sent", async () => {
      const { tenant } = await createTenant(ctx);
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const member = await memberSession(ctx, tenant.id);
      const base = `/api/v1/t/${tenant.slug}`;
      const patch = (body: object) => api().patch(`${base}/memberships/me`).set(member.headers).send(body);

      const saved = await patch(DETAILS);
      expect(saved.status).toBe(200);
      expect(saved.body.data).toMatchObject({ ...SAVED, profileNudgeDismissedAt: null });
      expect((await api().get(`${base}/memberships/me`).set(member.headers)).body.data).toMatchObject(SAVED);
      const row = (await ctx.db.select().from(memberships).where(eq(memberships.id, member.membership.id)))[0]!;
      expect(row).toMatchObject(SAVED);

      // Leaving the details out of an edit leaves them alone.
      expect((await patch({ city: "Pune" })).body.data).toMatchObject({ ...SAVED, city: "Pune" });

      const asAdmin = await api().get(`${base}/admin/members/${member.membership.id}`).set(admin.headers);
      expect(asAdmin.body.data).toMatchObject(SAVED);
      expect(asAdmin.body.data).not.toHaveProperty("profileNudgeDismissedAt");

      // An admin's edit takes them too, and sorts and tidies the same way.
      const edited = await api()
        .patch(`${base}/admin/members/${member.membership.id}/profile`)
        .set(admin.headers)
        .send({ headline: "Head of payments", experiences: [{ company: "Old", title: "Clerk", startYear: 2001, endYear: 2002 }, ...DETAILS.experiences] });
      expect(edited.status).toBe(200);
      expect(edited.body.data).toMatchObject({ headline: "Head of payments", experiences: [...SAVED.experiences.slice(0, 2), { company: "Old", title: "Clerk", startYear: 2001, endYear: 2002 }, SAVED.experiences[2]] });

      // Empty lists and nulls clear them.
      expect((await patch(CLEARED)).body.data).toMatchObject(CLEARED);
    });

    it("replaces the lists, rather than adding to them, when someone registers again after a rejection", async () => {
      const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const session = auth((await loginAs(ctx, (await createUser(ctx)).phoneE164)).accessToken);
      const base = `/api/v1/t/${tenant.slug}`;

      const first = await api().post(`${base}/memberships`).set(session).send({ ...PROFILE, ...DETAILS });
      expect(first.status).toBe(201);
      expect(first.body.data).toMatchObject({ status: "PENDING", ...SAVED });
      await api().post(`${base}/admin/members/${first.body.data.id}/reject`).set(admin.headers).send({ reason: "Batch could not be verified" });

      const again = await api()
        .post(`${base}/memberships`)
        .set(session)
        .send({ ...PROFILE, skills: ["Rust"], experiences: [{ company: "Nimbus", title: "SRE", startYear: 2023 }], education: [], openTo: ["COLLABORATING"] });
      expect(again.status).toBe(201);
      expect(again.body.data).toMatchObject({
        id: first.body.data.id,
        status: "PENDING",
        skills: ["Rust"],
        experiences: [{ company: "Nimbus", title: "SRE", startYear: 2023, endYear: null }],
        education: [],
        openTo: ["COLLABORATING"],
        // Not sent again, so kept.
        headline: SAVED.headline,
        githubUrl: SAVED.githubUrl,
      });
    });

    it("refuses bad details, naming each one's place", async () => {
      const { tenant } = await createTenant(ctx);
      const member = await memberSession(ctx, tenant.id);
      const pathsOf = async (body: object) => {
        const res = await api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers).send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        return (res.body.error.details as Array<{ path: string }>).map((d) => d.path);
      };
      const role = { company: "Acme", title: "Engineer" };
      expect(await pathsOf({ experiences: [role, { ...role, startYear: 2015, endYear: 2012 }] })).toEqual(["experiences.1.endYear"]);
      expect(await pathsOf({ experiences: [{ ...role, company: "x".repeat(121) }] })).toEqual(["experiences.0.company"]);
      expect(await pathsOf({ experiences: [{ company: "Acme" }] })).toEqual(["experiences.0.title"]);
      expect(await pathsOf({ experiences: Array.from({ length: 16 }, () => role) })).toEqual(["experiences"]);
      expect(await pathsOf({ education: [{ institution: "IIM", endYear: thisYear + 11 }] })).toEqual(["education.0.endYear"]);
      expect(await pathsOf({ education: [{ institution: "IIM", degree: "x".repeat(81) }] })).toEqual(["education.0.degree"]);
      expect(await pathsOf({ education: Array.from({ length: 11 }, () => ({ institution: "IIM" })) })).toEqual(["education"]);
      expect(await pathsOf({ careerStartYear: thisYear + 1 })).toEqual(["careerStartYear"]);
      expect(await pathsOf({ skills: ["Go", "x".repeat(41)] })).toEqual(["skills.1"]);
      expect(await pathsOf({ skills: Array.from({ length: 21 }, (_, i) => `Skill ${i}`) })).toEqual(["skills"]);
      expect(await pathsOf({ headline: "x".repeat(121) })).toEqual(["headline"]);
      expect(await pathsOf({ degree: "x".repeat(81) })).toEqual(["degree"]);
      expect(await pathsOf({ industry: "MINING" })).toEqual(["industry"]);
      expect(await pathsOf({ openTo: ["MENTORING"] })).toEqual(["openTo.0"]);
      // Nothing was saved along the way.
      const me = (await api().get(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers)).body.data;
      expect(me).toMatchObject({ experiences: [], education: [], skills: [], careerStartYear: null, headline: null, industry: null, openTo: [] });
    });

    it("checks each link's host, refuses credentials in links, and takes URLs only", async () => {
      const { tenant } = await createTenant(ctx);
      const member = await memberSession(ctx, tenant.id);
      const patch = (body: object) => api().patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers).send(body);
      const refused = async (body: Record<string, string>) => {
        const res = await patch(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect([...new Set(res.body.error.details.map((d: { path: string }) => d.path))]).toEqual(Object.keys(body));
      };
      await refused({ linkedinUrl: "https://evil.com/?linkedin.com/" });
      await refused({ linkedinUrl: "https://linkedin.com.evil.com/in/asha" });
      await refused({ linkedinUrl: "https://user:secret@www.linkedin.com/in/asha" });
      await refused({ githubUrl: "https://gitlab.com/asha" });
      await refused({ instagramUrl: "https://evil.com/instagram.com/asha" });
      await refused({ xUrl: "https://xx.com/asha" });
      await refused({ websiteUrl: "https://google.com@evil.com/" });
      await refused({ websiteUrl: "javascript:alert(1)" });
      // "@handle" is turned into a URL by the forms (socialUrlFromInput); the API takes URLs only.
      await refused({ githubUrl: "@asha" });
      await refused({ xUrl: "asha" });

      const ok = await patch({ linkedinUrl: "https://in.linkedin.com/in/asha", xUrl: "https://x.com/asha", githubUrl: "http://github.com/asha", websiteUrl: "https://blog.asha.dev/about" });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ linkedinUrl: "https://in.linkedin.com/in/asha", xUrl: "https://x.com/asha", githubUrl: "http://github.com/asha", websiteUrl: "https://blog.asha.dev/about" });
      expect((await patch({ xUrl: "https://mobile.twitter.com/asha" })).status).toBe(200);

      // Stored as the URL parser read it, so an app that reads the text another way still opens the site checked. A
      // browser reads "linkedin.com\@evil.com" as linkedin.com and iOS as evil.com; stored, it's linkedin.com to both.
      const read = await patch({
        linkedinUrl: "https://linkedin.com\\@evil.com",
        githubUrl: "https://GitHub.com/Asha",
        websiteUrl: "https://asha.dev/‮gnp.exe",
        instagramUrl: "https://instagram.com",
      });
      expect(read.status).toBe(200);
      expect(read.body.data).toMatchObject({
        linkedinUrl: "https://linkedin.com/@evil.com",
        githubUrl: "https://github.com/Asha",
        websiteUrl: "https://asha.dev/%E2%80%AEgnp.exe",
        instagramUrl: "https://instagram.com/",
      });
      const row = (await ctx.db.select().from(memberships).where(eq(memberships.id, member.membership.id)))[0]!;
      expect(row.linkedinUrl).toBe("https://linkedin.com/@evil.com");
      // The 500-character limit is on the link as stored.
      await refused({ websiteUrl: `https://asha.dev/${"é".repeat(100)}` });
    });

    it("clears Open to whenever a current pupil's profile is saved, however they became one", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", batchYear: 1990 });
      const pupil = await memberSession(ctx, tenant.id, { batchYear: thisYear + 2 });
      const alum = await memberSession(ctx, tenant.id, { batchYear: 2005 });
      const base = `/api/v1/t/${tenant.slug}`;
      const stored = async (id: string) => (await ctx.db.select().from(memberships).where(eq(memberships.id, id)))[0]!.openTo;

      const pupilSave = await api().patch(`${base}/memberships/me`).set(pupil.headers).send({ openTo: ["HIRING"], headline: "Captain of the chess club" });
      expect(pupilSave.status).toBe(200);
      expect(pupilSave.body.data).toMatchObject({ openTo: [], headline: "Captain of the chess club" });
      expect(await stored(pupil.membership.id)).toEqual([]);

      // An alum of the same school keeps it, until a change of date of birth makes them a pupil.
      expect((await api().patch(`${base}/memberships/me`).set(alum.headers).send({ openTo: ["HIRING", "INVESTING"] })).body.data.openTo).toEqual(["HIRING", "INVESTING"]);
      const underAge = `${thisYear - 15}-01-01`;
      expect((await api().patch(`${base}/memberships/me`).set(alum.headers).send({ dateOfBirth: underAge })).body.data.openTo).toEqual([]);
      expect(await stored(alum.membership.id)).toEqual([]);

      // An admin's edit that makes someone a pupil clears it too.
      const other = await memberSession(ctx, tenant.id, { batchYear: 2008 });
      await api().patch(`${base}/memberships/me`).set(other.headers).send({ openTo: ["COLLABORATING"] });
      const byAdmin = await api().patch(`${base}/admin/members/${other.membership.id}/profile`).set(admin.headers).send({ batchYear: thisYear + 1 });
      expect(byAdmin.status).toBe(200);
      expect(byAdmin.body.data.openTo).toEqual([]);
      expect(await stored(other.membership.id)).toEqual([]);

      // And so does registering as one.
      const newcomer = auth((await loginAs(ctx, (await createUser(ctx)).phoneE164)).accessToken);
      const registered = await api().post(`${base}/memberships`).set(newcomer).send({ ...PROFILE, batchYear: thisYear + 3, openTo: ["HIRING"] });
      expect(registered.status).toBe(201);
      expect(registered.body.data.openTo).toEqual([]);
    });

    it("stores no degree or field of study at a school, whatever is sent, and keeps the rest", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", batchYear: 1990 });
      const alum = await memberSession(ctx, tenant.id, { batchYear: 2005 });
      const base = `/api/v1/t/${tenant.slug}`;
      const own = await api().patch(`${base}/memberships/me`).set(alum.headers).send({ degree: "B.Sc", fieldOfStudy: "Physics", headline: "Teacher" });
      expect(own.status).toBe(200);
      expect(own.body.data).toMatchObject({ degree: null, fieldOfStudy: null, headline: "Teacher" });
      const byAdmin = await api().patch(`${base}/admin/members/${alum.membership.id}/profile`).set(admin.headers).send({ degree: "B.Sc", fieldOfStudy: "Physics" });
      expect(byAdmin.body.data).toMatchObject({ degree: null, fieldOfStudy: null });
      const newcomer = auth((await loginAs(ctx, (await createUser(ctx)).phoneE164)).accessToken);
      const registered = await api().post(`${base}/memberships`).set(newcomer).send({ ...PROFILE, degree: "B.Sc", fieldOfStudy: "Physics", skills: ["Teaching"] });
      expect(registered.body.data).toMatchObject({ degree: null, fieldOfStudy: null, skills: ["Teaching"] });

      // A college keeps them.
      const { tenant: college } = await createTenant(ctx);
      const student = await memberSession(ctx, college.id);
      expect((await api().patch(`/api/v1/t/${college.slug}/memberships/me`).set(student.headers).send({ degree: "B.Sc", fieldOfStudy: "Physics" })).body.data).toMatchObject({
        degree: "B.Sc",
        fieldOfStudy: "Physics",
      });
    });

    it("snoozes the profile-strength card for an approved member, without counting as a profile change", async () => {
      const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
      const member = await memberSession(ctx, tenant.id);
      const dismiss = (headers: Record<string, string>) => api().post(`/api/v1/t/${tenant.slug}/memberships/me/profile-nudge/dismiss`).set(headers);
      const before = (await api().get(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers)).body.data;
      expect(before.profileNudgeDismissedAt).toBeNull();

      const started = Date.now();
      const res = await dismiss(member.headers);
      expect(res.status).toBe(200);
      const at = Date.parse(res.body.data.profileNudgeDismissedAt);
      expect(at).toBeGreaterThanOrEqual(started - 1000);
      expect(at).toBeLessThanOrEqual(Date.now() + 1000);
      expect(res.body.data.updatedAt).toBe(before.updatedAt);
      expect((await api().get(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers)).body.data.profileNudgeDismissedAt).toBe(res.body.data.profileNudgeDismissedAt);

      // Only for approved members.
      const applicant = auth((await loginAs(ctx, (await createUser(ctx)).phoneE164)).accessToken);
      expect((await dismiss(applicant)).body.error.code).toBe("NOT_A_MEMBER");
      await api().post(`/api/v1/t/${tenant.slug}/memberships`).set(applicant).send(PROFILE);
      const pending = await dismiss(applicant);
      expect(pending.status).toBe(403);
      expect(pending.body.error.code).toBe("MEMBERSHIP_PENDING");
    });
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
