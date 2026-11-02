import http from "node:http";
import type { AddressInfo } from "node:net";
import { REALTIME_PATH } from "@illuminize/shared";
import { io, type Socket } from "socket.io-client";
import type { RealtimePublisher } from "../../src/realtime/publisher";
import { rooms } from "../../src/realtime/rooms";
import { attachRealtime, type RealtimeServer } from "../../src/realtime/server";
import { createTestContext, type TestContext } from "./testContext";

export interface Harness {
  ctx: TestContext;
  baseUrl: string;
  io: RealtimeServer;
  close(): Promise<void>;
}

/** A real HTTP and Socket.IO server on a free port, with its own test context. */
export async function startServer(env: Record<string, string> = {}): Promise<Harness> {
  const ctx = await createTestContext(env);
  const server = http.createServer(ctx.app);
  const rt = attachRealtime(server, ctx, { adapter: "memory" });
  ctx.realtime = rt.publisher;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    ctx,
    baseUrl: `http://127.0.0.1:${port}`,
    io: rt.io,
    async close() {
      await rt.close();
      await ctx.dispose();
    },
  };
}

/** Every socket opened through `connect`, for a test file to close between tests. */
export const openSockets: Socket[] = [];

export function connect(baseUrl: string, token: string | undefined): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(baseUrl, { path: REALTIME_PATH, transports: ["websocket"], reconnection: false, forceNew: true, auth: token ? { token } : {} });
    openSockets.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", (err) => reject(err));
  });
}

export const next = <T>(s: Socket, event: string, timeoutMs = 3000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    s.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });

export const disconnected = (s: Socket) => next<string>(s, "disconnect");

/** Rooms are joined just after connecting, so a test that needs delivery waits for this. */
export async function waitForRoom(h: Harness, userId: string, sockets = 1): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if ((await h.io.local.in(rooms.user(userId)).fetchSockets()).length >= sockets) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`${userId} never joined their room`);
}

/** Records what would have gone out, for a test that doesn't need real sockets. */
export class CapturingRealtime implements RealtimePublisher {
  readonly events: Array<{ to: string | string[]; event: string; payload: unknown }> = [];
  emit(to: string | string[], event: string, ...args: unknown[]) {
    this.events.push({ to, event, payload: args[0] });
  }
  disconnect() {}
  /** Events of this name that went to this user's room. */
  to(userId: string, event?: string) {
    const room = `user:${userId}`;
    return this.events.filter((e) => (Array.isArray(e.to) ? e.to.includes(room) : e.to === room) && (!event || e.event === event));
  }
  clear() {
    this.events.length = 0;
  }
}
