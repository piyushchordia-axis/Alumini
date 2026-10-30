import { tenantSettings, tenants, users } from "../../src/db/schema";
import type { TestContext } from "./testContext";
import type { ApprovalMode } from "@illuminize/shared";

let counter = 0;
export const nextId = () => ++counter;

export interface TenantFactoryOptions {
  slug?: string;
  name?: string;
  memberApprovalMode?: ApprovalMode;
  contentModerationMode?: ApprovalMode;
  allowSelfRegistration?: boolean;
  status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
}

export async function createTenant(ctx: TestContext, opts: TenantFactoryOptions = {}) {
  const n = nextId();
  const [tenant] = await ctx.db
    .insert(tenants)
    .values({
      slug: opts.slug ?? `tenant-${n}`,
      name: opts.name ?? `Tenant ${n}`,
      type: "COLLEGE",
      status: opts.status ?? "ACTIVE",
      city: "Mumbai",
      country: "IN",
    })
    .returning();
  const [settings] = await ctx.db
    .insert(tenantSettings)
    .values({
      tenantId: tenant!.id,
      memberApprovalMode: opts.memberApprovalMode ?? "AUTO_APPROVE",
      contentModerationMode: opts.contentModerationMode ?? "AUTO_APPROVE",
      allowSelfRegistration: opts.allowSelfRegistration ?? true,
      maxBatchYear: new Date().getFullYear() + 6,
    })
    .returning();
  return { tenant: tenant!, settings: settings! };
}

export async function createUser(ctx: TestContext, opts: { phone?: string; isPlatformAdmin?: boolean } = {}) {
  const n = nextId();
  const [user] = await ctx.db
    .insert(users)
    .values({
      phoneE164: opts.phone ?? `+9190000${String(n).padStart(5, "0")}`,
      phoneRegion: "IN",
      isPlatformAdmin: opts.isPlatformAdmin ?? false,
    })
    .returning();
  return user!;
}

/** Logs a user in through the real OTP flow and returns tokens. */
export async function loginAs(ctx: TestContext, phone: string) {
  const { default: request } = await import("supertest");
  const req = await request(ctx.app).post("/api/v1/auth/otp/request").send({ phone });
  if (req.status !== 200) throw new Error(`OTP request failed: ${JSON.stringify(req.body)}`);
  const code = ctx.otpCapture.codes.get(phone);
  if (!code) throw new Error(`No OTP captured for ${phone}`);
  const verify = await request(ctx.app).post("/api/v1/auth/otp/verify").send({ phone, code });
  if (verify.status !== 200) throw new Error(`OTP verify failed: ${JSON.stringify(verify.body)}`);
  return verify.body.data as { accessToken: string; refreshToken: string; user: { id: string; isPlatformAdmin: boolean } };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
