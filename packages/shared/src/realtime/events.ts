import type { NotificationType } from "../constants";
import type { ChatMessageDto, NotificationDto } from "../types/dto";

/**
 * Live events over Socket.IO, always server to client: every write goes over REST, which already has tenant status,
 * membership checks, feature gates, rate limits and token refresh. Names are "domain:verb"; every tenant-scoped payload
 * carries tenantSlug so a client signed in to several institutions can route it.
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

/**
 * Sent instead of notification:new when one notification goes to many members at once (an announcement): one
 * broadcast rather than a message per member. Clients refetch their notifications (and the feed for announcements).
 */
export interface BulkNotificationEvent {
  tenantSlug: string;
  type: NotificationType;
  postId?: string;
}

export interface ChatMessageEvent {
  tenantSlug: string;
  conversationId: string;
  message: ChatMessageDto;
}

/** The member read a thread on another device. Only ever goes to their own devices: there are no read receipts. */
export interface ChatReadEvent {
  tenantSlug: string;
  conversationId: string;
  membershipId: string;
  lastReadSeq: number;
}

export interface ChatRemovedEvent {
  tenantSlug: string;
  conversationId: string;
  messageId: string;
  seq: number;
}

/** Something about this thread changed, so refetch it. Carries no content, because a request's recipient gets only this. */
export interface ChatChangedEvent {
  tenantSlug: string;
  conversationId: string;
}

export interface ChatUnreadEvent {
  tenantSlug: string;
  membershipId: string;
  /** Conversations with something unread, not messages. */
  unread: number;
  requests: number;
  /** Group invitations waiting for an answer. */
  invites: number;
}

export interface ServerToClientEvents {
  "notification:new": (payload: NotificationEvent) => void;
  "notification:bulk": (payload: BulkNotificationEvent) => void;
  "notification:unread": (payload: UnreadEvent) => void;
  "chat:message": (payload: ChatMessageEvent) => void;
  "chat:read": (payload: ChatReadEvent) => void;
  "chat:removed": (payload: ChatRemovedEvent) => void;
  "chat:changed": (payload: ChatChangedEvent) => void;
  "chat:unread": (payload: ChatUnreadEvent) => void;
  /** The access token used to connect has expired; the server disconnects right after. Refresh and reconnect. */
  "auth:expired": () => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the socket stays server to client, see above
export interface ClientToServerEvents {}

/** HTTP path of the Socket.IO endpoint (same origin as the API). */
export const REALTIME_PATH = "/socket.io";
