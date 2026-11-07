import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  describe("private storage", () => {
    const dev = { NODE_ENV: "development", DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40), OTP_PEPPER: "p".repeat(20) };
    const root = resolve(tmpdir(), "illuminize-config");

    it("keeps chat files in a folder of their own beside the public uploads", () => {
      // The test environment sets both folders (.env.test); left unset, they take their defaults.
      const c = loadConfig({ ...dev, UPLOAD_DIR: undefined, PRIVATE_UPLOAD_DIR: undefined });
      expect(c.privateUploadDirAbsolute).toBe(resolve(process.cwd(), "private-uploads"));
      expect(c.uploadDirAbsolute).toBe(resolve(process.cwd(), "uploads"));
      expect(c.CHAT_FILES_PER_TENANT_DAILY_CAP).toBe(3000);
      expect(loadConfig({ ...dev, UPLOAD_DIR: join(root, "uploads"), PRIVATE_UPLOAD_DIR: join(root, "uploads-private") }).privateUploadDirAbsolute).toBe(join(root, "uploads-private"));
    });

    it("refuses a private folder inside the public one, the same folder, or one holding it", () => {
      const refusal = /PRIVATE_UPLOAD_DIR must not be inside UPLOAD_DIR/;
      expect(() => loadConfig({ ...dev, UPLOAD_DIR: join(root, "uploads"), PRIVATE_UPLOAD_DIR: join(root, "uploads", "private") })).toThrow(refusal);
      expect(() => loadConfig({ ...dev, UPLOAD_DIR: "./uploads", PRIVATE_UPLOAD_DIR: "./uploads/../uploads/chat" })).toThrow(refusal);
      expect(() => loadConfig({ ...dev, UPLOAD_DIR: join(root, "files"), PRIVATE_UPLOAD_DIR: join(root, "files") })).toThrow(refusal);
      expect(() => loadConfig({ ...dev, UPLOAD_DIR: join(root, "data", "uploads"), PRIVATE_UPLOAD_DIR: join(root, "data") })).toThrow(refusal);
      // With S3 nothing private is written to disk, but /uploads still serves UPLOAD_DIR, so the rule stands.
      expect(() =>
        loadConfig({ ...dev, STORAGE_PROVIDER: "s3", S3_BUCKET: "b", S3_PUBLIC_BASE_URL: "https://cdn", S3_PRIVATE_BUCKET: "p", UPLOAD_DIR: root, PRIVATE_UPLOAD_DIR: join(root, "p") }),
      ).toThrow(refusal);
    });

    it.runIf(process.platform === "win32")("compares folders without case on Windows", () => {
      expect(() => loadConfig({ ...dev, UPLOAD_DIR: "C:\\Data\\Uploads", PRIVATE_UPLOAD_DIR: "c:\\data\\uploads\\chat" })).toThrow(/PRIVATE_UPLOAD_DIR/);
    });

    it("needs a private bucket of its own with S3", () => {
      const s3 = { ...dev, STORAGE_PROVIDER: "s3", S3_BUCKET: "illuminize", S3_PUBLIC_BASE_URL: "https://cdn.example.com" };
      expect(() => loadConfig(s3)).toThrow(/needs S3_PRIVATE_BUCKET/);
      expect(() => loadConfig({ ...s3, S3_PRIVATE_BUCKET: "illuminize" })).toThrow(/must be a different bucket from S3_BUCKET/);
      expect(() => loadConfig({ ...s3, S3_PRIVATE_BUCKET: " Illuminize " })).toThrow(/must be a different bucket/);
      expect(loadConfig({ ...s3, S3_PRIVATE_BUCKET: "illuminize-private" }).S3_PRIVATE_BUCKET).toBe("illuminize-private");
    });

    it("takes a file link key of 32 characters or more", () => {
      expect(() => loadConfig({ ...dev, FILE_URL_KEY: "short" })).toThrow(/FILE_URL_KEY must be at least 32 characters/);
      expect(loadConfig({ ...dev, FILE_URL_KEY: "f".repeat(32) }).FILE_URL_KEY).toBe("f".repeat(32));
      expect(loadConfig({ ...dev, FILE_URL_KEY: "" }).FILE_URL_KEY).toBeUndefined();
    });
  });

  it("defaults the web app URL outside production and leaves it unset (features off) in production", () => {
    expect(loadConfig({ NODE_ENV: "development", JWT_SECRET: "x".repeat(32), OTP_PEPPER: "p".repeat(16), DATABASE_URL: "postgres://x" }).webAppUrl).toBe("http://localhost:5173");
    const prod = { ...production, OTP_PROVIDER: "sms", MSG91_AUTH_KEY: "k", MSG91_TEMPLATE_ID: "t" };
    expect(loadConfig({ ...prod, WEB_APP_URL: "" }).webAppUrl).toBeNull();
    expect(loadConfig({ ...prod, WEB_APP_URL: "https://alumni.example.org/" }).webAppUrl).toBe("https://alumni.example.org");
    expect(() => loadConfig({ ...prod, WEB_APP_URL: "javascript:alert(1)" })).toThrow(/WEB_APP_URL/);
  });
});
