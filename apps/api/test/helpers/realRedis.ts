import Redis from "ioredis";

/**
 * Whether a real Redis is reachable at REDIS_URL. BullMQ and the Socket.IO Redis adapter need one (ioredis-mock cannot
 * run their Lua scripts), so those tests are skipped without it. CI sets REQUIRE_REAL_REDIS=1 so they never silently
 * skip there.
 */
export async function isRealRedisAvailable(url = process.env.REDIS_URL ?? "redis://localhost:6379/1"): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, connectTimeout: 1000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    if (process.env.REQUIRE_REAL_REDIS === "1") throw new Error(`REQUIRE_REAL_REDIS=1 but Redis is not reachable at ${url}`);
    return false;
  } finally {
    client.disconnect();
  }
}

export const realRedisUrl = () => process.env.REDIS_URL ?? "redis://localhost:6379/1";
