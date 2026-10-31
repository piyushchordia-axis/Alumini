import Redis from "ioredis";

/**
 * Redis connections for BullMQ.
 * - producer: used by request handlers to enqueue. Fails fast when Redis is down (no offline queue, one retry), so a
 *   request never hangs on background work.
 * - worker: blocking commands; BullMQ requires maxRetriesPerRequest: null.
 */
export function createBullConnection(url: string, role: "producer" | "worker"): Redis {
  return role === "producer"
    ? new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, enableReadyCheck: true, lazyConnect: false })
    : new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}
