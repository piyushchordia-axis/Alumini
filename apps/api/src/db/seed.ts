import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { loadConfig, loadDotenvFiles } from "../config/env";
import { createDb, type Db } from "./client";
import { memberships, tenantSettings, tenants, users } from "./schema";

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

type MemberSeed = {
  phone: string;
  fullName: string;
  batchYear: number;
  professionType: (typeof memberships.$inferInsert)["professionType"];
  companyName?: string;
  designation?: string;
  city?: string;
  country?: string;
  status?: (typeof memberships.$inferInsert)["status"];
  role?: (typeof memberships.$inferInsert)["role"];
  bio?: string;
  interests?: string[];
  statusReason?: string;
};

export const SEED_MEMBERS: Record<string, MemberSeed[]> = {
  "demo-university": [
    { phone: "+919000000001", fullName: "Ananya Rao", batchYear: 2008, professionType: "EMPLOYED", companyName: "Infosys", designation: "Engineering Manager", city: "Bengaluru", country: "IN", role: "TENANT_ADMIN", bio: "Alumni office volunteer. Happy to help you reconnect." },
    { phone: "+919100000001", fullName: "Rahul Mehta", batchYear: 2012, professionType: "FOUNDER", companyName: "Zylo Labs", designation: "CEO", city: "Mumbai", country: "IN", bio: "Building fintech for SMEs. Always up for a coffee in Bandra.", interests: ["startups", "cricket"] },
    { phone: "+919100000002", fullName: "Priya Nair", batchYear: 2012, professionType: "EMPLOYED", companyName: "Google", designation: "Product Manager", city: "London", country: "GB", interests: ["travel", "product"] },
    { phone: "+919100000003", fullName: "Arjun Singh", batchYear: 2015, professionType: "BUSINESS_OWNER", companyName: "Singh Textiles", city: "Surat", country: "IN" },
    { phone: "+919100000004", fullName: "Meera Iyer", batchYear: 2018, professionType: "EMPLOYED", companyName: "Deloitte", designation: "Consultant", city: "Dubai", country: "AE" },
    { phone: "+919100000005", fullName: "Vikram Desai", batchYear: 2020, professionType: "STUDENT", companyName: "IIM Ahmedabad", city: "Ahmedabad", country: "IN" },
    { phone: "+919100000006", fullName: "Sneha Kulkarni", batchYear: 2008, professionType: "EMPLOYED", companyName: "Microsoft", designation: "Principal Engineer", city: "Seattle", country: "US" },
  ],
  "demo-college": [
    { phone: "+919000000002", fullName: "Suresh Patil", batchYear: 1998, professionType: "EMPLOYED", companyName: "Demo College", designation: "Alumni Relations Officer", city: "Pune", country: "IN", role: "TENANT_ADMIN" },
    { phone: "+919100000011", fullName: "Kiran Joshi", batchYear: 2005, professionType: "FOUNDER", companyName: "Joshi Robotics", city: "Pune", country: "IN" },
    { phone: "+919100000012", fullName: "Neha Sharma", batchYear: 2010, professionType: "EMPLOYED", companyName: "TCS", designation: "Architect", city: "Hyderabad", country: "IN" },
    { phone: "+919100000013", fullName: "Rohan Kapoor", batchYear: 2014, professionType: "EMPLOYED", companyName: "Amazon", designation: "SDE II", city: "Toronto", country: "CA" },
    { phone: "+919100000014", fullName: "Divya Menon", batchYear: 2019, professionType: "EMPLOYED", companyName: "Zomato", designation: "Analyst", city: "Gurugram", country: "IN", status: "PENDING" },
    { phone: "+919100000015", fullName: "Amit Verma", batchYear: 2016, professionType: "BUSINESS_OWNER", companyName: "Verma Agro", city: "Nashik", country: "IN", status: "PENDING" },
    { phone: "+919100000016", fullName: "Pooja Bhatt", batchYear: 2021, professionType: "STUDENT", city: "Pune", country: "IN", status: "PENDING" },
    { phone: "+919100000017", fullName: "Test Rejected", batchYear: 2001, professionType: "OTHER", city: "Pune", country: "IN", status: "REJECTED", statusReason: "Could not verify batch details" },
  ],
  "demo-school": [
    { phone: "+919000000003", fullName: "Lakshmi Krishnan", batchYear: 1995, professionType: "EMPLOYED", companyName: "Demo International School", designation: "Principal's Office", city: "Bengaluru", country: "IN", role: "TENANT_ADMIN" },
    { phone: "+919100000021", fullName: "Aditya Reddy", batchYear: 2004, professionType: "EMPLOYED", companyName: "Flipkart", designation: "Director", city: "Bengaluru", country: "IN" },
    { phone: "+919100000022", fullName: "Shreya Ghosh", batchYear: 2009, professionType: "FOUNDER", companyName: "Ghosh Design Studio", city: "Kolkata", country: "IN" },
    { phone: "+919100000023", fullName: "Nikhil Bose", batchYear: 2013, professionType: "EMPLOYED", companyName: "Goldman Sachs", designation: "VP", city: "Singapore", country: "SG" },
    { phone: "+919100000024", fullName: "Tara Pillai", batchYear: 2017, professionType: "EMPLOYED", companyName: "Swiggy", city: "Bengaluru", country: "IN", status: "PENDING" },
    { phone: "+919100000025", fullName: "Dev Malhotra", batchYear: 2022, professionType: "STUDENT", city: "Chennai", country: "IN", status: "PENDING" },
  ],
};

export async function seedMembers(db: Db, tenantIds: Record<string, string>): Promise<Record<string, string>> {
  const membershipIds: Record<string, string> = {};
  for (const [slug, members] of Object.entries(SEED_MEMBERS)) {
    const tenantId = tenantIds[slug];
    if (!tenantId) continue;
    for (const m of members) {
      const [user] = await db
        .insert(users)
        .values({ phoneE164: m.phone, phoneRegion: "IN", displayName: m.fullName })
        .onConflictDoUpdate({ target: users.phoneE164, set: { displayName: m.fullName } })
        .returning();
      const status = m.status ?? "APPROVED";
      const [row] = await db
        .insert(memberships)
        .values({
          tenantId,
          userId: user!.id,
          role: m.role ?? "MEMBER",
          status,
          statusReason: m.statusReason ?? null,
          statusChangedAt: status === "PENDING" ? null : new Date(),
          fullName: m.fullName,
          batchYear: m.batchYear,
          professionType: m.professionType,
          companyName: m.companyName ?? null,
          designation: m.designation ?? null,
          city: m.city ?? null,
          country: m.country ?? null,
          bio: m.bio ?? null,
          interests: m.interests ?? [],
          lastActiveAt: status === "APPROVED" ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [memberships.tenantId, memberships.userId],
          set: { fullName: m.fullName, role: m.role ?? "MEMBER", updatedAt: new Date() },
        })
        .returning();
      membershipIds[`${slug}:${m.phone}`] = row!.id;
    }
  }
  return membershipIds;
}

export async function seedAll(db: Db, platformAdminPhones: string[]): Promise<SeedResult & { memberships: number }> {
  const core = await seedCore(db, platformAdminPhones);
  const membershipIds = await seedMembers(db, core.tenantIds);
  return { ...core, memberships: Object.keys(membershipIds).length };
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
