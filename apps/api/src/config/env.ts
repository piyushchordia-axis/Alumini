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
  /** inline: background workers run inside the API process (default outside production); separate: `pnpm worker`. */
  WORKER_MODE: z.enum(["inline", "separate"]).optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  /** The separate worker answers GET /health here. */
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4001),
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
  /**
   * Where members open the web app, for links in emails and messages (email confirmation, invites, the digest).
   * Defaults to the Vite dev server outside production; in production, features that send links are off until set.
   */
  WEB_APP_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** Email confirmation links sent per day across the platform, a guard against abuse. */
  EMAIL_VERIFY_GLOBAL_DAILY_CAP: z.coerce.number().int().positive().default(5000),
  CORS_ORIGINS: z.string().default("*"),
  UPLOAD_DIR: z.string().default("./uploads"),
  TRUST_PROXY: z.string().default("loopback"),

  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Where uploaded images go: local disk (UPLOAD_DIR, served at /uploads) or an S3-compatible bucket. */
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().optional(),
  /** AWS region; Cloudflare R2 uses "auto". */
  S3_REGION: z.string().default("us-east-1"),
  /** For R2, Spaces or MinIO, e.g. https://<account>.r2.cloudflarestorage.com or http://localhost:9000. */
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Public URL prefix of the bucket or its CDN; image URLs are this plus the object key. */
  S3_PUBLIC_BASE_URL: z.string().optional(),
  /** Online payments: razorpay, mock (fake checkout for development) or disabled. Default: mock outside production. */
  PAYMENTS_PROVIDER: z.enum(["disabled", "mock", "razorpay"]).optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  /** The secret set on the webhook in the Razorpay dashboard. */
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Outbound email over SMTP, e.g. smtps://user:pass@smtp.zoho.in:465 or smtp://…:587 (STARTTLS). */
  SMTP_URL: z.string().optional(),
  /** Sender, e.g. "Illuminize <no-reply@illuminize.app>"; the domain needs SPF/DKIM for the SMTP provider. */
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  /** MSG91 flow (DLT) template id per message type: "PLATFORM_TEST=65ab…,INVITE=65cd…". */
  MSG91_FLOW_TEMPLATE_IDS: z.string().default(""),
  /**
   * Approved WhatsApp template per message type, as name:language: "INVITE=illuminize_invite:en,ANNOUNCEMENT=…".
   * A type without one skips WhatsApp (falls back to SMS/email).
   */
  WHATSAPP_TEMPLATES: z.string().default(""),
  /** Invitations one institution may send per day (WhatsApp/SMS/email cost money; also limits abuse). */
  INVITES_DAILY_LIMIT: z.coerce.number().int().positive().default(1000),
});

export type Config = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  platformAdminPhones: string[];
  corsOrigins: string[] | "*";
  uploadDirAbsolute: string;
  /** Resolved PAYMENTS_PROVIDER. */
  paymentsProvider: "disabled" | "mock" | "razorpay";
  /** Parsed MSG91_FLOW_TEMPLATE_IDS. */
  msg91FlowTemplateIds: Record<string, string>;
  /** Parsed WHATSAPP_TEMPLATES. */
  whatsappTemplates: Record<string, { name: string; language: string }>;
  /** Resolved WORKER_MODE: inline outside production unless set. */
  workerMode: "inline" | "separate";
  /** WEB_APP_URL without a trailing slash, or null in production when it is not set. */
  webAppUrl: string | null;
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
    workerMode: c.WORKER_MODE ?? (c.NODE_ENV === "production" ? "separate" : "inline"),
    paymentsProvider: c.PAYMENTS_PROVIDER ?? (c.NODE_ENV === "production" ? "disabled" : "mock"),
    msg91FlowTemplateIds: Object.fromEntries(
      c.MSG91_FLOW_TEMPLATE_IDS.split(",")
        .map((pair) => pair.split("=").map((x) => x.trim()) as [string, string | undefined])
        .filter((pair): pair is [string, string] => !!pair[0] && !!pair[1]),
    ),
    webAppUrl: (c.WEB_APP_URL ?? (c.NODE_ENV === "production" ? null : "http://localhost:5173"))?.replace(/\/+$/, "") ?? null,
    whatsappTemplates: Object.fromEntries(
      c.WHATSAPP_TEMPLATES.split(",")
        .map((pair) => pair.split("=").map((x) => x.trim()))
        .filter((pair): pair is [string, string] => !!pair[0] && !!pair[1])
        .map(([type, spec]) => {
          const [name, language] = spec.split(":").map((x) => x.trim());
          return [type, { name: name!, language: language || "en" }];
        }),
    ),
    platformAdminPhones,
    corsOrigins,
    uploadDirAbsolute: resolve(process.cwd(), c.UPLOAD_DIR),
  };

  if (config.isProduction && config.paymentsProvider === "mock") {
    throw new Error("PAYMENTS_PROVIDER=mock is not allowed in production (it accepts fake payments). Use razorpay or disabled.");
  }
  if (config.paymentsProvider === "razorpay" && !(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET && config.RAZORPAY_WEBHOOK_SECRET)) {
    throw new Error("PAYMENTS_PROVIDER=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET");
  }
  if (config.STORAGE_PROVIDER === "s3") {
    if (!config.S3_BUCKET || !config.S3_PUBLIC_BASE_URL) throw new Error("STORAGE_PROVIDER=s3 needs S3_BUCKET and S3_PUBLIC_BASE_URL");
    if (!!config.S3_ACCESS_KEY_ID !== !!config.S3_SECRET_ACCESS_KEY) throw new Error("Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (default AWS credentials)");
  }
  if (config.SMTP_URL && !config.EMAIL_FROM) {
    throw new Error("SMTP_URL is set but EMAIL_FROM is not; set the sender address, e.g. EMAIL_FROM=\"Illuminize <no-reply@example.com>\"");
  }
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
