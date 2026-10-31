import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379/0"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  OTP_PEPPER: z.string().min(16, "OTP_PEPPER must be at least 16 characters"),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  OTP_PROVIDER: z.enum(["console", "whatsapp", "sms"]).default("console"),
  OTP_DEV_FIXED_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  OTP_GLOBAL_DAILY_CAP: z.coerce.number().int().positive().default(5000),
  /** Time zone for billing periods and member activity days (IANA name). */
  BILLING_TIMEZONE: z
    .string()
    .default("Asia/Kolkata")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone"),
  /** Image uploads allowed per institution per day (all members together), a guard against storage abuse. */
  UPLOADS_PER_TENANT_DAILY_CAP: z.coerce.number().int().positive().default(2000),
  /** Escape hatch for throwaway demo deployments: lets production run with the console OTP sender. Never in real use. */
  OTP_ALLOW_CONSOLE_IN_PRODUCTION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_TEMPLATE_NAME: z.string().default("illuminize_otp"),
  WHATSAPP_TEMPLATE_LANG: z.string().default("en_US"),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),

  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),

  PLATFORM_ADMIN_PHONES: z.string().default(""),

  PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
  CORS_ORIGINS: z.string().default("*"),
  UPLOAD_DIR: z.string().default("./uploads"),
  TRUST_PROXY: z.string().default("loopback"),

  EXPO_ACCESS_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  platformAdminPhones: string[];
  corsOrigins: string[] | "*";
  uploadDirAbsolute: string;
};

const emptyToUndefined = (v: string | undefined) => (v === "" ? undefined : v);

export function loadConfig(overrides: Record<string, string | undefined> = {}): Config {
  const env = { ...process.env, ...overrides };
  const cleaned = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, emptyToUndefined(v)]));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const c = parsed.data;
  const platformAdminPhones = c.PLATFORM_ADMIN_PHONES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const corsOrigins =
    c.CORS_ORIGINS.trim() === "*"
      ? ("*" as const)
      : c.CORS_ORIGINS.split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  const config: Config = {
    ...c,
    OTP_DEV_FIXED_CODE: c.NODE_ENV === "production" ? undefined : c.OTP_DEV_FIXED_CODE,
    isProduction: c.NODE_ENV === "production",
    isDevelopment: c.NODE_ENV === "development",
    isTest: c.NODE_ENV === "test",
    platformAdminPhones,
    corsOrigins,
    uploadDirAbsolute: resolve(process.cwd(), c.UPLOAD_DIR),
  };

  if (config.isProduction && config.OTP_PROVIDER === "console" && !config.OTP_ALLOW_CONSOLE_IN_PRODUCTION) {
    // The console sender only logs codes, so anyone with log access could sign in as anyone.
    throw new Error("OTP_PROVIDER=console is not allowed in production. Use whatsapp or sms (or set OTP_ALLOW_CONSOLE_IN_PRODUCTION=true for a throwaway demo).");
  }
  if (config.isProduction && config.OTP_PROVIDER === "whatsapp") {
    if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error("OTP_PROVIDER=whatsapp requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID");
    }
    if (!config.MSG91_AUTH_KEY || !config.MSG91_TEMPLATE_ID) {
      throw new Error("OTP_PROVIDER=whatsapp in production requires an SMS fallback (MSG91_AUTH_KEY, MSG91_TEMPLATE_ID)");
    }
  }
  return config;
}

/** Loads `.env` (or `.env.test` under NODE_ENV=test) from the API package root, without overriding existing vars. */
export function loadDotenvFiles(): void {
  const file = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
  loadDotenv({ path: resolve(process.cwd(), file), quiet: true });
}
