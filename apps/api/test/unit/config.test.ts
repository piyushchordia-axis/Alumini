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

  it("needs a sender address for SMTP and parses MSG91 flow template ids", () => {
    const dev = { NODE_ENV: "development", DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40), OTP_PEPPER: "p".repeat(20) };
    expect(() => loadConfig({ ...dev, SMTP_URL: "smtp://localhost:2525" })).toThrow(/EMAIL_FROM/);
    const c = loadConfig({ ...dev, MSG91_FLOW_TEMPLATE_IDS: " PLATFORM_TEST=65ab , INVITE=65cd,broken" });
    expect(c.msg91FlowTemplateIds).toEqual({ PLATFORM_TEST: "65ab", INVITE: "65cd" });
  });

  it("defaults payments to the mock outside production, refuses it in production, and needs all Razorpay secrets", () => {
    const dev = { NODE_ENV: "development", DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40), OTP_PEPPER: "p".repeat(20) };
    expect(loadConfig(dev).paymentsProvider).toBe("mock");
    const prod = { ...production, OTP_PROVIDER: "sms", MSG91_AUTH_KEY: "k", MSG91_TEMPLATE_ID: "t" };
    expect(loadConfig(prod).paymentsProvider).toBe("disabled");
    expect(() => loadConfig({ ...prod, PAYMENTS_PROVIDER: "mock" })).toThrow(/not allowed in production/);
    expect(() => loadConfig({ ...dev, PAYMENTS_PROVIDER: "razorpay", RAZORPAY_KEY_ID: "rzp_test_1" })).toThrow(/RAZORPAY_KEY_SECRET/);
    expect(loadConfig({ ...prod, PAYMENTS_PROVIDER: "razorpay", RAZORPAY_KEY_ID: "rzp_live_1", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w" }).paymentsProvider).toBe("razorpay");
  });

  it("defaults the web app URL outside production and leaves it unset (features off) in production", () => {
    expect(loadConfig({ NODE_ENV: "development", JWT_SECRET: "x".repeat(32), OTP_PEPPER: "p".repeat(16), DATABASE_URL: "postgres://x" }).webAppUrl).toBe("http://localhost:5173");
    const prod = { ...production, OTP_PROVIDER: "sms", MSG91_AUTH_KEY: "k", MSG91_TEMPLATE_ID: "t" };
    expect(loadConfig({ ...prod, WEB_APP_URL: "" }).webAppUrl).toBeNull();
    expect(loadConfig({ ...prod, WEB_APP_URL: "https://alumni.example.org/" }).webAppUrl).toBe("https://alumni.example.org");
    expect(() => loadConfig({ ...prod, WEB_APP_URL: "javascript:alert(1)" })).toThrow(/WEB_APP_URL/);
  });
});
