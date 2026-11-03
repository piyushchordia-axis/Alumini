import type { ChatConversationDto } from "@illuminize/shared";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatBlocks, chatConversations, chatReports, contentReports, memberships } from "../../src/db/schema";
import { acceptedThread, chatApi, createGroup, groupsApi, openRequest, postToGroup, type Session } from "../helpers/chat";
import { auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("chat between institutions", () => {
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

  async function twoTenants() {
    const one = (await createTenant(ctx)).tenant;
    const two = (await createTenant(ctx)).tenant;
    const a = await memberSession(ctx, one.id);
    const b = await memberSession(ctx, one.id);
    const outsider = await memberSession(ctx, two.id);
    const id = await acceptedThread(ctx, one.slug, a, b);
    const { body } = await chatApi(ctx, one.slug, b).send(id, "Private to this institution");
    return { one, two, a, b, outsider, id, messageId: body.data.id as string };
  }

  it("answers 404 for another institution's member, conversation and message, through this slug", async () => {
    const { two, a, b, outsider, id, messageId } = await twoTenants();
    const api = chatApi(ctx, two.slug, outsider);
    for (const res of [
      await api.direct(a.membership.id),
      await api.get(id),
      await api.messages(id),
      await api.send(id),
      await api.read(id, 1),
      await api.mute(id, null),
      await api.accept(id),
      await api.decline(id),
      await api.report(messageId),
      await api.block(b.membership.id),
      await api.unblock(b.membership.id),
    ]) {
      expect(res.status, res.request.url).toBe(404);
    }
    expect(await ctx.db.select().from(chatBlocks)).toEqual([]);
    expect(await ctx.db.select().from(chatReports)).toEqual([]);
    expect(await ctx.db.select().from(chatConversations).where(eq(chatConversations.tenantId, two.id))).toEqual([]);
    expect((await api.list()).body.data).toEqual([]);
    expect((await api.badge()).body.data).toEqual({ unread: 0, requests: 0, invites: 0 });
  });

  it("answers 404 for another institution's group, open or invite-only, on every group route and through content reports", async () => {
    const { one, two, a, b, outsider } = await twoTenants();
    const groups = groupsApi(ctx, two.slug, outsider);
    for (const visibility of ["OPEN", "INVITE_ONLY"] as const) {
      const group = await createGroup(ctx, one.slug, a, { name: `Group ${visibility}`, visibility });
      await groupsApi(ctx, one.slug, a).invite(group.id, [b.membership.id]);
      for (const res of [
        await groups.get(group.id),
        await groups.members(group.id),
        await groups.candidates(group.id),
        await groups.join(group.id),
        await groups.leave(group.id),
        await groups.invite(group.id, [a.membership.id]),
        await groups.accept(group.id),
        await groups.decline(group.id),
        await groups.remove(group.id, a.membership.id),
        await groups.edit(group.id, { name: "Hijacked" }),
        await groups.archive(group.id),
        await groups.report(group.id),
        await chatApi(ctx, two.slug, outsider).get(group.id),
        await chatApi(ctx, two.slug, outsider).messages(group.id),
        await chatApi(ctx, two.slug, outsider).send(group.id, "From another institution"),
        await chatApi(ctx, two.slug, outsider).read(group.id, 1),
        await chatApi(ctx, two.slug, outsider).mute(group.id, null),
      ]) {
        expect(res.status, `${visibility} ${res.request.url}`).toBe(404);
      }
      // Even a message id from it, reported through this institution, isn't there.
      const said = await postToGroup(ctx, one, group.id, a, "Said in one");
      expect((await chatApi(ctx, two.slug, outsider).report(said.id)).status).toBe(404);
      // Nor can its own owner invite someone from another institution into it.
      expect((await groupsApi(ctx, one.slug, a).invite(group.id, [outsider.membership.id])).status).toBe(404);
    }
    expect((await groups.list()).body.data).toEqual([]);
    expect((await groups.invites()).body.data).toEqual([]);
    expect((await chatApi(ctx, two.slug, outsider).badge()).body.data).toEqual({ unread: 0, requests: 0, invites: 0 });
    expect(await ctx.db.select().from(contentReports)).toEqual([]);
  });

  it("gives one person in two institutions separate groups and invitations", async () => {
    const one = (await createTenant(ctx)).tenant;
    const two = (await createTenant(ctx)).tenant;
    const a = await memberSession(ctx, one.id);
    const b = await memberSession(ctx, one.id);
    const bInTwo: Session = { ...b, membership: await createMembership(ctx, two.id, b.user.id) };
    const group = await createGroup(ctx, one.slug, a, { visibility: "INVITE_ONLY" });
    await groupsApi(ctx, one.slug, a).invite(group.id, [b.membership.id]);
    expect((await groupsApi(ctx, one.slug, b).invites()).body.data).toHaveLength(1);
    expect((await groupsApi(ctx, two.slug, bInTwo).invites()).body.data).toEqual([]);
    expect((await chatApi(ctx, two.slug, bInTwo).badge()).body.data.invites).toBe(0);
    expect((await groupsApi(ctx, two.slug, bInTwo).accept(group.id)).status).toBe(404);
    expect((await groupsApi(ctx, one.slug, b).accept(group.id)).status).toBe(200);
  });

  it("refuses a member of neither institution outright", async () => {
    const { one, id } = await twoTenants();
    const stranger = await createUser(ctx);
    const session = await loginAs(ctx, stranger.phoneE164);
    const res = await request(ctx.app).get(`/api/v1/t/${one.slug}/chat/conversations/${id}`).set(auth(session.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_A_MEMBER");
  });

  it("doesn't let platform staff in by being staff", async () => {
    const { one, id } = await twoTenants();
    const staff = await loginAs(ctx, "+919999999999");
    const res = await request(ctx.app).get(`/api/v1/t/${one.slug}/chat/conversations/${id}/messages`).set(auth(staff.accessToken));
    expect(res.status).toBe(403);
  });

  it("gives one person in two institutions separate threads, badges and blocks", async () => {
    const one = (await createTenant(ctx)).tenant;
    const two = (await createTenant(ctx)).tenant;
    const a = await memberSession(ctx, one.id);
    const inTwo = await createMembership(ctx, two.id, a.user.id);
    const aInTwo: Session = { ...a, membership: inTwo };
    const b = await memberSession(ctx, one.id);
    const bInTwo: Session = { ...b, membership: await createMembership(ctx, two.id, b.user.id) };

    const { conversation: here } = await openRequest(ctx, one.slug, a, b.membership.id, "In the first");
    const { conversation: there } = await openRequest(ctx, two.slug, aInTwo, bInTwo.membership.id, "In the second");
    expect(here.id).not.toBe(there.id);

    const hereApi = chatApi(ctx, one.slug, b);
    const thereApi = chatApi(ctx, two.slug, bInTwo);
    expect((await hereApi.list("REQUESTS")).body.data.map((t: ChatConversationDto) => t.id)).toEqual([here.id]);
    expect((await thereApi.list("REQUESTS")).body.data.map((t: ChatConversationDto) => t.id)).toEqual([there.id]);

    // A thread is only reachable through its own institution's slug, even for someone in both.
    expect((await chatApi(ctx, two.slug, b).get(here.id)).status).toBe(404);
    expect((await chatApi(ctx, one.slug, bInTwo).get(there.id)).status).toBe(404);

    // A block stays in the institution it was made in.
    await hereApi.block(a.membership.id);
    expect((await hereApi.badge()).body.data.requests).toBe(0);
    expect((await thereApi.badge()).body.data.requests).toBe(1);
    expect((await thereApi.blocks()).body.data).toEqual([]);
    expect((await chatApi(ctx, one.slug, a).send(here.id, "Next")).status).toBe(409);
    const stillOpen = await thereApi.send(there.id, "Hello from the second");
    expect(stillOpen.status).toBe(201);
    expect((await chatApi(ctx, two.slug, aInTwo).messages(there.id)).body.data[0].body).toBe("Hello from the second");
  });

  it("can't start a thread with a member through an institution they aren't in", async () => {
    const { one, outsider } = await twoTenants();
    const a = await memberSession(ctx, one.id);
    const res = await chatApi(ctx, one.slug, a).direct(outsider.membership.id);
    expect(res.status).toBe(404);
    expect(await ctx.db.select().from(memberships).where(eq(memberships.id, outsider.membership.id))).toHaveLength(1);
  });

  it("can't lift somebody else's block, from this institution or another", async () => {
    const { one, two, a, b, outsider } = await twoTenants();
    const third = await memberSession(ctx, one.id);
    await chatApi(ctx, one.slug, b).block(a.membership.id);

    expect((await chatApi(ctx, two.slug, outsider).unblock(a.membership.id)).status).toBe(404);
    expect((await chatApi(ctx, one.slug, third).unblock(a.membership.id)).status).toBe(204);
    expect(await ctx.db.select().from(chatBlocks)).toEqual([expect.objectContaining({ blockerMembershipId: b.membership.id, blockedMembershipId: a.membership.id })]);

    // It's still only the member themselves who can.
    expect((await chatApi(ctx, one.slug, b).unblock(a.membership.id)).status).toBe(204);
    expect(await ctx.db.select().from(chatBlocks)).toEqual([]);
  });
});
