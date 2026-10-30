import { loadConfig } from "../../src/config/env";
import type { AppContext } from "../../src/context";
import { createJwtSigner } from "../../src/lib/jwt";
import { createLogger } from "../../src/lib/logger";
import { CapturingOtpSender, newRedisMock } from "./testContext";

/** Context for pure/Redis-only unit tests: no database handle. */
export function createUnitContext(overrides: Record<string, string | undefined> = {}) {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://unused", ...overrides });
  const otpCapture = new CapturingOtpSender();
  const ctx: AppContext & { otpCapture: CapturingOtpSender } = {
    config,
    db: null as unknown as AppContext["db"],
    redis: newRedisMock(),
    logger: createLogger("silent", false),
    jwt: createJwtSigner(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_SEC),
    otpSender: otpCapture,
    otpCapture,
  };
  return ctx;
}
