import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApiClient, MemoryTokenStorage } from "@illuminize/shared/client";
import { createRealtimeClient } from "@illuminize/shared/realtime";
import { REALTIME_PATH, type NotificationEvent, type UnreadEvent } from "@illuminize/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { attachRealtime } from "../../src/realtime/server";
import { notify } from "../../src/services/notifications/notification.service";
import { auth, createMembership, createTenant, createUser, loginAs } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

interface Harness {
  ctx: TestContext;
  baseUrl: string;
  close(): Promise<void>;
}

async function startServer(env: Record<string, string> = {}): Promise<Harness> {
  const ctx = await createTestContext(env);
  const server = http.createServer(ctx.app);
  const rt = attachRealtime(server, ctx, { adapter: "memory" });
  ctx.realtime = rt.publisher;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    ctx,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await rt.close();
      await ctx.dispose();
    },
  };
}

const sockets: Socket[] = [];
function connect(baseUrl: string, token: string | undefined): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(baseUrl, { path: REALTIME_PATH, transports: ["websocket"], reconnection: false, forceNew: true, auth: token ? { token } : {} });
    sockets.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", (err) => reject(err));
  });
}
const next = <T>(s: Socket, event: string, timeoutMs = 3000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    s.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
const disconnected = (s: Socket) => next<string>(s, "disconnect");

describe.skipIf(!dbAvailable)("live updates (Socket.IO)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startServer();
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
});
