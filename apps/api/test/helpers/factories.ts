import { eq } from "drizzle-orm";
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

import { memberships } from "../../src/db/schema";
import type { MembershipRow } from "../../src/types/request";

export interface MembershipFactoryOptions {
  status?: MembershipRow["status"];
  role?: MembershipRow["role"];
  fullName?: string;
  batchYear?: number;
  city?: string;
  country?: string;
  companyName?: string;
  professionType?: MembershipRow["professionType"];
  dateOfBirth?: string | null;
  approvedAt?: Date;
}

export async function createMembership(ctx: TestContext, tenantId: string, userId: string, opts: MembershipFactoryOptions = {}) {
  const n = nextId();
  const [row] = await ctx.db
    .insert(memberships)
    .values({
      tenantId,
      userId,
      status: opts.status ?? "APPROVED",
      role: opts.role ?? "MEMBER",
      fullName: opts.fullName ?? `Member ${n}`,
      batchYear: opts.batchYear ?? 2010,
      professionType: opts.professionType ?? "EMPLOYED",
      companyName: opts.companyName ?? null,
      city: opts.city ?? "Mumbai",
      country: opts.country ?? "IN",
      dateOfBirth: opts.dateOfBirth ?? null,
      statusChangedAt: new Date(),
    })
    .returning();
  if (opts.approvedAt) {
    const [updated] = await ctx.db.update(memberships).set({ approvedAt: opts.approvedAt }).where(eq(memberships.id, row!.id)).returning();
    return updated!;
  }
  return row!;
}

/** Creates a user + membership in the tenant and logs them in. */
export async function memberSession(ctx: TestContext, tenantId: string, opts: MembershipFactoryOptions & { phone?: string } = {}) {
  const user = await createUser(ctx, { phone: opts.phone });
  const membership = await createMembership(ctx, tenantId, user.id, opts);
  const session = await loginAs(ctx, user.phoneE164);
  return { user, membership, token: session.accessToken, headers: auth(session.accessToken) };
}

export const PROFILE = {
  fullName: "Test Member",
  batchYear: 2012,
  professionType: "EMPLOYED",
  companyName: "Acme",
  designation: "Engineer",
  city: "Mumbai",
  country: "IN",
} as const;
