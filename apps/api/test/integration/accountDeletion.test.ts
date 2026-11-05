import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, chatBlocks, deletedAccountBlocks, deletedAccountSuspensions, invitations, memberships, notifications, tenants, users } from "../../src/db/schema";
import { phoneHash } from "../../src/lib/phoneHash";
import { RESTORED_SUSPENSION_REASON } from "../../src/services/deletedAccounts.service";
import { chatApi } from "../helpers/chat";
import { refusingAudit, untilSomeoneWaitsFor, withTrigger } from "../helpers/db";
import { PROFILE, auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const PHONE = "+919876543210";

describe.skipIf(!dbAvailable)("deleting an account keeps the sanctions others need", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    ctx.otpCapture.codes.clear();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const api = () => request(ctx.app);
  const deleteAccount = (headers: Record<string, string>) => api().post("/api/v1/me/delete").set(headers).send({ confirm: true });
  const register = (slug: string, headers: Record<string, string>) => api().post(`/api/v1/t/${slug}/memberships`).set(headers).send(PROFILE);
  const held = async () => ({ suspensions: await ctx.db.select().from(deletedAccountSuspensions), blocks: await ctx.db.select().from(deletedAccountBlocks) });
  const auditsOf = (action: string) => ctx.db.select().from(auditLog).where(eq(auditLog.action, action));

  /** Signs in through the OTP routes with the number as typed, which may be spaced; the code goes to its E.164 form. */
  async function signInTyped(typed: string, e164: string) {
    expect((await api().post("/api/v1/auth/otp/request").send({ phone: typed })).status).toBe(200);
    const verify = await api().post("/api/v1/auth/otp/verify").send({ phone: typed, code: ctx.otpCapture.codes.get(e164) });
    expect(verify.status).toBe(200);
    return { userId: verify.body.data.user.id as string, headers: auth(verify.body.data.accessToken) };
  }

  /** Someone with this number in each institution, as `status`, signed in. */
  async function person(at: Array<{ tenantId: string; status: "APPROVED" | "SUSPENDED" | "PENDING" | "REJECTED" }>, phone = PHONE) {
    const user = await createUser(ctx, { phone });
    const rows = [];
    for (const { tenantId, status } of at) rows.push(await createMembership(ctx, tenantId, user.id, { status }));
    const session = await loginAs(ctx, phone);
    return { user, memberships: rows, headers: auth(session.accessToken) };
  }

  it("brings a suspension back at its institution whatever joining would give, with no request for admins to see, and it can be lifted as usual", async () => {
    // Would approve them at once: an open invitation, and invitees auto-approved.
    const { tenant: invited } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    // Would hold them for approval, telling the admin.
    const { tenant: reviewed } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    const { tenant: clean } = await createTenant(ctx);
    const [invitedAdmin, reviewedAdmin] = [await memberSession(ctx, invited.id, { role: "TENANT_ADMIN" }), await memberSession(ctx, reviewed.id, { role: "TENANT_ADMIN" })];
    const p = await person([
      { tenantId: invited.id, status: "SUSPENDED" },
      { tenantId: reviewed.id, status: "SUSPENDED" },
      { tenantId: clean.id, status: "APPROVED" },
    ]);
    const suspendedAt = new Date("2026-01-02T03:04:05.678Z");
    await ctx.db.update(memberships).set({ statusChangedAt: suspendedAt, statusReason: "Harassment" }).where(eq(memberships.id, p.memberships[0]!.id));
    await ctx.db.insert(invitations).values({ tenantId: invited.id, phoneE164: PHONE, token: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) });

    expect((await deleteAccount(p.headers)).status).toBe(204);
    const hash = phoneHash(ctx.config, PHONE);
    const kept = await held();
    expect(kept.suspensions.map((s) => [s.tenantId, s.phoneHash]).sort()).toEqual([[invited.id, hash], [reviewed.id, hash]].sort());
    expect(kept.suspensions.find((s) => s.tenantId === invited.id)!.suspendedAt).toEqual(suspendedAt);
    expect(kept.blocks).toEqual([]);

    const started = Date.now();
    const back = await signInTyped(PHONE, PHONE);
    expect(back.userId).not.toBe(p.user.id);
    const joined = { invited: await register(invited.slug, back.headers), reviewed: await register(reviewed.slug, back.headers), clean: await register(clean.slug, back.headers) };
    for (const res of [joined.invited, joined.reviewed]) {
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: "SUSPENDED", statusReason: RESTORED_SUSPENSION_REASON, role: "MEMBER" });
    }
    expect(joined.clean.body.data.status).toBe("APPROVED");
    const [restored] = await ctx.db.select().from(memberships).where(eq(memberships.id, joined.invited.body.data.id));
    expect(restored!.statusChangedAt!.getTime()).toBeGreaterThanOrEqual(started - 1000);
    expect(restored!.statusChangedByUserId).toBeNull();
    expect(await ctx.db.select().from(notifications).where(eq(notifications.type, "NEW_MEMBER_PENDING"))).toEqual([]);
    expect(await held()).toEqual({ suspensions: [], blocks: [] });

    const restoredAudits = await auditsOf("membership.suspension_restored");
    expect(restoredAudits.map((a) => [a.tenantId, a.targetId]).sort()).toEqual(
      [
        [invited.id, joined.invited.body.data.id],
        [reviewed.id, joined.reviewed.body.data.id],
      ].sort(),
    );
    expect(restoredAudits.find((a) => a.tenantId === invited.id)!.metadata).toEqual({ suspendedAt: suspendedAt.toISOString() });

    // A restored suspension is an ordinary one: on the Suspended tab, and lifted by Reinstate.
    const suspendedTab = await api().get(`/api/v1/t/${reviewed.slug}/admin/members`).query({ status: "SUSPENDED" }).set(reviewedAdmin.headers);
    expect(suspendedTab.body.data.map((m: { id: string }) => m.id)).toEqual([joined.reviewed.body.data.id]);
    const reinstated = await api().post(`/api/v1/t/${invited.slug}/admin/members/${joined.invited.body.data.id}/reinstate`).set(invitedAdmin.headers);
    expect(reinstated.status).toBe(200);
    expect(reinstated.body.data.status).toBe("APPROVED");
  });

  it("matches the number however it's typed when it signs in again", async () => {
    const { tenant } = await createTenant(ctx);
    const blocker = await memberSession(ctx, tenant.id);
    const p = await person([{ tenantId: tenant.id, status: "SUSPENDED" }], "+919876543210");
    await chatApi(ctx, tenant.slug, blocker).block(p.memberships[0]!.id);
    expect((await deleteAccount(p.headers)).status).toBe(204);

    const back = await signInTyped("+91 98765 43210", "+919876543210");
    const joined = await register(tenant.slug, back.headers);
    expect(joined.body.data.status).toBe("SUSPENDED");
    expect(await ctx.db.select().from(chatBlocks)).toEqual([expect.objectContaining({ blockerMembershipId: blocker.membership.id, blockedMembershipId: joined.body.data.id })]);
    expect(await held()).toEqual({ suspensions: [], blocks: [] });
  });

  it("keeps nothing for an account with no suspension or block on it, nor the blocks it placed", async () => {
    const { tenant } = await createTenant(ctx);
    const { tenant: other } = await createTenant(ctx);
    const neighbour = await memberSession(ctx, tenant.id);
    const p = await person([
      { tenantId: tenant.id, status: "APPROVED" },
      { tenantId: other.id, status: "REJECTED" },
    ]);
    expect((await chatApi(ctx, tenant.slug, p).block(neighbour.membership.id)).status).toBe(201);
    expect((await deleteAccount(p.headers)).status).toBe(204);
    expect(await held()).toEqual({ suspensions: [], blocks: [] });
  });

  it("audits the deletion in its transaction with a keyed hash and counts, never the number or any block", async () => {
    const { tenant } = await createTenant(ctx);
    const { tenant: other } = await createTenant(ctx);
    const blocker = await memberSession(ctx, other.id);
    const p = await person([
      { tenantId: tenant.id, status: "SUSPENDED" },
      { tenantId: other.id, status: "APPROVED" },
    ]);
    await chatApi(ctx, other.slug, blocker).block(p.memberships[1]!.id);
    const me = () => api().get("/api/v1/me").set(p.headers);

    // An audit row that can't be written stops the deletion, holds and all.
    await refusingAudit(ctx, "auth.account_deleted", async () => {
      expect((await deleteAccount(p.headers)).status).toBe(500);
    });
    expect((await me()).status).toBe(200);
    expect(await ctx.db.select().from(users).where(eq(users.id, p.user.id))).toHaveLength(1);
    expect(await held()).toEqual({ suspensions: [], blocks: [] });

    expect((await deleteAccount(p.headers)).status).toBe(204);
    const [row, ...more] = await auditsOf("auth.account_deleted");
    expect(more).toEqual([]);
    expect(row).toMatchObject({ tenantId: null, actorUserId: null, actorMembershipId: null, targetType: "user", targetId: p.user.id });
    expect(row!.metadata).toEqual({ phoneHash: phoneHash(ctx.config, PHONE), memberships: 2, heldSuspensions: 1 });
    expect(JSON.stringify(row)).not.toContain(PHONE.slice(3));

    // Rejoining where they were blocked: the block is back, and the institution's audit log shows only the new membership.
    const back = await signInTyped(PHONE, PHONE);
    const joined = await register(other.slug, back.headers);
    expect(await ctx.db.select().from(chatBlocks)).toEqual([expect.objectContaining({ blockedMembershipId: joined.body.data.id })]);
    const logged = await ctx.db.select().from(auditLog).where(eq(auditLog.tenantId, other.id));
    expect(logged.map((a) => [a.action, a.metadata])).toEqual([["membership.create", { status: "APPROVED" }]]);
    expect(JSON.stringify(logged)).not.toContain(blocker.membership.id);
  });

  it("keeps the holds through a registration that fails after taking them, and gives them back on the next try", async () => {
    const { tenant } = await createTenant(ctx);
    const [admin, blocker] = [await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" }), await memberSession(ctx, tenant.id)];
    const field = await api().post(`/api/v1/t/${tenant.slug}/admin/profile-fields`).set(admin.headers).send({ key: "house", label: "House", type: "TEXT", required: true });
    expect(field.status).toBe(201);
    const p = await person([{ tenantId: tenant.id, status: "SUSPENDED" }]);
    await chatApi(ctx, tenant.slug, blocker).block(p.memberships[0]!.id);
    expect((await deleteAccount(p.headers)).status).toBe(204);
    const kept = await held();
    expect([kept.suspensions.length, kept.blocks.length]).toEqual([1, 1]);

    const back = await signInTyped(PHONE, PHONE);
    const theirMemberships = () => ctx.db.select().from(memberships).where(eq(memberships.userId, back.userId));
    const answered = () => api().post(`/api/v1/t/${tenant.slug}/memberships`).set(back.headers).send({ ...PROFILE, fields: { house: "Blue" } });
    // Without the required answer, refused once the holds are taken: the refusal puts them back.
    expect((await register(tenant.slug, back.headers)).status).toBe(400);
    expect(await theirMemberships()).toEqual([]);
    expect(await held()).toEqual(kept);
    // The same when the restored suspension's audit row can't be written.
    await refusingAudit(ctx, "membership.suspension_restored", async () => {
      expect((await answered()).status).toBe(500);
    });
    expect(await theirMemberships()).toEqual([]);
    expect(await held()).toEqual(kept);
    expect(await ctx.db.select().from(chatBlocks)).toEqual([]);

    const joined = await answered();
    expect(joined.status).toBe(201);
    expect(joined.body.data.status).toBe("SUSPENDED");
    expect(await ctx.db.select().from(chatBlocks)).toEqual([
      expect.objectContaining({ blockerMembershipId: blocker.membership.id, blockedMembershipId: joined.body.data.id, createdAt: kept.blocks[0]!.blockedAt }),
    ]);
    expect(await held()).toEqual({ suspensions: [], blocks: [] });
  });

  it("deletes an account whose stored number today's rules refuse, keeping its holds under that number", async () => {
    const { tenant } = await createTenant(ctx);
    const { tenant: other } = await createTenant(ctx);
    const p = await person([{ tenantId: tenant.id, status: "SUSPENDED" }]);
    // Stored under older length rules (India allows ten national digits now), and still signed in.
    const stored = "+91987654321012";
    await ctx.db.update(users).set({ phoneE164: stored }).where(eq(users.id, p.user.id));
    // Joining somewhere new looks for holds under it too.
    expect((await register(other.slug, p.headers)).status).toBe(201);

    expect((await deleteAccount(p.headers)).status).toBe(204);
    expect(await ctx.db.select().from(users).where(eq(users.id, p.user.id))).toEqual([]);
    expect((await held()).suspensions).toEqual([expect.objectContaining({ tenantId: tenant.id, phoneHash: phoneHash(ctx.config, stored) })]);
  });

  describe("with something about them still being committed", () => {
    /** Deletes the account while `hold` keeps a transaction open, committing it once the deletion waits for it. */
    async function deleteWhile(headers: Record<string, string>, hold: (holder: pg.Client) => Promise<unknown>) {
      const holder = new pg.Client({ connectionString: ctx.config.DATABASE_URL });
      await holder.connect();
      try {
        await holder.query("begin");
        await hold(holder);
        const deleting = deleteAccount(headers).then((res) => res);
        await untilSomeoneWaitsFor(ctx, "transactionid");
        await holder.query("commit");
        expect((await deleting).status).toBe(204);
      } finally {
        await holder.end();
      }
    }

    it("waits for a suspension and keeps it", async () => {
      const { tenant } = await createTenant(ctx);
      const p = await person([{ tenantId: tenant.id, status: "APPROVED" }]);
      await deleteWhile(p.headers, (holder) => holder.query("update memberships set status = 'SUSPENDED', status_changed_at = now() where id = $1", [p.memberships[0]!.id]));
      expect(await held()).toEqual({ suspensions: [expect.objectContaining({ tenantId: tenant.id, phoneHash: phoneHash(ctx.config, PHONE) })], blocks: [] });
    }, 20_000);

    it("waits for a block and keeps it", async () => {
      const { tenant } = await createTenant(ctx);
      const blocker = await memberSession(ctx, tenant.id);
      const p = await person([{ tenantId: tenant.id, status: "APPROVED" }]);
      await deleteWhile(p.headers, (holder) =>
        holder.query("insert into chat_blocks (tenant_id, blocker_membership_id, blocked_membership_id) values ($1, $2, $3)", [tenant.id, blocker.membership.id, p.memberships[0]!.id]),
      );
      expect(await held()).toEqual({ suspensions: [], blocks: [expect.objectContaining({ blockerMembershipId: blocker.membership.id, phoneHash: phoneHash(ctx.config, PHONE) })] });
    }, 20_000);

    it("waits for a rejoin that has taken the holds back, and keeps them again", async () => {
      const { tenant } = await createTenant(ctx);
      const blocker = await memberSession(ctx, tenant.id);
      const p = await person([{ tenantId: tenant.id, status: "SUSPENDED" }]);
      await chatApi(ctx, tenant.slug, blocker).block(p.memberships[0]!.id);
      expect((await deleteAccount(p.headers)).status).toBe(204);
      const [kept] = (await held()).blocks;
      const back = await signInTyped(PHONE, PHONE);

      const gate = new pg.Client({ connectionString: ctx.config.DATABASE_URL });
      await gate.connect();
      try {
        await gate.query("select pg_advisory_lock(424242)");
        // The registration stops at its restore audit row, with the holds taken and the membership and block inserted.
        const stop = "if new.action = 'membership.suspension_restored' then perform pg_advisory_xact_lock(424242); end if; return new;";
        await withTrigger(ctx, "after insert on audit_log", stop, async () => {
          const joining = register(tenant.slug, back.headers).then((res) => res);
          await untilSomeoneWaitsFor(ctx, "advisory");
          const deleting = deleteAccount(back.headers).then((res) => res);
          await untilSomeoneWaitsFor(ctx, "transactionid");
          await gate.query("select pg_advisory_unlock(424242)");
          expect((await joining).status).toBe(201);
          expect((await deleting).status).toBe(204);
        });
      } finally {
        await gate.end();
      }
      expect(await ctx.db.select().from(memberships).where(eq(memberships.userId, back.userId))).toEqual([]);
      expect(await held()).toEqual({
        suspensions: [expect.objectContaining({ tenantId: tenant.id, phoneHash: phoneHash(ctx.config, PHONE) })],
        blocks: [expect.objectContaining({ blockerMembershipId: blocker.membership.id, blockedAt: kept!.blockedAt })],
      });
    }, 20_000);
  });

  it("lets a hold go with the blocker's membership, and every hold with the institution", async () => {
    const { tenant } = await createTenant(ctx);
    const { tenant: other } = await createTenant(ctx);
    const [stays, leaves] = [await memberSession(ctx, tenant.id), await memberSession(ctx, other.id)];
    const p = await person([
      { tenantId: tenant.id, status: "SUSPENDED" },
      { tenantId: other.id, status: "APPROVED" },
    ]);
    await chatApi(ctx, tenant.slug, stays).block(p.memberships[0]!.id);
    await chatApi(ctx, other.slug, leaves).block(p.memberships[1]!.id);
    expect((await deleteAccount(p.headers)).status).toBe(204);
    expect((await held()).blocks.map((b) => b.blockerMembershipId).sort()).toEqual([stays.membership.id, leaves.membership.id].sort());

    expect((await deleteAccount(leaves.headers)).status).toBe(204);
    expect((await held()).blocks.map((b) => b.blockerMembershipId)).toEqual([stays.membership.id]);

    await ctx.db.delete(tenants).where(eq(tenants.id, tenant.id));
    expect(await held()).toEqual({ suspensions: [], blocks: [] });
  });

  describe("made an admin by staff", () => {
    let staff: Record<string, string>;
    beforeEach(async () => {
      staff = auth((await loginAs(ctx, "+919999999999")).accessToken);
    });
    const assign = (tenantId: string, phone: string) => api().post(`/api/v1/platform/tenants/${tenantId}/admins`).set(staff).send({ phone, fullName: "Promoted" });

    it("brings back a held suspension and refuses, as for any suspended member, until the institution reinstates them", async () => {
      const { tenant } = await createTenant(ctx);
      const [admin, blocker] = [await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" }), await memberSession(ctx, tenant.id)];
      const p = await person([{ tenantId: tenant.id, status: "SUSPENDED" }]);
      await chatApi(ctx, tenant.slug, blocker).block(p.memberships[0]!.id);
      expect((await deleteAccount(p.headers)).status).toBe(204);

      const refused = await assign(tenant.id, "+91 98765 43210");
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({ code: "CONFLICT", message: "This member is suspended. Reinstate them first." });
      const [found] = await ctx.db.select({ membership: memberships }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(users.phoneE164, PHONE));
      const kept = found?.membership;
      expect(kept).toMatchObject({ tenantId: tenant.id, status: "SUSPENDED", role: "MEMBER", statusReason: RESTORED_SUSPENSION_REASON });
      expect(await ctx.db.select().from(chatBlocks)).toEqual([expect.objectContaining({ blockerMembershipId: blocker.membership.id, blockedMembershipId: kept!.id })]);
      expect(await held()).toEqual({ suspensions: [], blocks: [] });
      expect(await auditsOf("platform.tenant.admin.assign")).toEqual([]);
      expect((await auditsOf("membership.suspension_restored")).map((a) => a.targetId)).toEqual([kept!.id]);

      // The same answer again, and once reinstated they can be made an admin.
      expect((await assign(tenant.id, PHONE)).status).toBe(409);
      expect((await api().post(`/api/v1/t/${tenant.slug}/admin/members/${kept!.id}/reinstate`).set(admin.headers)).status).toBe(200);
      const promoted = await assign(tenant.id, PHONE);
      expect(promoted.status).toBe(201);
      expect(promoted.body.data).toMatchObject({ id: kept!.id, role: "TENANT_ADMIN", status: "APPROVED" });
    });

    it("gives back held blocks to a new admin", async () => {
      const { tenant } = await createTenant(ctx);
      const blocker = await memberSession(ctx, tenant.id);
      const p = await person([{ tenantId: tenant.id, status: "APPROVED" }]);
      await chatApi(ctx, tenant.slug, blocker).block(p.memberships[0]!.id);
      expect((await deleteAccount(p.headers)).status).toBe(204);

      const promoted = await assign(tenant.id, PHONE);
      expect(promoted.status).toBe(201);
      expect(promoted.body.data).toMatchObject({ role: "TENANT_ADMIN", status: "APPROVED" });
      expect(await ctx.db.select().from(chatBlocks)).toEqual([expect.objectContaining({ blockerMembershipId: blocker.membership.id, blockedMembershipId: promoted.body.data.id })]);
      expect(await held()).toEqual({ suspensions: [], blocks: [] });
    });
  });
});
