import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { loadConfig, loadDotenvFiles } from "../config/env";
import { createDb, type Db } from "./client";
import { tenantSettings, tenants, users } from "./schema";

export interface SeedResult {
  tenantIds: Record<string, string>;
  platformAdminUserId: string;
}

export const SEED = {
  platformAdminPhone: "+919999999999",
  tenants: [
    {
      slug: "demo-university",
      name: "Demo University",
      shortName: "DemoU",
      type: "UNIVERSITY" as const,
      city: "Mumbai",
      country: "IN",
      primaryColor: "#1d4ed8",
      secondaryColor: "#0f172a",
      tagline: "Once a DemoU, always a DemoU.",
      welcomeMessage:
        "Welcome to the Demo University alumni network. Reconnect with your batch, share opportunities and meet up wherever you are.",
      memberApprovalMode: "AUTO_APPROVE" as const,
      contentModerationMode: "AUTO_APPROVE" as const,
      adminPhone: "+919000000001",
    },
    {
      slug: "demo-college",
      name: "Demo College of Engineering",
      shortName: "DCE",
      type: "COLLEGE" as const,
      city: "Pune",
      country: "IN",
      primaryColor: "#047857",
      secondaryColor: "#064e3b",
      tagline: "Engineering friendships for life.",
      welcomeMessage: "Alumni of DCE: your membership is reviewed by the alumni office before you get access.",
      memberApprovalMode: "ADMIN_APPROVAL" as const,
      contentModerationMode: "ADMIN_APPROVAL" as const,
      adminPhone: "+919000000002",
    },
    {
      slug: "demo-school",
      name: "Demo International School",
      shortName: "DIS",
      type: "SCHOOL" as const,
      city: "Bengaluru",
      country: "IN",
      primaryColor: "#b45309",
      secondaryColor: "#78350f",
      tagline: "Where it all began.",
      welcomeMessage: "The official DIS alumni community. Membership is approved by the school; posts go live immediately.",
      memberApprovalMode: "ADMIN_APPROVAL" as const,
      contentModerationMode: "AUTO_APPROVE" as const,
      adminPhone: "+919000000003",
    },
  ],
};

export async function seedCore(db: Db, platformAdminPhones: string[]): Promise<SeedResult> {
  const tenantIds: Record<string, string> = {};
  for (const t of SEED.tenants) {
    const [row] = await db
      .insert(tenants)
      .values({
        slug: t.slug,
        name: t.name,
        shortName: t.shortName,
        type: t.type,
        city: t.city,
        country: t.country,
        primaryColor: t.primaryColor,
        secondaryColor: t.secondaryColor,
        tagline: t.tagline,
        welcomeMessage: t.welcomeMessage,
      })
      .onConflictDoUpdate({
        target: tenants.slug,
        set: { name: t.name, shortName: t.shortName, type: t.type, city: t.city, country: t.country, updatedAt: new Date() },
      })
      .returning();
    tenantIds[t.slug] = row!.id;
    await db
      .insert(tenantSettings)
      .values({
        tenantId: row!.id,
        memberApprovalMode: t.memberApprovalMode,
        contentModerationMode: t.contentModerationMode,
        maxBatchYear: new Date().getFullYear() + 6,
      })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: { memberApprovalMode: t.memberApprovalMode, contentModerationMode: t.contentModerationMode, updatedAt: new Date() },
      });
  }

  const adminPhone = platformAdminPhones[0] ?? SEED.platformAdminPhone;
  const [admin] = await db
    .insert(users)
    .values({ phoneE164: adminPhone, phoneRegion: "IN", displayName: "Illuminize Admin", isPlatformAdmin: true })
    .onConflictDoUpdate({ target: users.phoneE164, set: { isPlatformAdmin: true, updatedAt: new Date() } })
    .returning();
  await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, admin!.id));

  return { tenantIds, platformAdminUserId: admin!.id };
}

export async function seedAll(db: Db, platformAdminPhones: string[]): Promise<SeedResult> {
  return seedCore(db, platformAdminPhones);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  loadDotenvFiles();
  const config = loadConfig();
  const { pool, db } = createDb(config.DATABASE_URL);
  seedAll(db, config.platformAdminPhones)
    .then((r) => {
      console.log("Seeded:", JSON.stringify(r, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
