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
