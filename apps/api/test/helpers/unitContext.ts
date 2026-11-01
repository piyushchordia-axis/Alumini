import { loadConfig } from "../../src/config/env";
import type { AppContext } from "../../src/context";
import { MemoryJobQueue } from "../../src/jobs/MemoryJobQueue";
import { createJwtSigner } from "../../src/lib/jwt";
import { NoopRealtimePublisher } from "../../src/realtime/publisher";
import { createLogger } from "../../src/lib/logger";
import { createStorage } from "../../src/services/storage";
import { CapturingOtpSender, newRedisMock } from "./testContext";

/** Context for pure/Redis-only unit tests: no database handle. */
export function createUnitContext(overrides: Record<string, string | undefined> = {}) {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://unused", ...overrides });
  const otpCapture = new CapturingOtpSender();
  const ctx = {
    config,
    db: null as unknown as AppContext["db"],
    redis: newRedisMock(),
    logger: createLogger("silent", false),
    jwt: createJwtSigner(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_SEC),
    otpSender: otpCapture,
    storage: createStorage(config),
    messageSenders: {},
    realtime: new NoopRealtimePublisher(),
    payments: { provider: null, purposes: {} },
    otpCapture,
  } as unknown as AppContext & { otpCapture: CapturingOtpSender; jobs: MemoryJobQueue };
  ctx.jobs = new MemoryJobQueue(() => ctx);
  return ctx;
}
