import type http from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { REALTIME_PATH, type ClientToServerEvents, type ServerToClientEvents } from "@illuminize/shared";
import { Server, type Socket } from "socket.io";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { createRedis } from "../redis/client";
import { isSessionAlive } from "../services/token.service";
import { SocketIoPublisher } from "./publisher";
import { rooms } from "./rooms";

export interface SocketData {
  userId: string;
  sid: string;
  isPlatformAdmin: boolean;
  /** Access token expiry, seconds since epoch. */
  exp: number;
}

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type RealtimeSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Error a handshake rejection carries to the client (`err.data.code`). */
function handshakeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { data: { code } });
}

/** Browsers send an Origin header; it must be an allowed web origin. Native apps send none. */
function originAllowed(origin: string | undefined, allowed: string[] | "*"): boolean {
  if (!origin || allowed === "*") return true;
  return allowed.includes(origin);
}

/**
 * Attaches Socket.IO to the API's HTTP server: access-token handshake, per-user and per-session rooms, and a
 * disconnect when the token expires (the client refreshes and reconnects). With the Redis adapter, events and
 * disconnects reach sockets on every API node.
 */
export function attachRealtime(server: http.Server, ctx: AppContext, o: { adapter?: "redis" | "memory"; key?: string } = {}) {
  const io: RealtimeServer = new Server(server, {
    path: REALTIME_PATH,
    transports: ["websocket"],
    maxHttpBufferSize: 100_000,
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, ctx.config.corsOrigins)),
  });

  const redisClients: Array<ReturnType<typeof createRedis>> = [];
  if ((o.adapter ?? "redis") === "redis") {
    const pub = createRedis(ctx.config.REDIS_URL);
    const sub = pub.duplicate();
    pub.on("error", (err) => ctx.logger.error({ err }, "Realtime Redis error"));
    sub.on("error", (err) => ctx.logger.error({ err }, "Realtime Redis error"));
    redisClients.push(pub, sub);
    // `key` prefixes the Redis channels; nodes (and the worker's emitter) must share it. Default "socket.io".
    io.adapter(createAdapter(pub, sub, o.key ? { key: o.key } : {}));
  }

  io.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string" || !token) return next(handshakeError("UNAUTHENTICATED", "Sign in to receive live updates"));
    try {
      const claims = await ctx.jwt.verify(token);
      if (!(await isSessionAlive(ctx, claims.sid))) return next(handshakeError("SESSION_REVOKED", "Session has ended"));
      socket.data = { userId: claims.sub, sid: claims.sid, isPlatformAdmin: claims.pa, exp: claims.exp };
      next();
    } catch (err) {
      const code = err instanceof AppError ? err.code : "UNAUTHENTICATED";
      next(handshakeError(code, err instanceof Error ? err.message : "Invalid token"));
    }
  });

  io.on("connection", (socket: RealtimeSocket) => {
    const { userId, sid, exp } = socket.data;
    void (async () => {
      await socket.join([rooms.user(userId), rooms.session(sid)]);
      // A sign-out may have landed between the handshake and joining the rooms.
      if (!(await isSessionAlive(ctx, sid))) socket.disconnect(true);
    })().catch((err: unknown) => {
      // Nothing else awaits this, and an unhandled rejection kills the API. The client reconnects and tries again.
      ctx.logger.error({ err }, "Could not set up a live connection");
      socket.disconnect(true);
    });
    const expiresIn = Math.max(exp * 1000 - Date.now(), 0);
    const timer = setTimeout(() => {
      socket.emit("auth:expired");
      socket.disconnect(true);
    }, expiresIn);
    socket.on("disconnect", () => clearTimeout(timer));
  });

  return {
    io,
    publisher: new SocketIoPublisher(io),
    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.all(redisClients.map((c) => c.quit().catch(() => undefined)));
    },
  };
}
