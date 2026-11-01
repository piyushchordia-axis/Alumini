import type { Emitter } from "@socket.io/redis-emitter";
import type { ServerToClientEvents } from "@illuminize/shared";
import type { Server } from "socket.io";

/** Sends live events to rooms, from the API process or a separate worker. */
export interface RealtimePublisher {
  emit<E extends keyof ServerToClientEvents>(to: string | string[], event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
  /** Closes the sockets in these rooms (sign-out, revoked sessions). */
  disconnect(rooms: string | string[]): void;
}

/** In the API process (and inline workers): through the Socket.IO server, which fans out to other nodes via Redis. */
export class SocketIoPublisher implements RealtimePublisher {
  constructor(private readonly io: Server) {}
  emit<E extends keyof ServerToClientEvents>(to: string | string[], event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
    (this.io.to(to).emit as (e: string, ...a: unknown[]) => boolean)(event, ...args);
  }
  disconnect(rooms: string | string[]): void {
    this.io.in(rooms).disconnectSockets(true);
  }
}

/** In a separate worker process: publishes through Redis to every API node's Socket.IO server. */
export class RedisEmitterPublisher implements RealtimePublisher {
  constructor(private readonly emitter: Emitter) {}
  emit<E extends keyof ServerToClientEvents>(to: string | string[], event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
    (this.emitter.to(to).emit as (e: string, ...a: unknown[]) => boolean)(event, ...args);
  }
  disconnect(rooms: string | string[]): void {
    this.emitter.in(rooms).disconnectSockets(true);
  }
}

/** No live connections (tests, scripts). */
export class NoopRealtimePublisher implements RealtimePublisher {
  emit(): void {}
  disconnect(): void {}
}
