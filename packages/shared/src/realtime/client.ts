import { io, type Socket } from "socket.io-client";
import { REALTIME_PATH, type ClientToServerEvents, type ServerToClientEvents } from "./events";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "disconnected";

export interface RealtimeClientOptions {
  /** API origin, e.g. https://api.example.com; "" for the page's own origin (web behind a proxy). */
  baseUrl: string;
  /** The current access token (read on every connect, so a refreshed token is picked up). */
  getAccessToken(): Promise<string | null>;
  /** Refreshes the session (the API client's single-flight refresh); resolves null when the session is over, rejects when it got no answer. */
  refresh(): Promise<unknown>;
  /** How long to wait before trying again after a refresh that got no answer. */
  refreshRetryMs?: number;
}

export interface RealtimeClient {
  /** Connects (idempotent). */
  start(): void;
  /** Disconnects and stays disconnected until start() (idempotent). */
  stop(): void;
  on<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]): () => void;
  onStatus(listener: (status: RealtimeStatus) => void): () => void;
  /** Called after a reconnect, so callers can refetch what they may have missed while disconnected. */
  onReconnect(listener: () => void): () => void;
  readonly status: RealtimeStatus;
}

/** Consecutive authentication failures before the client gives up (until the next start()). */
const MAX_AUTH_FAILURES = 3;

const REFRESH_RETRY_MS = 30_000;

/**
 * Typed Socket.IO client shared by the web and mobile apps. WebSocket transport only (works in browsers and React
 * Native, and needs no sticky sessions). An expired token is refreshed through the API client and the socket
 * reconnects; a revoked or invalid session stops it.
 */
export function createRealtimeClient(opts: RealtimeClientOptions): RealtimeClient {
  type AnyHandler = (...args: unknown[]) => void;
  let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  let started = false;
  let status: RealtimeStatus = "idle";
  let everConnected = false;
  let expired = false;
  let authFailures = 0;
  let refreshRetry: ReturnType<typeof setTimeout> | undefined;
  const handlers = new Map<string, Set<AnyHandler>>();
  const statusListeners = new Set<(s: RealtimeStatus) => void>();
  const reconnectListeners = new Set<() => void>();

  const setStatus = (next: RealtimeStatus) => {
    if (next === status) return;
    status = next;
    statusListeners.forEach((l) => l(next));
  };

  const refreshAndReconnect = async () => {
    authFailures += 1;
    if (authFailures > MAX_AUTH_FAILURES) return stopInternal("disconnected");
    let result: unknown;
    try {
      result = await opts.refresh();
    } catch {
      // No answer, so the session may well be fine. Nothing restarts this client on the web, so it has to keep trying itself.
      authFailures -= 1;
      setStatus("disconnected");
      if (started) refreshRetry = setTimeout(() => void refreshAndReconnect(), opts.refreshRetryMs ?? REFRESH_RETRY_MS);
      return;
    }
    if (!result) return stopInternal("disconnected");
    if (started && socket && !socket.connected) socket.connect();
  };

  const stopInternal = (next: RealtimeStatus) => {
    started = false;
    clearTimeout(refreshRetry);
    socket?.disconnect();
    setStatus(next);
  };

  const ensureSocket = () => {
    if (socket) return socket;
    const s: Socket<ServerToClientEvents, ClientToServerEvents> = io(opts.baseUrl || undefined, {
      path: REALTIME_PATH,
      transports: ["websocket"],
      autoConnect: false,
      reconnectionDelayMax: 30_000,
      auth: (cb) => {
        opts.getAccessToken().then(
          (token) => cb({ token: token ?? "" }),
          () => cb({ token: "" }),
        );
      },
    });
    s.on("connect", () => {
      authFailures = 0;
      expired = false;
      setStatus("connected");
      if (everConnected) reconnectListeners.forEach((l) => l());
      everConnected = true;
    });
    s.on("disconnect", (reason) => {
      if (!started) return;
      setStatus("disconnected");
      // The server only disconnects us on purpose: after "auth:expired" (refresh and come back) or when the session
      // was revoked (sign-out elsewhere; stay disconnected).
      if (reason === "io server disconnect" && expired) void refreshAndReconnect();
    });
    s.on("connect_error", (err) => {
      const code = (err as { data?: { code?: string } }).data?.code;
      if (code === "TOKEN_EXPIRED") void refreshAndReconnect();
      else if (code === "SESSION_REVOKED" || code === "UNAUTHENTICATED") stopInternal("disconnected");
      else setStatus("disconnected"); // network problem: Socket.IO keeps retrying with backoff
    });
    s.on("auth:expired", () => {
      expired = true;
    });
    for (const [event, set] of handlers) for (const h of set) s.on(event as keyof ServerToClientEvents, h as never);
    socket = s;
    return s;
  };

  return {
    start() {
      if (started) return;
      started = true;
      authFailures = 0;
      const s = ensureSocket();
      if (!s.connected) {
        setStatus("connecting");
        s.connect();
      }
    },
    stop() {
      if (!started && status === "idle") return;
      stopInternal("idle");
    },
    on(event, handler) {
      const set = handlers.get(event) ?? new Set<AnyHandler>();
      set.add(handler as AnyHandler);
      handlers.set(event, set);
      socket?.on(event, handler as never);
      return () => {
        set.delete(handler as AnyHandler);
        socket?.off(event, handler as never);
      };
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onReconnect(listener) {
      reconnectListeners.add(listener);
      return () => reconnectListeners.delete(listener);
    },
    get status() {
      return status;
    },
  };
}
