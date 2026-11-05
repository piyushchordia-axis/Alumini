import { notificationTarget, type NotificationDto } from "@illuminize/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROFILE, auth, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

/** The phone app opens an admin notice's console screen from the ids its payload carries, so they must survive the target's checks. */
describe.skipIf(!dbAvailable)("admin notices' targets", () => {
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

  it("carry the ids of the member, item or report each notice is about", async () => {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL", contentModerationMode: "ADMIN_APPROVAL" });
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const member = await memberSession(ctx, tenant.id);
    const latest = async () => {
      const [notice] = (await api().get(`${base}/notifications`).set(admin.headers)).body.data as NotificationDto[];
      return notificationTarget(notice!.type, notice!.data);
    };

    const user = await createUser(ctx);
    const session = await loginAs(ctx, user.phoneE164);
    const joined = await api().post(`${base}/memberships`).set(auth(session.accessToken)).send(PROFILE).expect(201);
    expect(await latest()).toStrictEqual({ kind: "admin", section: "members", membershipId: joined.body.data.id });

    const post = await api().post(`${base}/posts`).set(member.headers).send({ body: "Waiting for an admin" }).expect(201);
    expect(await latest()).toStrictEqual({ kind: "admin", section: "moderation", contentType: "POST", contentId: post.body.data.id });

    const published = await api().post(`${base}/posts`).set(admin.headers).send({ body: "Published at once" }).expect(201);
    const report = await api().post(`${base}/reports`).set(member.headers).send({ contentType: "POST", contentId: published.body.data.id, reason: "SPAM" }).expect(201);
    expect(await latest()).toStrictEqual({ kind: "admin", section: "reports", reportId: report.body.data.id, contentType: "POST", contentId: published.body.data.id });
  });
});
