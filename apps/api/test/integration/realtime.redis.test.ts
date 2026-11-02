import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Emitter } from "@socket.io/redis-emitter";
import { REALTIME_PATH, type ChatChangedEvent, type NotificationEvent } from "@illuminize/shared";
import Redis from "ioredis";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisEmitterPublisher, type SocketIoPublisher } from "../../src/realtime/publisher";
import { rooms } from "../../src/realtime/rooms";
import { attachRealtime, type RealtimeServer } from "../../src/realtime/server";
import { auth, createMembership, createTenant, createUser, loginAs } from "../helpers/factories";
import { isRealRedisAvailable, realRedisUrl } from "../helpers/realRedis";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const ready = (await isDatabaseAvailable()) && (await isRealRedisAvailable());

describe.skipIf(!ready)("live updates across API nodes (real Redis)", () => {
  // A unique channel prefix keeps these nodes apart from any other Socket.IO server on the same Redis (e.g. a dev API).
  const key = `test-io-${randomUUID()}`;
  const nodes: Array<{ ctx: TestContext; url: string; io: RealtimeServer; publisher: SocketIoPublisher; close: () => Promise<void> }> = [];
  const emitterRedis = new Redis(realRedisUrl());
  const sockets: Socket[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const ctx = await createTestContext({ REDIS_URL: realRedisUrl() });
      const server = http.createServer(ctx.app);
      const rt = attachRealtime(server, ctx, { adapter: "redis", key });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      nodes.push({ ctx, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, io: rt.io, publisher: rt.publisher, close: rt.close });
    }
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    for (const n of nodes) {
      await n.close();
      await n.ctx.dispose();
    }
    await emitterRedis.quit();
  });

  it("a worker's event reaches a socket on any node, and a sign-out on one node closes sockets on the other", async () => {
    const [a, b] = nodes as [(typeof nodes)[0], (typeof nodes)[0]];
    await a.ctx.truncateAll(); // earlier test files may have left rows (factory slugs restart in every file)
    await createTenant(a.ctx);
    const user = await createUser(a.ctx, { phone: "+919844455566" });
    // Both nodes share the session store only through Redis in production; here node A issues the token and its
    // (mock) Redis holds the session, so connect to node A.
    const session = await loginAs(a.ctx, user.phoneE164);
    const socket = io(a.url, { path: REALTIME_PATH, transports: ["websocket"], reconnection: false, forceNew: true, auth: { token: session.accessToken } });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    // Wait until node A has put the socket in the user's room.
    for (let i = 0; i < 50 && (await a.io.local.in(rooms.user(user.id)).fetchSockets()).length === 0; i++) await new Promise((r) => setTimeout(r, 20));

    const received = new Promise<NotificationEvent>((resolve) => socket.once("notification:new", resolve));
    // A separate worker process publishes through Redis.
    new RedisEmitterPublisher(new Emitter(emitterRedis, { key })).emit(rooms.user(user.id), "notification:new", {
      tenantSlug: "x",
      membershipId: "m",
      unreadCount: 3,
      notification: { id: "n", type: "SYSTEM", title: "From the worker", body: null, data: {}, readAt: null, createdAt: new Date().toISOString() },
    });
    expect(await received).toMatchObject({ unreadCount: 3, notification: { title: "From the worker" } });

    const gone = new Promise<string>((resolve) => socket.once("disconnect", resolve));
    b.publisher.disconnect(rooms.user(user.id));
    expect(await gone).toBe("io server disconnect");
  });

  it("a chat request sent through one node reaches a member connected to the other", async () => {
    const [a, b] = nodes as [(typeof nodes)[0], (typeof nodes)[0]];
    await a.ctx.truncateAll();
    b.ctx.realtime = b.publisher;
    const { tenant } = await createTenant(a.ctx);
    const reader = await createUser(a.ctx, { phone: "+919844455567" });
    const writer = await createUser(a.ctx, { phone: "+919844455568" });
    const readerMembership = await createMembership(a.ctx, tenant.id, reader.id);
    await createMembership(a.ctx, tenant.id, writer.id);
    // Each node has its own mock session store, so each member signs in on the node they use.
    const readerSession = await loginAs(a.ctx, reader.phoneE164);
    const writerSession = await loginAs(b.ctx, writer.phoneE164);

    const socket = io(a.url, { path: REALTIME_PATH, transports: ["websocket"], reconnection: false, forceNew: true, auth: { token: readerSession.accessToken } });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    for (let i = 0; i < 50 && (await a.io.local.in(rooms.user(reader.id)).fetchSockets()).length === 0; i++) await new Promise((r) => setTimeout(r, 20));

    const changed = new Promise<ChatChangedEvent>((resolve) => socket.once("chat:changed", resolve));
    const res = await request(b.ctx.app).post(`/api/v1/t/${tenant.slug}/chat/direct`).set(auth(writerSession.accessToken)).send({ membershipId: readerMembership.id, body: "Across nodes", clientKey: "across-nodes-1" });
    expect(res.status).toBe(201);
    expect(await changed).toEqual({ tenantSlug: tenant.slug, conversationId: res.body.data.conversation.id });
  });
});
