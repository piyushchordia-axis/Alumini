import { ApiClientError, createApiClient, MemoryTokenStorage } from "@illuminize/shared/client";
import { createRealtimeClient } from "@illuminize/shared/realtime";
import type { NotificationEvent, UnreadEvent } from "@illuminize/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { notify } from "../../src/services/notifications/notification.service";
import { auth, createMembership, createTenant, createUser, loginAs } from "../helpers/factories";
import { connect, disconnected, next, openSockets as sockets, startServer, type Harness } from "../helpers/realtimeHarness";
import { isDatabaseAvailable } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("live updates (Socket.IO)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startServer();
    await h.ctx.truncateAll(); // earlier test files may have left rows, and factory phones restart in every file
  });
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.disconnect());
    await h.ctx.truncateAll();
  });
  afterAll(async () => {
    await h.close();
  });

  async function member(phone?: string) {
    const { tenant } = await createTenant(h.ctx, { slug: `live-${Math.random().toString(36).slice(2, 8)}` });
    const user = await createUser(h.ctx, phone ? { phone } : {});
    const membership = await createMembership(h.ctx, tenant.id, user.id);
    const session = await loginAs(h.ctx, user.phoneE164);
    return { tenant, user, membership, session };
  }

  it("refuses connections without a valid, live session", async () => {
    await expect(connect(h.baseUrl, undefined)).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await expect(connect(h.baseUrl, "not-a-jwt")).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    const { session } = await member();
    await request(h.ctx.app).post("/api/v1/auth/logout").set(auth(session.accessToken)).send({ refreshToken: session.refreshToken });
    await expect(connect(h.baseUrl, session.accessToken)).rejects.toMatchObject({ data: { code: "SESSION_REVOKED" } });
  });

  it("delivers new notifications with the unread count", async () => {
    const { tenant, membership, session } = await member();
    const socket = await connect(h.baseUrl, session.accessToken);
    const event = next<NotificationEvent>(socket, "notification:new");
    await notify(h.ctx, { tenantId: tenant.id, recipientMembershipIds: [membership.id], type: "SYSTEM", title: "Welcome to the network" });
    await h.ctx.jobs.drain();
    expect(await event).toMatchObject({ tenantSlug: tenant.slug, membershipId: membership.id, unreadCount: 1, notification: { title: "Welcome to the network", type: "SYSTEM" } });
  });

  it("keeps a member's other devices in step when notifications are read", async () => {
    const { tenant, membership, session } = await member();
    await notify(h.ctx, { tenantId: tenant.id, recipientMembershipIds: [membership.id], type: "SYSTEM", title: "One" });
    const other = await connect(h.baseUrl, session.accessToken);
    const unread = next<UnreadEvent>(other, "notification:unread");
    await request(h.ctx.app).post(`/api/v1/t/${tenant.slug}/notifications/read-all`).set(auth(session.accessToken));
    expect(await unread).toEqual({ tenantSlug: tenant.slug, membershipId: membership.id, count: 0 });
  });

  it("disconnects instead of crashing when Redis fails just after the handshake", async () => {
    const { session } = await member();
    const logged = vi.spyOn(h.ctx.logger, "error");
    const realExists = h.ctx.redis.exists.bind(h.ctx.redis);
    const exists = vi.spyOn(h.ctx.redis, "exists");
    // The handshake's check passes, and the one after joining the rooms finds Redis gone.
    exists.mockImplementationOnce(realExists as never).mockRejectedValueOnce(new Error("Redis went away"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const socket = await connect(h.baseUrl, session.accessToken);
      const reason = socket.connected ? await disconnected(socket) : "already gone";
      expect(["io server disconnect", "already gone"]).toContain(reason);
      await vi.waitFor(() => expect(logged).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), "Could not set up a live connection"));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      exists.mockRestore();
      logged.mockRestore();
    }
    // The server is still up, and the client can come straight back.
    expect((await connect(h.baseUrl, session.accessToken)).connected).toBe(true);
  });

  it("closes a session's sockets on sign-out, and every socket on sign-out everywhere or account deletion", async () => {
    const { user, session } = await member("+919812345678");
    const second = await loginAs(h.ctx, user.phoneE164);
    const a = await connect(h.baseUrl, session.accessToken);
    const b = await connect(h.baseUrl, second.accessToken);
    const aGone = disconnected(a);
    await request(h.ctx.app).post("/api/v1/auth/logout").set(auth(session.accessToken)).send({ refreshToken: session.refreshToken });
    expect(await aGone).toBe("io server disconnect");
    expect(b.connected).toBe(true);

    const bGone = disconnected(b);
    await request(h.ctx.app).post("/api/v1/auth/logout-all").set(auth(second.accessToken));
    expect(await bGone).toBe("io server disconnect");

    const third = await loginAs(h.ctx, user.phoneE164);
    const c = await connect(h.baseUrl, third.accessToken);
    const cGone = disconnected(c);
    await request(h.ctx.app).post("/api/v1/me/delete").set(auth(third.accessToken)).send({ confirm: true });
    expect(await cGone).toBe("io server disconnect");
  });
});

describe.skipIf(!dbAvailable)("live updates with short-lived tokens", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startServer({ ACCESS_TOKEN_TTL_SEC: "1" });
  });
  afterAll(async () => {
    sockets.splice(0).forEach((s) => s.disconnect());
    await h.close();
  });

  it("tells the client its token expired and disconnects", async () => {
    const { tenant } = await createTenant(h.ctx);
    const user = await createUser(h.ctx);
    await createMembership(h.ctx, tenant.id, user.id);
    const session = await loginAs(h.ctx, user.phoneE164);
    const socket = await connect(h.baseUrl, session.accessToken);
    const expired = next<void>(socket, "auth:expired", 3000);
    const gone = disconnected(socket);
    await expired;
    expect(await gone).toBe("io server disconnect");
  });

  it("the shared client refreshes over REST, reconnects and keeps receiving events", async () => {
    const { tenant } = await createTenant(h.ctx, { slug: "live-refresh" });
    const user = await createUser(h.ctx, { phone: "+919833333333" });
    const membership = await createMembership(h.ctx, tenant.id, user.id);
    const session = await loginAs(h.ctx, user.phoneE164);
    const storage = new MemoryTokenStorage();
    await storage.setTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    const api = createApiClient({ baseUrl: h.baseUrl, storage });
    const client = createRealtimeClient({ baseUrl: h.baseUrl, getAccessToken: () => storage.getAccessToken(), refresh: () => api.core.refresh() });
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));
    let reconnects = 0;
    client.onReconnect(() => void (reconnects += 1));
    const received: NotificationEvent[] = [];
    client.on("notification:new", (e) => received.push(e));
    client.start();
    // Wait past the 1 second token lifetime: the server sends auth:expired, the client refreshes and reconnects.
    for (let i = 0; i < 60 && reconnects === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(reconnects).toBeGreaterThanOrEqual(1);
    expect(await storage.getAccessToken()).not.toBe(session.accessToken);

    await notify(h.ctx, { tenantId: tenant.id, recipientMembershipIds: [membership.id], type: "SYSTEM", title: "After refresh" });
    await h.ctx.jobs.drain();
    for (let i = 0; i < 40 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    expect(received[0]).toMatchObject({ tenantSlug: "live-refresh", notification: { title: "After refresh" } });
    client.stop();
    expect(statuses).toContain("connected");
    expect(client.status).toBe("idle");
  });

  it("keeps trying when a refresh gets no answer, because that says nothing about the session", async () => {
    const { tenant } = await createTenant(h.ctx, { slug: "live-retry" });
    const user = await createUser(h.ctx, { phone: "+919833333334" });
    await createMembership(h.ctx, tenant.id, user.id);
    const session = await loginAs(h.ctx, user.phoneE164);
    const storage = new MemoryTokenStorage();
    await storage.setTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    const api = createApiClient({ baseUrl: h.baseUrl, storage });
    let refreshes = 0;
    const client = createRealtimeClient({
      baseUrl: h.baseUrl,
      getAccessToken: () => storage.getAccessToken(),
      refreshRetryMs: 20,
      // More failures in a row than the client allows for a refused token, so counting these towards that limit would show.
      refresh: () => (++refreshes <= 5 ? Promise.reject(new ApiClientError(503, "INTERNAL", "down")) : api.core.refresh()),
    });
    let reconnects = 0;
    client.onReconnect(() => void (reconnects += 1));
    client.start();
    for (let i = 0; i < 80 && reconnects === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(refreshes).toBeGreaterThan(5);
    expect(reconnects).toBeGreaterThanOrEqual(1);
    client.stop();
  });

  it("stops retrying once stopped, so a signed-out client doesn't keep calling the API", async () => {
    const { tenant } = await createTenant(h.ctx, { slug: "live-retry-stop" });
    const user = await createUser(h.ctx, { phone: "+919833333335" });
    await createMembership(h.ctx, tenant.id, user.id);
    const session = await loginAs(h.ctx, user.phoneE164);
    let refreshes = 0;
    const client = createRealtimeClient({
      baseUrl: h.baseUrl,
      getAccessToken: async () => session.accessToken,
      refreshRetryMs: 20,
      refresh: () => {
        refreshes += 1;
        return Promise.reject(new ApiClientError(0, "NETWORK_ERROR", "offline"));
      },
    });
    client.start();
    for (let i = 0; i < 60 && refreshes === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(refreshes).toBeGreaterThanOrEqual(1);
    client.stop();
    const stoppedAt = refreshes;
    await new Promise((r) => setTimeout(r, 100));
    expect(refreshes).toBe(stoppedAt);
    expect(client.status).toBe("idle");
  });
});
