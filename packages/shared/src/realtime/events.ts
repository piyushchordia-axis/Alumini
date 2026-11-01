import type { ErrorCode } from "../errorCodes";
import type { NotificationDto } from "../types/dto";

/**
 * Live events over Socket.IO. Names are "domain:verb"; every tenant-scoped payload carries tenantSlug so a client
 * signed in to several institutions can route it. Events from the client always take an ack (AckResult), mirroring the
 * REST error shape. Wave 2 adds chat ("chat:message", "chat:read", "chat:typing", "chat:join").
 */
export interface NotificationEvent {
  tenantSlug: string;
  membershipId: string;
  notification: NotificationDto;
  /** The recipient's unread count after this notification. */
  unreadCount: number;
}

export interface UnreadEvent {
  tenantSlug: string;
  membershipId: string;
  count: number;
}

export interface ServerToClientEvents {
  "notification:new": (payload: NotificationEvent) => void;
  "notification:unread": (payload: UnreadEvent) => void;
  /** The access token used to connect has expired; the server disconnects right after. Refresh and reconnect. */
  "auth:expired": () => void;
}

export type AckResult<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by chat in Wave 2
export interface ClientToServerEvents {}

/** HTTP path of the Socket.IO endpoint (same origin as the API). */
export const REALTIME_PATH = "/socket.io";
