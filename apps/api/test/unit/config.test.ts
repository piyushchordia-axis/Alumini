import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://db/illuminize",
  JWT_SECRET: "x".repeat(48),
  OTP_PEPPER: "p".repeat(32),
  PUBLIC_BASE_URL: "https://api.example.com",
};

describe("config", () => {
  it("refuses the console OTP sender in production", () => {
    expect(() => loadConfig({ ...production, OTP_PROVIDER: "console" })).toThrow(/OTP_PROVIDER=console is not allowed in production/);
  });

  it("allows it only with the explicit demo escape hatch", () => {
    expect(loadConfig({ ...production, OTP_PROVIDER: "console", OTP_ALLOW_CONSOLE_IN_PRODUCTION: "true" }).OTP_PROVIDER).toBe("console");
  });

  it("never uses a fixed dev code in production", () => {
    const c = loadConfig({ ...production, OTP_PROVIDER: "sms", MSG91_AUTH_KEY: "k", MSG91_TEMPLATE_ID: "t", OTP_DEV_FIXED_CODE: "123456" });
    expect(c.OTP_DEV_FIXED_CODE).toBeUndefined();
  });

  it("runs background workers in the API process except in production", () => {
    expect(loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40), OTP_PEPPER: "p".repeat(20) }).workerMode).toBe("inline");
    expect(loadConfig({ ...production, OTP_PROVIDER: "sms", MSG91_AUTH_KEY: "k", MSG91_TEMPLATE_ID: "t" }).workerMode).toBe("separate");
    expect(loadConfig({ ...production, OTP_PROVIDER: "sms", MSG91_AUTH_KEY: "k", MSG91_TEMPLATE_ID: "t", WORKER_MODE: "inline" }).workerMode).toBe("inline");
  });
});
