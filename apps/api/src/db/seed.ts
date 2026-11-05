import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultFeaturesFor,
  normalizeSkills,
  sortEducation,
  sortExperiences,
  toMinor,
  type Industry,
  type MentorArea,
  type MentorAvailability,
  type OpenTo,
  type ProfileEducationDto,
  type ProfileExperienceDto,
} from "@illuminize/shared";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { loadConfig, loadDotenvFiles } from "../config/env";
import { createLogger } from "../lib/logger";
import { runInTransaction } from "../lib/transaction";
import { lockDirectConversation, reportContextIds, seedDirectThread } from "../repositories/chat.repo";
import { seedGroup } from "../repositories/chatGroups.repo";
import { createDb, type Db } from "./client";
import { seedDemoHistory, type DemoHistoryResult } from "./seedDemoHistory";
import { sql } from "drizzle-orm";
import { businessListings, chatConversations, chatGroups, chatMessages, chatReports, contentReports, eventRsvps, events, fundingListings, jobSeekers, jobs, memberships, mentorProfiles, mentorships, postComments, postReactions, posts, referralRequests, tenantBillingPlans, tenantSettings, tenants, users } from "./schema";

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
    {
      slug: "shri-gujarati-samaj",
      name: "Shri Gujarati Samaj",
      shortName: "SGS",
      type: "OTHER" as const,
      city: "Ahmedabad",
      country: "IN",
      primaryColor: "#c2410c",
      secondaryColor: "#7c2d12",
      tagline: "Community, culture and connection.",
      welcomeMessage:
        "Welcome to the Shri Gujarati Samaj member network. Stay in touch with the community, share opportunities and take part in events.",
      memberApprovalMode: "ADMIN_APPROVAL" as const,
      contentModerationMode: "AUTO_APPROVE" as const,
      adminPhone: "+919000000004",
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
        features: defaultFeaturesFor(t.type),
      })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        // Not features: reseeding must not override an admin's choice.
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
  "shri-gujarati-samaj": [
    { phone: "+919000000004", fullName: "Jignesh Patel", batchYear: 1998, professionType: "EMPLOYED", companyName: "Shri Gujarati Samaj", designation: "Community Administrator", city: "Ahmedabad", country: "IN", role: "TENANT_ADMIN", bio: "Looking after member approvals and community events for the Samaj." },
    { phone: "+919100000031", fullName: "Hetal Shah", batchYear: 2005, professionType: "BUSINESS_OWNER", companyName: "Shah Fabrics", designation: "Proprietor", city: "Surat", country: "IN", bio: "Third-generation textile trader. Happy to help members sourcing fabric or visiting Surat.", interests: ["textiles", "trade"] },
    { phone: "+919100000032", fullName: "Ravi Mehta", batchYear: 2012, professionType: "EMPLOYED", companyName: "Tata Consultancy Services", designation: "Product Manager", city: "Ahmedabad", country: "IN", bio: "Product at TCS Digital. Often in London for client work.", interests: ["product", "startups"] },
    { phone: "+919100000033", fullName: "Kiran Parikh", batchYear: 2008, professionType: "BUSINESS_OWNER", companyName: "Parikh Jewellers", designation: "Managing Partner", city: "Surat", country: "IN", bio: "Diamond and gold jewellery for retail and export.", interests: ["jewellery", "export"] },
    { phone: "+919100000034", fullName: "Asha Desai", batchYear: 2022, professionType: "STUDENT", companyName: "Nirma University", city: "Ahmedabad", country: "IN", bio: "Final-year BBA. Looking for internships in marketing or operations." },
    { phone: "+919100000035", fullName: "Bhavin Trivedi", batchYear: 1996, professionType: "EMPLOYED", companyName: "HDFC Bank", designation: "Senior Vice President", city: "Ahmedabad", country: "IN", bio: "SME banking. Glad to mentor members starting or expanding a business.", interests: ["finance", "mentoring"] },
    { phone: "+919100000036", fullName: "Nisha Modi", batchYear: 2010, professionType: "EMPLOYED", companyName: "Deloitte", designation: "Senior Consultant", city: "New Jersey", country: "US", bio: "Strategy consulting in the US. Happy to chat about moving abroad.", interests: ["consulting", "diaspora"] },
    { phone: "+919100000037", fullName: "Parth Joshi", batchYear: 2018, professionType: "EMPLOYED", companyName: "Infosys", designation: "Senior Developer", city: "Pune", country: "IN", status: "PENDING" },
    { phone: "+919100000038", fullName: "Diya Raval", batchYear: 2020, professionType: "FOUNDER", companyName: "Raval Foods", city: "Rajkot", country: "IN", status: "PENDING" },
  ],
};

/** A profile's own details. */
interface SeedProfile {
  headline?: string;
  industry?: Industry;
  careerStartYear?: number;
  skills?: string[];
  degree?: string;
  fieldOfStudy?: string;
  experiences?: ProfileExperienceDto[];
  education?: ProfileEducationDto[];
  linkedinUrl?: string;
  websiteUrl?: string;
  githubUrl?: string;
  instagramUrl?: string;
  xUrl?: string;
  openTo?: OpenTo[];
}

/** Stored the way the API stores a saved profile: skills normalised, and both lists newest first. */
function seedProfileValues(p: SeedProfile): SeedProfile {
  return {
    ...p,
    ...(p.skills && { skills: normalizeSkills(p.skills) }),
    ...(p.experiences && { experiences: sortExperiences(p.experiences) }),
    ...(p.education && { education: sortEducation(p.education) }),
  };
}

const pastRole = (company: string, title: string, startYear: number | null, endYear: number | null): ProfileExperienceDto => ({ company, title, startYear, endYear });
const studied = (institution: string, degree: string | null, fieldOfStudy: string | null, startYear: number | null, endYear: number | null): ProfileEducationDto => ({ institution, degree, fieldOfStudy, startYear, endYear });

/**
 * Full profiles for a few named members, consistent with the rest of their seed (their posts, listings and mentor notes).
 * Nothing in them names another member, or says "Mentor", which the directory and its e2e checks look for on cards.
 */
const SEED_PROFILES: Record<string, Record<string, SeedProfile>> = {
  "demo-university": {
    // Rahul Mehta: "I started Zylo Labs after six years in banking."
    "+919100000001": {
      headline: "Founder and CEO of Zylo Labs: lending software for small marketplaces",
      industry: "BANKING_FINANCE",
      careerStartYear: 2012,
      skills: ["Fundraising", "Lending", "Fintech", "Product strategy", "Early hiring"],
      degree: "B.Tech",
      fieldOfStudy: "Computer Science",
      experiences: [pastRole("HDFC Bank", "Product lead, SME lending", 2015, 2018), pastRole("Kotak Mahindra Bank", "Management trainee", 2012, 2015)],
      linkedinUrl: "https://www.linkedin.com/in/rahul-mehta-zylo",
      websiteUrl: "https://example.com/zylo",
      xUrl: "https://x.com/rahulbuilds",
      openTo: ["HIRING", "COLLABORATING"],
    },
    // Priya Nair: moved from engineering to product, and from India to the UK.
    "+919100000002": {
      headline: "Product manager at Google, working on consumer apps",
      industry: "SOFTWARE_INTERNET",
      careerStartYear: 2012,
      skills: ["Product management", "User research", "SQL", "A/B testing", "Roadmapping"],
      degree: "B.Tech",
      fieldOfStudy: "Electronics",
      experiences: [pastRole("Flipkart", "Software engineer", 2012, 2015)],
      education: [studied("London Business School", "MBA", null, 2015, 2017)],
      linkedinUrl: "https://www.linkedin.com/in/priya-nair-product",
      openTo: ["HIRING"],
    },
    // Vikram Desai: an MBA student, and the seeded job seeker.
    "+919100000005": {
      headline: "MBA student at IIM Ahmedabad, looking for product and strategy roles",
      skills: ["Market research", "Financial modelling", "SQL", "Excel"],
      degree: "B.Com",
      fieldOfStudy: "Commerce",
      experiences: [pastRole("Deloitte", "Analyst", 2020, 2024)],
      education: [studied("IIM Ahmedabad", "MBA", null, 2024, 2026)],
      linkedinUrl: "https://www.linkedin.com/in/vikram-desai-iima",
    },
    // Sneha Kulkarni: distributed systems, and angel cheques for alumni founders.
    "+919100000006": {
      headline: "Principal engineer at Microsoft, building distributed storage",
      industry: "SOFTWARE_INTERNET",
      careerStartYear: 2008,
      skills: ["Distributed systems", "Go", "C++", "Kubernetes", "System design"],
      degree: "B.Tech",
      fieldOfStudy: "Computer Science",
      experiences: [pastRole("Amazon", "Senior software engineer", 2012, 2017), pastRole("Infosys", "Software engineer", 2008, 2010)],
      education: [studied("University of Washington", "MS", "Computer Science", 2010, 2012)],
      linkedinUrl: "https://www.linkedin.com/in/sneha-kulkarni-seattle",
      githubUrl: "https://github.com/sneha-kulkarni-dev",
      websiteUrl: "https://example.com/cascade",
      openTo: ["INVESTING"],
    },
  },
  "demo-college": {
    // Kiran Joshi: warehouse robots, raising a pre-seed round.
    "+919100000011": {
      headline: "Founder of Joshi Robotics: warehouse robots for Indian logistics firms",
      industry: "MANUFACTURING_ENGINEERING",
      careerStartYear: 2005,
      skills: ["Robotics", "Embedded systems", "Warehouse automation", "Fundraising"],
      degree: "B.E.",
      fieldOfStudy: "Mechanical Engineering",
      experiences: [pastRole("Tata Motors", "Automation engineer", 2005, 2011)],
      education: [studied("IIT Bombay", "M.Tech", "Mechatronics", 2011, 2013)],
      websiteUrl: "https://example.com/joshi-robotics",
      openTo: ["HIRING", "COLLABORATING"],
    },
    // Neha Sharma: the architect who posted the TCS opening.
    "+919100000012": {
      headline: "Solutions architect for banking platforms at TCS",
      industry: "IT_SERVICES",
      careerStartYear: 2010,
      skills: ["Solution architecture", "Java", "AWS", "Core banking", "Microservices"],
      degree: "B.E.",
      fieldOfStudy: "Computer Engineering",
      experiences: [pastRole("Wipro", "Senior developer", 2010, 2014)],
      linkedinUrl: "https://www.linkedin.com/in/neha-sharma-architect",
      openTo: ["HIRING"],
    },
  },
  // A school asks for no degree: what came after it is studies elsewhere.
  "demo-school": {
    // Nikhil Bose: writes seed cheques for DIS founders.
    "+919100000023": {
      headline: "Vice president, investment banking at Goldman Sachs",
      industry: "BANKING_FINANCE",
      careerStartYear: 2016,
      skills: ["Financial modelling", "Valuation", "M&A", "Angel investing"],
      experiences: [pastRole("J.P. Morgan", "Analyst", 2016, 2019)],
      education: [studied("INSEAD", "MBA", null, 2019, 2020), studied("Shri Ram College of Commerce", "B.Com", "Commerce", 2013, 2016)],
      linkedinUrl: "https://www.linkedin.com/in/nikhil-bose-sg",
      openTo: ["INVESTING"],
    },
  },
  "shri-gujarati-samaj": {
    // Hetal Shah: Surat textiles, open to hiring and collaborating.
    "+919100000031": {
      headline: "Proprietor of Shah Fabrics: cotton and blended fabrics for export",
      industry: "MANUFACTURING_ENGINEERING",
      careerStartYear: 2005,
      skills: ["Textile trade", "Export documentation", "Sourcing", "Negotiation"],
      degree: "B.Com",
      fieldOfStudy: "Commerce",
      experiences: [pastRole("Shah Fabrics", "Sales manager", 2005, 2012)],
      websiteUrl: "https://example.com/shah-fabrics",
      openTo: ["HIRING", "COLLABORATING"],
    },
    // Ravi Mehta: product at TCS, refers for openings.
    "+919100000032": {
      headline: "Product manager at TCS Digital, working on enterprise apps",
      industry: "IT_SERVICES",
      careerStartYear: 2012,
      skills: ["Product management", "Agile", "Stakeholder management", "SQL"],
      degree: "B.E.",
      fieldOfStudy: "Computer Engineering",
      experiences: [pastRole("Wipro", "Business analyst", 2012, 2016)],
      linkedinUrl: "https://www.linkedin.com/in/ravi-mehta-product",
      openTo: ["HIRING"],
    },
    // Kiran Parikh: jewellery, raising a small expansion round.
    "+919100000033": {
      headline: "Managing partner at Parikh Jewellers, Surat",
      industry: "RETAIL_CONSUMER",
      careerStartYear: 2008,
      skills: ["Jewellery retail", "Diamond sourcing", "Export", "Brand building"],
      degree: "BBA",
      fieldOfStudy: "Business Administration",
      websiteUrl: "https://example.com/parikh-jewellers",
      openTo: ["COLLABORATING"],
    },
    // Bhavin Trivedi: SME banking mentor and angel cheques.
    "+919100000035": {
      headline: "Senior vice president, SME banking at HDFC Bank",
      industry: "BANKING_FINANCE",
      careerStartYear: 1996,
      skills: ["SME lending", "Credit", "Fundraising advice", "Board mentoring"],
      degree: "MBA",
      fieldOfStudy: "Finance",
      experiences: [pastRole("ICICI Bank", "Relationship manager", 1996, 2004)],
      linkedinUrl: "https://www.linkedin.com/in/bhavin-trivedi-sme",
      openTo: ["INVESTING"],
    },
    // Nisha Modi: diaspora consultant.
    "+919100000036": {
      headline: "Senior consultant at Deloitte, strategy and operations",
      industry: "CONSULTING",
      careerStartYear: 2010,
      skills: ["Strategy", "Operations", "US immigration basics", "Career coaching"],
      degree: "B.Com",
      fieldOfStudy: "Commerce",
      education: [studied("Rutgers University", "MBA", null, 2014, 2016)],
      linkedinUrl: "https://www.linkedin.com/in/nisha-modi-deloitte",
      openTo: ["HIRING"],
    },
  },
};

async function upsertSeedMember(db: Db, tenantId: string, m: MemberSeed, profile: SeedProfile = {}): Promise<string> {
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
      ...seedProfileValues(profile),
      lastActiveAt: status === "APPROVED" ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [memberships.tenantId, memberships.userId],
      set: { fullName: m.fullName, role: m.role ?? "MEMBER", updatedAt: new Date() },
    })
    .returning();
  return row!.id;
}

export async function seedMembers(db: Db, tenantIds: Record<string, string>): Promise<Record<string, string>> {
  const membershipIds: Record<string, string> = {};
  for (const [slug, members] of Object.entries(SEED_MEMBERS)) {
    const tenantId = tenantIds[slug];
    if (!tenantId) continue;
    for (const m of members) membershipIds[`${slug}:${m.phone}`] = await upsertSeedMember(db, tenantId, m, SEED_PROFILES[slug]?.[m.phone]);
  }
  return membershipIds;
}

const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number, hour = 18) => {
  const t = new Date(Date.now() + d * DAY);
  t.setUTCHours(hour, 30, 0, 0);
  return t;
};

const seededMember = (m: Record<string, string>) => (slug: string, phone: string) => {
  const id = m[`${slug}:${phone}`];
  if (!id) throw new Error(`missing seeded membership ${slug}:${phone}`);
  return id;
};

/** Seeds demo content once per tenant (skipped when the tenant already has posts). */
export async function seedContent(db: Db, tenantIds: Record<string, string>, m: Record<string, string>): Promise<number> {
  let created = 0;
  const mid = seededMember(m);
  const hasContent = async (tenantId: string) => {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(posts).where(sql`${posts.tenantId} = ${tenantId}`);
    return (row?.count ?? 0) > 0;
  };
  const approved = { moderationStatus: "APPROVED" as const, moderatedAt: new Date() };

  // ---------- demo-university (AUTO / AUTO) ----------
  const uni = tenantIds["demo-university"]!;
  if (!(await hasContent(uni))) {
    const admin = mid("demo-university", "+919000000001");
    const rahul = mid("demo-university", "+919100000001");
    const priya = mid("demo-university", "+919100000002");
    const arjun = mid("demo-university", "+919100000003");
    const meera = mid("demo-university", "+919100000004");
    const vikram = mid("demo-university", "+919100000005");
    const sneha = mid("demo-university", "+919100000006");

    const [welcome, p1, p2, p3] = await db
      .insert(posts)
      .values([
        { tenantId: uni, authorMembershipId: admin, body: "Welcome to the official Demo University alumni network! Introduce yourself in the comments: batch, city and what you're up to.", isPinned: true, ...approved },
        { tenantId: uni, authorMembershipId: rahul, body: "Zylo Labs just closed our seed round 🎉 Huge thanks to the DemoU alumni who made intros. If you're building in fintech, let's talk.", ...approved },
        { tenantId: uni, authorMembershipId: priya, body: "Any DemoU folks in London? Thinking of a small meetup near King's Cross next month.", ...approved },
        { tenantId: uni, authorMembershipId: sneha, body: "Mentoring slots open for final-year students interested in distributed systems. DM me on LinkedIn.", ...approved },
      ])
      .returning();
    await db.insert(postComments).values([
      { tenantId: uni, postId: welcome!.id, authorMembershipId: rahul, body: "Rahul, batch of 2012, Mumbai. Running Zylo Labs.", ...approved },
      { tenantId: uni, postId: welcome!.id, authorMembershipId: meera, body: "Meera, 2018, Dubai. Consulting at Deloitte — happy to help with Gulf job leads.", ...approved },
      { tenantId: uni, postId: p1!.id, authorMembershipId: arjun, body: "Congratulations! Proud moment for the batch.", ...approved },
      { tenantId: uni, postId: p2!.id, authorMembershipId: sneha, body: "Not London, but count me in for a virtual one!", ...approved },
    ]);
    await db.insert(postReactions).values([
      { tenantId: uni, postId: p1!.id, membershipId: priya, type: "CELEBRATE" },
      { tenantId: uni, postId: p1!.id, membershipId: arjun, type: "LIKE" },
      { tenantId: uni, postId: p1!.id, membershipId: admin, type: "CELEBRATE" },
      { tenantId: uni, postId: welcome!.id, membershipId: vikram, type: "LIKE" },
      { tenantId: uni, postId: p3!.id, membershipId: vikram, type: "INSIGHTFUL" },
    ]);
    await db.execute(sql`update posts set comment_count = (select count(*) from post_comments c where c.post_id = posts.id and c.moderation_status = 'APPROVED'), reaction_count = (select count(*) from post_reactions r where r.post_id = posts.id) where tenant_id = ${uni}`);

    await db.insert(jobs).values([
      // Every field filled in, so the job's page shows each part of it.
      {
        tenantId: uni,
        authorMembershipId: rahul,
        title: "Backend Engineer (Node.js)",
        companyName: "Zylo Labs",
        location: "Mumbai",
        workMode: "REMOTE",
        jobType: "FULL_TIME",
        seniority: "MID",
        experienceMin: 3,
        experienceMax: 6,
        skills: ["Node.js", "TypeScript", "PostgreSQL", "AWS"],
        openings: 2,
        description: "Own our payments ledger service, the system every rupee on Zylo Labs moves through. You'll join a team of six engineers:\n\n- shipping to production several times a day\n- working closely with finance and risk\n- remote-friendly within India",
        responsibilities: "- Design and run the ledger's APIs and its nightly reconciliation\n- Keep payouts correct and on time as volume grows\n- Review code and mentor two junior engineers\n- Share the on-call rota, one week in six",
        requirements: "- 3+ years building backend services with Node.js and TypeScript\n- Solid PostgreSQL: transactions, indexes and reading query plans\n- You've run a service in production and fixed it when it broke\n- Payments or fintech experience is a plus, not a must",
        benefits: "- ESOPs from day one\n- Health cover for you and your family\n- ₹50,000 a year for courses, books and conferences\n- A week in Mumbai each quarter, travel paid",
        howToApply: "Apply at https://example.com/zylo/backend with your CV and a link to code you're proud of.\n\n- A 30-minute call with the hiring manager\n- A take-home exercise of about three hours\n- A final round with the team\n\nWe reply to everyone within a week.",
        applyUrl: "https://example.com/zylo/backend",
        salaryMinMinor: toMinor(2_500_000, "INR"),
        salaryMaxMinor: toMinor(4_000_000, "INR"),
        salaryCurrency: "INR",
        salaryPeriod: "YEAR",
        salaryNote: "Plus ESOPs",
        companyWebsite: "https://example.com/zylo",
        companyIndustry: "SOFTWARE_INTERNET",
        companySize: "SIZE_11_50",
        aboutCompany: "Zylo Labs builds lending software for small marketplaces. Founded by DemoU alumni in 2021, we're a team of 40 in Mumbai and across India.",
        ...approved,
      },
      {
        tenantId: uni,
        authorMembershipId: priya,
        title: "Associate Product Manager",
        companyName: "Google",
        location: "London",
        workMode: "HYBRID",
        jobType: "FULL_TIME",
        seniority: "ENTRY",
        experienceMin: 1,
        experienceMax: 3,
        skills: ["Product management", "SQL", "A/B testing", "User research"],
        description: "Referral available for DemoU alumni. Consumer product, 1–3 years experience. Three days a week in the office.",
        responsibilities: "- Write specs with engineering and design\n- Run experiments and read their results\n- Talk to users every week",
        requirements: "- 1–3 years in product, consulting or engineering\n- Comfortable with SQL and basic statistics\n- The right to work in the UK",
        salaryMinMinor: toMinor(55_000, "GBP"),
        salaryMaxMinor: toMinor(70_000, "GBP"),
        salaryCurrency: "GBP",
        salaryPeriod: "YEAR",
        companyIndustry: "SOFTWARE_INTERNET",
        companySize: "SIZE_5001_PLUS",
        contactEmail: "priya@example.com",
        ...approved,
      },
      { tenantId: uni, authorMembershipId: meera, title: "Summer Intern – Strategy", companyName: "Deloitte", location: "Dubai", jobType: "INTERNSHIP", description: "8-week internship for 2024/2025 batches. Visa sponsorship supported.", ...approved },
      { tenantId: uni, authorMembershipId: arjun, title: "Export Operations Lead", companyName: "Singh Textiles", location: "Surat", jobType: "FULL_TIME", description: "Closed — position filled.", isClosed: true, ...approved },
    ]);
    await db.insert(jobSeekers).values({ tenantId: uni, membershipId: vikram, note: "Graduating from IIM-A in 2026, looking for product/strategy roles in Bengaluru or Mumbai.", preferredRoles: "Product Manager, Strategy Associate", preferredLocations: "Bengaluru, Mumbai", isActive: true });

    await db.insert(fundingListings).values([
      { tenantId: uni, authorMembershipId: rahul, kind: "SEEKING", title: "Zylo Labs", stage: "SEED", amountMinMinor: 50_000_000, amountMaxMinor: 150_000_000, currency: "INR", pitch: "Embedded credit for SME marketplaces. ₹2.4Cr ARR, 40% QoQ growth. Raising a bridge before Series A.", sectors: ["fintech", "SME"], websiteUrl: "https://example.com/zylo", ...approved },
      { tenantId: uni, authorMembershipId: sneha, kind: "OFFERING", title: "Angel cheques for DemoU founders", stage: "PRE_SEED", amountMinMinor: 2_500_000, amountMaxMinor: 10_000_000, currency: "INR", pitch: "Writing ₹25L–₹1Cr angel cheques into developer tools and infra startups founded by alumni. Happy to lead or follow.", sectors: ["devtools", "infra", "SaaS"], ...approved },
    ]);

    const [meetup, conf, past] = await db
      .insert(events)
      .values([
        { tenantId: uni, authorMembershipId: rahul, title: "Mumbai alumni coffee meetup", description: "Casual Saturday coffee in Bandra. Come say hi, bring a friend from your batch.\n\n- The first round is on the alumni association\n- Look for the DemoU table upstairs\n- Partners and kids welcome\n\nDirections: https://example.com/maps/blue-tokai-bandra\nQuestions: meetups@demou.example", kind: "CASUAL_MEETUP", city: "Mumbai", venueName: "Blue Tokai, Bandra West", startAt: inDays(9, 11), endAt: inDays(9, 13), timezone: "Asia/Kolkata", ...approved },
        { tenantId: uni, authorMembershipId: admin, title: "DemoU Alumni Day 2026", description: "Annual gathering on campus with faculty talks, batch reunions and dinner. Registration required.", kind: "ORGANISED_EVENT", city: "Mumbai", venueName: "Main Auditorium, Demo University", address: "Demo University Campus, Powai, Mumbai 400076", startAt: inDays(45, 10), endAt: inDays(45, 16), timezone: "Asia/Kolkata", maxAttendees: 300, ...approved },
        { tenantId: uni, authorMembershipId: priya, title: "London pub night", description: "First London get-together. Thanks to everyone who came!", kind: "CASUAL_MEETUP", city: "London", venueName: "The Lamb, Bloomsbury", startAt: inDays(-20, 18), endAt: inDays(-20, 21), timezone: "Europe/London", ...approved },
      ])
      .returning();
    await db.insert(eventRsvps).values([
      { tenantId: uni, eventId: meetup!.id, membershipId: arjun, status: "YES" },
      { tenantId: uni, eventId: meetup!.id, membershipId: vikram, status: "YES" },
      { tenantId: uni, eventId: meetup!.id, membershipId: admin, status: "MAYBE" },
      { tenantId: uni, eventId: conf!.id, membershipId: rahul, status: "YES" },
      { tenantId: uni, eventId: conf!.id, membershipId: priya, status: "YES" },
      { tenantId: uni, eventId: conf!.id, membershipId: meera, status: "MAYBE" },
      { tenantId: uni, eventId: past!.id, membershipId: sneha, status: "NO" },
    ]);
    created++;
  }

  // ---------- demo-college (ADMIN / ADMIN) ----------
  const col = tenantIds["demo-college"]!;
  if (!(await hasContent(col))) {
    const admin = mid("demo-college", "+919000000002");
    const kiran = mid("demo-college", "+919100000011");
    const neha = mid("demo-college", "+919100000012");
    const rohan = mid("demo-college", "+919100000013");

    const [notice, spam] = await db
      .insert(posts)
      .values([
        { tenantId: col, authorMembershipId: admin, body: "Alumni office notice: convocation photos from 1998–2010 are now digitised. Reply with your batch to get the link.", isPinned: true, ...approved },
        { tenantId: col, authorMembershipId: rohan, body: "Earn $5000/week from home!!! Click here >>> http://totally-legit.example", ...approved },
        { tenantId: col, authorMembershipId: kiran, body: "Joshi Robotics is hiring interns from DCE — details in the jobs section once approved.", moderationStatus: "PENDING" },
        { tenantId: col, authorMembershipId: neha, body: "Does anyone have Prof. Deshmukh's contact? Wanted to invite him to our batch reunion.", moderationStatus: "PENDING" },
        { tenantId: col, authorMembershipId: rohan, body: "Selling my old laptop, DM for price.", moderationStatus: "REJECTED", moderatedAt: new Date(), moderationNote: "Please use the community for alumni matters, not classifieds." },
      ])
      .returning();
    await db.insert(postComments).values({ tenantId: col, postId: notice!.id, authorMembershipId: neha, body: "Batch of 2010 please!", ...approved });
    await db.execute(sql`update posts set comment_count = (select count(*) from post_comments c where c.post_id = posts.id and c.moderation_status = 'APPROVED') where tenant_id = ${col}`);
    await db.insert(contentReports).values({ tenantId: col, reporterMembershipId: neha, contentType: "POST", contentId: spam!.id, reason: "SPAM", details: "Looks like a scam link." });

    await db.insert(jobs).values([
      { tenantId: col, authorMembershipId: neha, title: "Solutions Architect", companyName: "TCS", location: "Hyderabad", jobType: "FULL_TIME", description: "Architect role in the BFSI unit. 8+ years experience. DCE alumni referrals welcome.", ...approved },
      // Waiting for review, so the admin's preview has a structured job to show.
      {
        tenantId: col,
        authorMembershipId: kiran,
        title: "Robotics Intern",
        companyName: "Joshi Robotics",
        location: "Pune",
        jobType: "INTERNSHIP",
        seniority: "ENTRY",
        experienceMin: 0,
        skills: ["ROS2", "C++", "Python"],
        educationRequirement: "Final-year B.E. or B.Tech in mechanical, electronics or computer engineering",
        openings: 3,
        description: "6-month internship on autonomous warehouse robots. ROS2 and C++ preferred.",
        requirements: "- Built something that moves: a robot, a drone or a rover\n- Comfortable on Linux and with Git\n- Available full time from January",
        salaryMinMinor: toMinor(25_000, "INR"),
        salaryMaxMinor: toMinor(35_000, "INR"),
        salaryCurrency: "INR",
        salaryPeriod: "MONTH",
        companyIndustry: "MANUFACTURING_ENGINEERING",
        companySize: "SIZE_11_50",
        aboutCompany: "Joshi Robotics builds warehouse automation for Indian 3PLs, with two pilots live in Pune.",
        moderationStatus: "PENDING",
      },
    ]);
    await db.insert(fundingListings).values({ tenantId: col, authorMembershipId: kiran, kind: "SEEKING", title: "Joshi Robotics", stage: "PRE_SEED", amountMinMinor: 20_000_000, amountMaxMinor: 50_000_000, currency: "INR", pitch: "Warehouse automation for Indian 3PLs. Two pilots live in Pune. Raising ₹2–5Cr pre-seed.", sectors: ["robotics", "logistics"], moderationStatus: "PENDING" });
    await db.insert(events).values([
      { tenantId: col, authorMembershipId: admin, title: "Batch of 2010 reunion", description: "15-year reunion on campus followed by dinner at the faculty club.", kind: "ORGANISED_EVENT", city: "Pune", venueName: "DCE Campus", startAt: inDays(30, 11), endAt: inDays(30, 20), timezone: "Asia/Kolkata", maxAttendees: 120, ...approved },
      { tenantId: col, authorMembershipId: rohan, title: "Toronto alumni dinner", description: "Anyone in the GTA? Let's do dinner downtown.", kind: "CASUAL_MEETUP", city: "Toronto", startAt: inDays(14, 23), timezone: "America/Toronto", moderationStatus: "PENDING" },
    ]);
    created++;
  }

  // ---------- demo-school (ADMIN / AUTO) ----------
  const sch = tenantIds["demo-school"]!;
  if (!(await hasContent(sch))) {
    const admin = mid("demo-school", "+919000000003");
    const aditya = mid("demo-school", "+919100000021");
    const shreya = mid("demo-school", "+919100000022");
    const nikhil = mid("demo-school", "+919100000023");
    await db.insert(posts).values([
      { tenantId: sch, authorMembershipId: admin, body: "Founders' Day is on 14 November. Alumni are invited to the morning assembly — RSVP in the events section.", isPinned: true, ...approved },
      { tenantId: sch, authorMembershipId: shreya, body: "Designed the new alumni logo — would love feedback from the 2009 batch especially!", ...approved },
      { tenantId: sch, authorMembershipId: nikhil, body: "Singapore DIS alumni: there are at least six of us here now. Dinner soon?", ...approved },
    ]);
    await db.insert(jobs).values({ tenantId: sch, authorMembershipId: aditya, title: "Product Analyst", companyName: "Flipkart", location: "Bengaluru", jobType: "FULL_TIME", description: "Referral for DIS alumni with 1–3 years of analytics experience.", ...approved });
    await db.insert(fundingListings).values({ tenantId: sch, authorMembershipId: nikhil, kind: "OFFERING", title: "Seed cheques for DIS founders", stage: "SEED", currency: "USD", amountMinMinor: 5_000_000, amountMaxMinor: 25_000_000, pitch: "Investing personally in alumni-founded companies, USD 50k–250k, sector agnostic.", sectors: [], ...approved });
    await db.insert(events).values([
      { tenantId: sch, authorMembershipId: admin, title: "Founders' Day assembly", description: "Join the morning assembly and the alumni tea afterwards.", kind: "ORGANISED_EVENT", city: "Bengaluru", venueName: "Demo International School", startAt: inDays(21, 3), endAt: inDays(21, 6), timezone: "Asia/Kolkata", ...approved },
      { tenantId: sch, authorMembershipId: nikhil, title: "Singapore alumni dinner", description: "Hawker centre crawl, then drinks.", kind: "CASUAL_MEETUP", city: "Singapore", startAt: inDays(12, 11), timezone: "Asia/Singapore", ...approved },
    ]);
    created++;
  }

  // ---------- shri-gujarati-samaj (ADMIN members / AUTO content) ----------
  const samaj = tenantIds["shri-gujarati-samaj"]!;
  if (!(await hasContent(samaj))) {
    const admin = mid("shri-gujarati-samaj", "+919000000004");
    const hetal = mid("shri-gujarati-samaj", "+919100000031");
    const ravi = mid("shri-gujarati-samaj", "+919100000032");
    const kiran = mid("shri-gujarati-samaj", "+919100000033");
    const asha = mid("shri-gujarati-samaj", "+919100000034");
    const bhavin = mid("shri-gujarati-samaj", "+919100000035");
    const nisha = mid("shri-gujarati-samaj", "+919100000036");

    const [welcome, p1, p2, p3] = await db
      .insert(posts)
      .values([
        { tenantId: samaj, authorMembershipId: admin, body: "Welcome to the Shri Gujarati Samaj member network! Introduce yourself: chapter, city and what you do. Membership requests are reviewed by the Samaj office.", isPinned: true, ...approved },
        { tenantId: samaj, authorMembershipId: hetal, body: "Shah Fabrics has a new range of cotton blends for export. Samaj members get preferential rates — message me if you're sourcing for a brand or a shop.", ...approved },
        { tenantId: samaj, authorMembershipId: nisha, body: "Any Samaj members in the New York / New Jersey area? Thinking of a small dinner before Diwali.", ...approved },
        { tenantId: samaj, authorMembershipId: bhavin, body: "Opening a few mentorship slots for members starting or expanding an SME. Happy to talk credit, cash flow and when to raise.", ...approved },
      ])
      .returning();
    await db.insert(postComments).values([
      { tenantId: samaj, postId: welcome!.id, authorMembershipId: ravi, body: "Ravi, Ahmedabad chapter, product at TCS. Glad to be here.", ...approved },
      { tenantId: samaj, postId: welcome!.id, authorMembershipId: asha, body: "Asha, final year at Nirma. Looking forward to the events!", ...approved },
      { tenantId: samaj, postId: p1!.id, authorMembershipId: kiran, body: "We buy from you already — the new blends look good.", ...approved },
      { tenantId: samaj, postId: p2!.id, authorMembershipId: ravi, body: "I'll be in Jersey next month. Count me in if the dates work.", ...approved },
    ]);
    await db.insert(postReactions).values([
      { tenantId: samaj, postId: p1!.id, membershipId: kiran, type: "LIKE" },
      { tenantId: samaj, postId: p1!.id, membershipId: admin, type: "CELEBRATE" },
      { tenantId: samaj, postId: welcome!.id, membershipId: hetal, type: "LIKE" },
      { tenantId: samaj, postId: p3!.id, membershipId: asha, type: "INSIGHTFUL" },
      { tenantId: samaj, postId: p2!.id, membershipId: bhavin, type: "LIKE" },
    ]);
    await db.execute(sql`update posts set comment_count = (select count(*) from post_comments c where c.post_id = posts.id and c.moderation_status = 'APPROVED'), reaction_count = (select count(*) from post_reactions r where r.post_id = posts.id) where tenant_id = ${samaj}`);

    await db.insert(jobs).values([
      { tenantId: samaj, authorMembershipId: ravi, title: "Associate Product Manager", companyName: "TCS Digital", location: "Ahmedabad", workMode: "ON_SITE", jobType: "FULL_TIME", description: "Entry product role on an enterprise client account. 1–3 years experience. Samaj referrals welcome.", contactEmail: "ravi.mehta@example.com", salaryNote: "₹12–18 LPA", ...approved },
      { tenantId: samaj, authorMembershipId: hetal, title: "Export Documentation Executive", companyName: "Shah Fabrics", location: "Surat", workMode: "ON_SITE", jobType: "FULL_TIME", description: "Handle shipping documents, LC paperwork and buyer follow-ups. Gujarati and English; prior export experience preferred.", applyUrl: "https://example.com/shah-fabrics/careers", ...approved },
      { tenantId: samaj, authorMembershipId: nisha, title: "Summer Intern – Strategy", companyName: "Deloitte", location: "New York", workMode: "ON_SITE", jobType: "INTERNSHIP", description: "10-week internship for final-year students. Visa sponsorship not available; US work authorisation required.", ...approved },
      { tenantId: samaj, authorMembershipId: kiran, title: "Store Manager – Ring Road", companyName: "Parikh Jewellers", location: "Surat", workMode: "ON_SITE", jobType: "FULL_TIME", description: "Closed — position filled.", isClosed: true, ...approved },
    ]);
    await db.insert(jobSeekers).values({
      tenantId: samaj,
      membershipId: asha,
      note: "Final-year BBA at Nirma. Looking for marketing or operations internships in Ahmedabad or Surat this summer.",
      preferredRoles: "Marketing Intern, Operations Intern",
      preferredLocations: "Ahmedabad, Surat",
      isActive: true,
    });

    await db.insert(fundingListings).values([
      { tenantId: samaj, authorMembershipId: kiran, kind: "SEEKING", title: "Parikh Jewellers expansion", stage: "SEED", amountMinMinor: 50_000_000, amountMaxMinor: 100_000_000, currency: "INR", pitch: "Opening a second showroom on Ring Road and a small e-commerce catalogue. Seeking ₹50L–₹1Cr from community angels who know retail.", sectors: ["retail", "jewellery"], websiteUrl: "https://example.com/parikh-jewellers", ...approved },
      { tenantId: samaj, authorMembershipId: bhavin, kind: "OFFERING", title: "Angel cheques for Samaj founders", stage: "PRE_SEED", amountMinMinor: 2_500_000, amountMaxMinor: 15_000_000, currency: "INR", pitch: "Writing ₹25L–₹1.5Cr cheques into Gujarat-based SMEs and consumer brands founded by Samaj members. Happy to lead or follow.", sectors: ["SME", "consumer", "manufacturing"], ...approved },
    ]);

    const [navratri, meetup, past] = await db
      .insert(events)
      .values([
        { tenantId: samaj, authorMembershipId: admin, title: "Samaj Navratri Garba Night 2026", description: "Nine evenings of Garba at the Samaj hall, with dinner on the final night. Members and families welcome.\n\n- Entry with membership card\n- Traditional attire preferred\n- Kids welcome until 9pm\n\nRSVP so we can plan seating and prasadam.", kind: "ORGANISED_EVENT", city: "Ahmedabad", venueName: "Shri Gujarati Samaj Hall", address: "Samaj Campus, CG Road, Ahmedabad 380009", startAt: inDays(28, 19), endAt: inDays(28, 23), timezone: "Asia/Kolkata", maxAttendees: 500, ...approved },
        { tenantId: samaj, authorMembershipId: hetal, title: "Surat chapter coffee meetup", description: "Saturday morning coffee for Surat members. Trade talk optional — mostly catching up.", kind: "CASUAL_MEETUP", city: "Surat", venueName: "Cafe Coffee Day, Ring Road", startAt: inDays(10, 11), endAt: inDays(10, 13), timezone: "Asia/Kolkata", ...approved },
        { tenantId: samaj, authorMembershipId: nisha, title: "NJ Diwali potluck", description: "Thank you to everyone who brought a dish. Photos in the group soon.", kind: "CASUAL_MEETUP", city: "Edison", venueName: "Community Centre", startAt: inDays(-25, 18), endAt: inDays(-25, 21), timezone: "America/New_York", ...approved },
      ])
      .returning();
    await db.insert(eventRsvps).values([
      { tenantId: samaj, eventId: navratri!.id, membershipId: hetal, status: "YES" },
      { tenantId: samaj, eventId: navratri!.id, membershipId: ravi, status: "YES" },
      { tenantId: samaj, eventId: navratri!.id, membershipId: asha, status: "YES" },
      { tenantId: samaj, eventId: navratri!.id, membershipId: bhavin, status: "MAYBE" },
      { tenantId: samaj, eventId: meetup!.id, membershipId: kiran, status: "YES" },
      { tenantId: samaj, eventId: meetup!.id, membershipId: admin, status: "MAYBE" },
      { tenantId: samaj, eventId: past!.id, membershipId: ravi, status: "NO" },
    ]);
    created++;
  }

  await db.execute(sql`update events set yes_count = (select count(*) from event_rsvps r where r.event_id = events.id and r.status = 'YES'), maybe_count = (select count(*) from event_rsvps r where r.event_id = events.id and r.status = 'MAYBE')`);
  return created;
}

/** One offline billing plan per demo tenant (skipped when the tenant already has plans). */
export async function seedBilling(db: Db, tenantIds: Record<string, string>, createdByUserId: string): Promise<void> {
  const plans: Array<{ slug: string; values: Omit<typeof tenantBillingPlans.$inferInsert, "tenantId"> }> = [
    { slug: "demo-university", values: { billingModel: "PER_ACTIVE_USER", billingCycle: "MONTHLY", currency: "INR", pricePerActiveUserMinor: 5000, effectiveFrom: "2026-01-01", includedChannels: ["WHATSAPP", "SMS", "EMAIL"], messageRatesMinor: { WHATSAPP: 80, SMS: 25, EMAIL: 0.5 }, notes: "₹50 per active member per month, invoiced quarterly in arrears. Messages at cost: WhatsApp ₹0.80, SMS ₹0.25, email ₹0.005." } },
    { slug: "demo-college", values: { billingModel: "FLAT_FEE", billingCycle: "YEARLY", currency: "INR", flatFeeMinor: 25_000_000, effectiveFrom: "2026-04-01", notes: "₹2.5L per year, paid by the alumni association." } },
    { slug: "demo-school", values: { billingModel: "FREE", billingCycle: "YEARLY", currency: "INR", effectiveFrom: "2026-01-01", notes: "Pilot — free for the first year." } },
    { slug: "shri-gujarati-samaj", values: { billingModel: "FLAT_FEE", billingCycle: "YEARLY", currency: "INR", flatFeeMinor: 15_000_000, effectiveFrom: "2026-01-01", notes: "₹1.5L per year, paid by the Samaj office." } },
  ];
  for (const p of plans) {
    const tenantId = tenantIds[p.slug];
    if (!tenantId) continue;
    const [existing] = await db.select({ count: sql<number>`count(*)::int` }).from(tenantBillingPlans).where(sql`${tenantBillingPlans.tenantId} = ${tenantId}`);
    if ((existing?.count ?? 0) > 0) continue;
    await db.insert(tenantBillingPlans).values({ tenantId, createdByUserId, ...p.values });
  }
}

/** Business listings, skipped for an institution that already has some. The report goes in with its listing, so the same check covers it. */
async function seedBusinessListings(db: Db, tenantIds: Record<string, string>, m: Record<string, string>): Promise<void> {
  const mid = seededMember(m);
  const isEmpty = async (tenantId: string) => {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(businessListings).where(eq(businessListings.tenantId, tenantId));
    return (row?.count ?? 0) === 0;
  };
  const daysAgo = (d: number) => new Date(Date.now() - d * DAY);
  const approved = (d: number) => ({ moderationStatus: "APPROVED" as const, moderatedAt: daysAgo(d), createdAt: daysAgo(d) });

  const uni = tenantIds["demo-university"];
  if (uni && (await isEmpty(uni))) {
    const member = (phone: string) => mid("demo-university", phone);
    await db.insert(businessListings).values([
      { tenantId: uni, authorMembershipId: member("+919100000001"), name: "Zylo Labs", category: "TECHNOLOGY", city: "Mumbai", description: "Lending software for small marketplaces, built by DemoU alumni. Free onboarding for alumni-run shops.\n\n- Credit decisions in under a day\n- Works with the storefront you already use\n- No setup fee for DemoU alumni\n\nGetting started:\n1. Book a short call\n2. Connect your storefront\n3. Lend from the first week\n\nPricing and case studies: https://example.com/zylo/pricing", websiteUrl: "https://example.com/zylo", contactEmail: "hello@zylolabs.example", contactPhone: "+91 22 5550 0101", ...approved(40) },
      { tenantId: uni, authorMembershipId: member("+919100000003"), name: "Singh Textiles", category: "MANUFACTURING", city: "Surat", description: "Cotton and blended fabrics for export, third generation in the trade. Bulk orders welcome.", contactPhone: "+91 261 555 0102", ...approved(32) },
      { tenantId: uni, authorMembershipId: member("+919100000002"), name: "Second Chapter Books", category: "RETAIL", city: "London", description: "A small independent bookshop in Bloomsbury. Ten percent off for anyone from DemoU.", websiteUrl: "https://example.com/second-chapter", contactEmail: "shop@secondchapter.example", ...approved(25) },
      { tenantId: uni, authorMembershipId: member("+919100000006"), name: "Cascade Code Academy", category: "EDUCATION", city: "Seattle", description: "Evening courses in distributed systems for working engineers, taught online.", websiteUrl: "https://example.com/cascade", contactEmail: "learn@cascadecode.example", ...approved(18) },
      { tenantId: uni, authorMembershipId: member("+919100000004"), name: "Gulf Career Partners", category: "CONSULTING", city: "Dubai", description: "Career and relocation advice for professionals moving to the Gulf.", contactEmail: "advice@gulfcareer.example", contactPhone: "+971 4 555 0103", ...approved(10) },
    ]);
    const [reported] = await db
      .insert(businessListings)
      .values({ tenantId: uni, authorMembershipId: member("+919100000005"), name: "Instant Visa Desk", category: "TRAVEL_HOSPITALITY", city: "Ahmedabad", description: "Guaranteed visas in 24 hours for any country. Pay in advance, no questions asked.", contactPhone: "+91 79 5550 0104", ...approved(3) })
      .returning({ id: businessListings.id });
    await db.insert(contentReports).values({ tenantId: uni, reporterMembershipId: member("+919100000004"), contentType: "BUSINESS", contentId: reported!.id, reason: "SPAM", details: "Promises guaranteed visas and asks for money up front." });
  }

  // No reports here: the admin e2e expects this institution to end on "No open reports".
  const col = tenantIds["demo-college"];
  if (col && (await isEmpty(col))) {
    const member = (phone: string) => mid("demo-college", phone);
    await db.insert(businessListings).values([
      { tenantId: col, authorMembershipId: member("+919100000012"), name: "Sharma Architects", category: "REAL_ESTATE", city: "Hyderabad", description: "Residential and small commercial design across Telangana. Free first consultation for DCE alumni.", websiteUrl: "https://example.com/sharma-architects", contactEmail: "studio@sharmaarchitects.example", ...approved(21) },
      { tenantId: col, authorMembershipId: member("+919100000013"), name: "Maple Immigration Advisors", category: "CONSULTING", city: "Toronto", description: "Licensed advice for engineers moving to Canada, from study permits to permanent residence.", contactEmail: "hello@mapleadvisors.example", contactPhone: "+1 416 555 0105", ...approved(12) },
      { tenantId: col, authorMembershipId: member("+919100000011"), name: "Joshi Automation Services", category: "LOGISTICS", city: "Pune", description: "Installation and upkeep of warehouse conveyors for third-party logistics firms around Pune.", contactEmail: "service@joshiautomation.example", moderationStatus: "PENDING", createdAt: daysAgo(1) },
    ]);
  }

  const samaj = tenantIds["shri-gujarati-samaj"];
  if (samaj && (await isEmpty(samaj))) {
    const member = (phone: string) => mid("shri-gujarati-samaj", phone);
    await db.insert(businessListings).values([
      { tenantId: samaj, authorMembershipId: member("+919100000031"), name: "Shah Fabrics", category: "MANUFACTURING", city: "Surat", description: "Cotton and blended fabrics for domestic brands and export. Preferential rates for Samaj members.\n\n- Mill visits by appointment\n- Sample packs for new buyers\n- Shipping advice for first-time exporters\n\nCatalogue: https://example.com/shah-fabrics/catalogue", websiteUrl: "https://example.com/shah-fabrics", contactEmail: "orders@shahfabrics.example", contactPhone: "+91 261 555 0201", ...approved(35) },
      { tenantId: samaj, authorMembershipId: member("+919100000033"), name: "Parikh Jewellers", category: "RETAIL", city: "Surat", description: "Diamond and gold jewellery for retail and export. Custom bridal sets and corporate gifts.", websiteUrl: "https://example.com/parikh-jewellers", contactEmail: "hello@parikhjewellers.example", contactPhone: "+91 261 555 0202", ...approved(22) },
      { tenantId: samaj, authorMembershipId: member("+919100000036"), name: "Modi Career Advisors", category: "CONSULTING", city: "Edison", description: "Career and relocation coaching for Samaj members moving to the US. Resume reviews and interview practice.", contactEmail: "nisha@modicareer.example", ...approved(14) },
      { tenantId: samaj, authorMembershipId: member("+919100000032"), name: "Mehta Product Studio", category: "EDUCATION", city: "Ahmedabad", description: "Weekend workshops on product management for early-career professionals in Gujarat.", websiteUrl: "https://example.com/mehta-product", contactEmail: "workshops@mehtaproduct.example", ...approved(8) },
    ]);
  }
}

/** Distinctive, so tests can show it never turns up anywhere outside the reported thread. */
export const SEEDED_REPORTED_CHAT_BODY = "Pay me by Friday or I tell everyone at the reunion what you did. (demo-chat-report-7Q4X)";

/** Direct threads between seeded members. Written through the repository, because the seed has no chat API or realtime to go through. */
async function seedChatThreads(db: Db, tenantId: string, member: (phone: string) => string): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(chatConversations).where(eq(chatConversations.tenantId, tenantId));
  if ((row?.count ?? 0) > 0) return;
  const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY - minutes * 60_000);
  const [rahul, priya, arjun, meera, vikram, sneha, ananya] = ["+919100000001", "+919100000002", "+919100000003", "+919100000004", "+919100000005", "+919100000006", "+919000000001"].map(member) as [string, string, string, string, string, string, string];
  await runInTransaction({ db, logger: createLogger("silent", false) }, async (tx) => {
    await seedDirectThread(tx, {
      tenantId,
      aId: rahul,
      bId: priya,
      requesterId: rahul,
      state: "ACCEPTED",
      unreadByRecipient: 1,
      messages: [
        { senderId: rahul, body: "Priya, are you in London next month? I'll be over for a fintech conference.", at: ago(6, 120) },
        { senderId: priya, body: "I am! Coffee near King's Cross?", at: ago(6, 60) },
        { senderId: rahul, body: "Perfect. I'd also love your take on our product roadmap.", at: ago(6, 55) },
        { senderId: priya, body: "Happy to. Send it over beforehand and I'll read it on the train.", at: ago(5) },
        { senderId: rahul, body: "Sent to your work email. Thanks!", at: ago(1, 30) },
      ],
    });
    await seedDirectThread(tx, {
      tenantId,
      aId: sneha,
      bId: ananya,
      requesterId: sneha,
      state: "ACCEPTED",
      messages: [
        { senderId: sneha, body: "Ananya, could the alumni office share the 2008 batch reunion plans?", at: ago(9) },
        { senderId: ananya, body: "Yes, the committee meets on Saturday. I'll send you the notes after.", at: ago(8, 300) },
      ],
    });
    await seedDirectThread(tx, {
      tenantId,
      aId: arjun,
      bId: meera,
      requesterId: arjun,
      state: "ACCEPTED",
      messages: [
        { senderId: arjun, body: "Meera, can your firm take on my export paperwork?", at: ago(4, 200) },
        { senderId: meera, body: "We don't do that kind of work, sorry. Try a customs agent in Surat.", at: ago(4, 180) },
        { senderId: arjun, body: "You owe me a favour from college.", at: ago(4, 170) },
        { senderId: meera, body: "I don't think I do, and I'd rather leave it there.", at: ago(4, 160) },
        { senderId: arjun, body: SEEDED_REPORTED_CHAT_BODY, at: ago(4, 150) },
        { senderId: meera, body: "Please don't message me again.", at: ago(4, 140) },
      ],
    });
    await seedDirectThread(tx, {
      tenantId,
      aId: vikram,
      bId: rahul,
      requesterId: vikram,
      state: "PENDING",
      messages: [{ senderId: vikram, body: "Hi Rahul, I'm finishing at IIM Ahmedabad and would love to hear how you started Zylo Labs.", at: ago(1) }],
    });
  });
}

async function seedChatReport(db: Db, tenantId: string): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(chatReports).where(eq(chatReports.tenantId, tenantId));
  if ((row?.count ?? 0) > 0) return;
  const [target] = await db.select().from(chatMessages).where(and(eq(chatMessages.tenantId, tenantId), eq(chatMessages.body, SEEDED_REPORTED_CHAT_BODY))).limit(1);
  if (!target) return;
  const [other] = await db.select({ id: chatMessages.senderMembershipId }).from(chatMessages).where(and(eq(chatMessages.conversationId, target.conversationId), ne(chatMessages.senderMembershipId, target.senderMembershipId!))).limit(1);
  await db.insert(chatReports).values({
    tenantId,
    targetKind: "MESSAGE",
    targetId: target.id,
    conversationId: target.conversationId,
    reporterMembershipId: other!.id,
    reportedMembershipId: target.senderMembershipId,
    reason: "HARASSMENT",
    details: "He's threatening me because I wouldn't do him a favour.",
    contextMessageIds: await reportContextIds(db, target, { joinedSeq: 0 }, []),
  });
}

/**
 * Two groups in demo-university, with none of the members the e2e journeys sign in as (Meera, Sneha, Arjun and Vikram), so
 * nothing here changes what those journeys see: an open group with a short history, and an invite-only one with a
 * pending invitation for a generated member nobody signs in as.
 */
async function seedChatGroups(db: Db, tenantId: string, member: (phone: string) => string): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(chatGroups).where(eq(chatGroups.tenantId, tenantId));
  if ((row?.count ?? 0) > 0) return;
  const generated = await db
    .select({ id: memberships.id, phone: users.phoneE164 })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), inArray(users.phoneE164, ["+91931000001", "+91931000002", "+91931000003", "+91931000004"])));
  const byPhone = new Map(generated.map((g) => [g.phone, g.id]));
  const [imran, ritu, aisha, aarav] = ["+91931000001", "+91931000002", "+91931000003", "+91931000004"].map((p) => byPhone.get(p));
  const [rahul, priya] = ["+919100000001", "+919100000002"].map(member) as [string, string];
  const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY - minutes * 60_000);
  const present = <T extends { id: string | undefined }>(rows: T[]) => rows.filter((r): r is T & { id: string } => !!r.id);

  await runInTransaction({ db, logger: createLogger("silent", false) }, async (tx) => {
    await seedGroup(tx, {
      tenantId,
      name: "London & UK alumni",
      description: "For DemoU alumni living in or passing through the UK: meetups, flat hunting and job leads.",
      visibility: "OPEN",
      members: present([
        { id: priya, joinedAt: ago(40) },
        { id: rahul, joinedAt: ago(38) },
        { id: imran, joinedAt: ago(30) },
        { id: ritu, joinedAt: ago(21) },
      ]),
      messages: [
        { senderId: priya, body: "Welcome, everyone! Say hello and tell us where in the UK you are.", at: ago(38, 30) },
        { senderId: rahul, body: "Mumbai, but in London twice a year for work. Happy to meet up when I'm over.", at: ago(37) },
        ...(imran ? [{ senderId: imran, body: "Manchester here. Anyone up north?", at: ago(29) }] : []),
        ...(ritu ? [{ senderId: ritu, body: "Just moved to Leeds for a master's. Any tips on finding a flat?", at: ago(20) }] : []),
        { senderId: priya, body: "Pub meetup near King's Cross on the last Friday of the month. All welcome.", at: ago(3, 90) },
      ],
    });
    await seedGroup(tx, {
      tenantId,
      name: "Batch of 2012 reunion committee",
      description: "Planning the 15-year reunion: venue, dates and who's bringing the old photos.",
      visibility: "INVITE_ONLY",
      members: present([
        { id: rahul, joinedAt: ago(25) },
        { id: priya, joinedAt: ago(25) },
        { id: aisha, joinedAt: ago(14) },
      ]),
      messages: [
        { senderId: rahul, body: "Shall we aim for December? The campus auditorium is free on the 14th.", at: ago(24) },
        { senderId: priya, body: "December works if we fix it soon. I'll book flights early.", at: ago(23, 200) },
        ...(aisha ? [{ senderId: aisha, body: "I can put together a slideshow from the batch photos.", at: ago(13) }] : []),
      ],
      invited: present([{ id: aarav, at: ago(2) }]),
    });
  });
}

/**
 * Mentors in demo-university, a request waiting for one and a mentorship under way with the chat its acceptance opened.
 * Rahul and Priya mentor, alongside generated members, and every mentee is generated, so none of the members the e2e
 * journeys sign in as (Arjun, Meera, Vikram, Sneha, the admin, and the generated +91931000006 and 07, or anyone after
 * +91931000011) has a mentor profile, a request or a new thread.
 */
async function seedMentorship(db: Db, tenantId: string, member: (phone: string) => string): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(mentorProfiles).where(eq(mentorProfiles.tenantId, tenantId));
  if ((row?.count ?? 0) > 0) return;
  const phones = ["+91931000008", "+91931000009", "+91931000010", "+91931000011"];
  const generated = await db
    .select({ id: memberships.id, phone: users.phoneE164 })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), inArray(users.phoneE164, phones)));
  const byPhone = new Map(generated.map((g) => [g.phone, g.id]));
  const [coder, civil, finalYear, founder] = phones.map((p) => byPhone.get(p));
  const [rahul, priya] = ["+919100000001", "+919100000002"].map(member) as [string, string];
  const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY - minutes * 60_000);
  const profile = (membershipId: string | undefined, areas: MentorArea[], availability: MentorAvailability, availabilityNote: string | null, note: string, days: number) =>
    membershipId ? [{ tenantId, membershipId, areas, availability, availabilityNote, note, createdAt: ago(days), updatedAt: ago(days) }] : [];

  await runInTransaction({ db, logger: createLogger("silent", false) }, async (tx) => {
    await tx.insert(mentorProfiles).values([
      ...profile(rahul, ["ENTREPRENEURSHIP", "FINANCE"], "MONTHLY", "Saturday mornings, Mumbai time", "I started Zylo Labs after six years in banking. Happy to talk through fundraising, early hiring, or whether to start at all.", 60),
      ...profile(priya, ["CAREER_ADVICE", "HIGHER_STUDIES", "WORKING_ABROAD"], "FORTNIGHTLY", "Weekday evenings, UK time", "I moved from engineering to product, and from India to the UK. Glad to help with either, or with applying for a master's abroad.", 45),
      ...profile(coder, ["SOFTWARE_IT", "CAREER_ADVICE"], "WEEKLY", null, "I review CVs and run practice interviews for software roles.", 30),
      ...profile(civil, ["PUBLIC_SERVICE", "LAW"], "ONE_OFF", "One call, any weekday", "Ask me about the civil services exams, or what the work is really like.", 20),
    ]);
    if (finalYear) {
      await tx.insert(mentorships).values({ tenantId, mentorMembershipId: priya, menteeMembershipId: finalYear, note: "I'm in my final year and weighing a master's in the UK against working first. Could I ask how you decided?", createdAt: ago(2), updatedAt: ago(2) });
    }
    if (founder) {
      const note = "I'm building a small payments tool for local shops and would value advice on finding the first ten customers.";
      const [accepted] = await tx
        .insert(mentorships)
        .values({ tenantId, mentorMembershipId: rahul, menteeMembershipId: founder, status: "ACCEPTED", note, respondedAt: ago(11), acceptedAt: ago(11), createdAt: ago(12), updatedAt: ago(11) })
        .returning({ id: mentorships.id });
      const [first] = await seedDirectThread(tx, {
        tenantId,
        aId: founder,
        bId: rahul,
        requesterId: founder,
        state: "ACCEPTED",
        origin: { kind: "MENTORSHIP", id: accepted!.id },
        messages: [
          { senderId: founder, body: note, at: ago(11) },
          { senderId: rahul, body: "Glad to help. Send me a one-page summary of what you've built, and who has tried it so far.", at: ago(10, 600) },
          { senderId: founder, body: "Sent it to you just now. Three shops in Andheri are using it every day.", at: ago(10, 300) },
        ],
      });
      await tx.update(mentorships).set({ conversationId: first!.conversationId }).where(eq(mentorships.id, accepted!.id));
    }
  });
}

/**
 * Referral requests in demo-university: Rahul's and Priya's jobs take them, a request waits for Priya, and Rahul accepted
 * one, with the chat its acceptance opened. Both requesters are generated members nobody signs in as and who aren't in any
 * mentorship, so none of the members the e2e journeys sign in as (see seedMentorship) asks, is asked or gets a new thread.
 * Jobs and generated members come from the other seeds, and whatever is missing is skipped.
 */
async function seedReferrals(db: Db, tenantId: string, member: (phone: string) => string): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(referralRequests).where(eq(referralRequests.tenantId, tenantId));
  if ((row?.count ?? 0) > 0) return;
  const [rahul, priya] = ["+919100000001", "+919100000002"].map(member) as [string, string];
  const offered = await db
    .update(jobs)
    .set({ canRefer: true })
    .where(and(eq(jobs.tenantId, tenantId), or(and(eq(jobs.authorMembershipId, rahul), eq(jobs.title, "Backend Engineer (Node.js)")), and(eq(jobs.authorMembershipId, priya), eq(jobs.title, "Associate Product Manager")))))
    .returning();
  const backend = offered.find((j) => j.authorMembershipId === rahul);
  const apm = offered.find((j) => j.authorMembershipId === priya);
  const phones = ["+91931000005", "+91931000009"];
  const generated = await db
    .select({ id: memberships.id, phone: users.phoneE164 })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), inArray(users.phoneE164, phones)));
  const byPhone = new Map(generated.map((g) => [g.phone, g.id]));
  const [analyst, engineer] = phones.map((p) => byPhone.get(p));
  const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY - minutes * 60_000);

  await runInTransaction({ db, logger: createLogger("silent", false) }, async (tx) => {
    if (apm && analyst) {
      const note = "I'm a product analyst with two years on consumer apps, and I'd love to be considered for the APM role. Would you be willing to refer me?";
      await tx.insert(referralRequests).values({ tenantId, jobId: apm.id, jobTitle: apm.title, jobCompany: apm.companyName, posterMembershipId: priya, requesterMembershipId: analyst, note, createdAt: ago(1, 200), updatedAt: ago(1, 200) });
    }
    // Only where the two have no thread yet: an accepted referral reuses one, and the seed has no business changing it.
    if (backend && engineer && !(await lockDirectConversation(tx, tenantId, engineer, rahul))) {
      const note = "I've spent three years building payment APIs with Node and Postgres. Would you be willing to refer me for the backend role at Zylo Labs?";
      const [accepted] = await tx
        .insert(referralRequests)
        .values({ tenantId, jobId: backend.id, jobTitle: backend.title, jobCompany: backend.companyName, posterMembershipId: rahul, requesterMembershipId: engineer, status: "ACCEPTED", note, respondedAt: ago(3), acceptedAt: ago(3), createdAt: ago(4), updatedAt: ago(3) })
        .returning({ id: referralRequests.id });
      const [first] = await seedDirectThread(tx, {
        tenantId,
        aId: engineer,
        bId: rahul,
        requesterId: engineer,
        state: "ACCEPTED",
        origin: { kind: "REFERRAL", id: accepted!.id },
        messages: [
          { senderId: engineer, body: note, at: ago(3) },
          { senderId: rahul, body: "Happy to. Send me your CV and a few lines on the ledger work you've done, and I'll pass it to our hiring lead.", at: ago(2, 600) },
          { senderId: engineer, body: "Thank you! I've emailed both to you just now.", at: ago(2, 300) },
        ],
      });
      await tx.update(referralRequests).set({ conversationId: first!.conversationId }).where(eq(referralRequests.id, accepted!.id));
    }
  });
}

/**
 * Someone still at school, who shows that private contact stays closed to current pupils even with messaging on. Named so
 * the generated members (seedDemoHistory's FIRST and LAST lists) can't share the name: Demo University's +91931000005, who
 * asks Priya for a referral, would otherwise be a second "Ira Banerjee".
 */
async function seedCurrentPupil(db: Db, tenantIds: Record<string, string>): Promise<void> {
  const school = tenantIds["demo-school"];
  if (!school) return;
  await upsertSeedMember(db, school, { phone: "+919100000026", fullName: "Naina Sen", batchYear: new Date().getFullYear() + 2, professionType: "STUDENT", city: "Bengaluru", country: "IN" });
}

/** Direct threads for the Samaj showcase: one accepted chat and one pending request. */
async function seedSamajChatThreads(db: Db, tenantId: string, member: (phone: string) => string): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(chatConversations).where(eq(chatConversations.tenantId, tenantId));
  if ((row?.count ?? 0) > 0) return;
  const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY - minutes * 60_000);
  const [hetal, ravi, asha, bhavin] = ["+919100000031", "+919100000032", "+919100000034", "+919100000035"].map(member) as [string, string, string, string];
  await runInTransaction({ db, logger: createLogger("silent", false) }, async (tx) => {
    await seedDirectThread(tx, {
      tenantId,
      aId: hetal,
      bId: ravi,
      requesterId: hetal,
      state: "ACCEPTED",
      unreadByRecipient: 1,
      messages: [
        { senderId: hetal, body: "Ravi, do you know anyone who needs cotton blends for a small clothing line?", at: ago(5, 120) },
        { senderId: ravi, body: "A friend in Ahmedabad is starting one. I'll introduce you.", at: ago(5, 60) },
        { senderId: hetal, body: "Perfect — thank you. Sample pack is ready whenever they want it.", at: ago(1, 30) },
      ],
    });
    await seedDirectThread(tx, {
      tenantId,
      aId: asha,
      bId: bhavin,
      requesterId: asha,
      state: "PENDING",
      messages: [{ senderId: asha, body: "Hi Bhavin, I'm finishing my BBA and would love advice on whether to join a bank or a family business first.", at: ago(1) }],
    });
  });
}

/** An open Ahmedabad chapter group and an invite-only Garba committee. */
async function seedSamajChatGroups(db: Db, tenantId: string, member: (phone: string) => string): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(chatGroups).where(eq(chatGroups.tenantId, tenantId));
  if ((row?.count ?? 0) > 0) return;
  const generated = await db
    .select({ id: memberships.id, phone: users.phoneE164 })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), inArray(users.phoneE164, ["+91934000001", "+91934000002", "+91934000003", "+91934000004"])));
  const byPhone = new Map(generated.map((g) => [g.phone, g.id]));
  const [gen1, gen2, gen3, gen4] = ["+91934000001", "+91934000002", "+91934000003", "+91934000004"].map((p) => byPhone.get(p));
  const [admin, hetal, ravi, asha] = ["+919000000004", "+919100000031", "+919100000032", "+919100000034"].map(member) as [string, string, string, string];
  const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY - minutes * 60_000);
  const present = <T extends { id: string | undefined }>(rows: T[]) => rows.filter((r): r is T & { id: string } => !!r.id);

  await runInTransaction({ db, logger: createLogger("silent", false) }, async (tx) => {
    await seedGroup(tx, {
      tenantId,
      name: "Ahmedabad chapter",
      description: "Meetups, job leads and local news for members in and around Ahmedabad.",
      visibility: "OPEN",
      members: present([
        { id: admin, joinedAt: ago(50) },
        { id: ravi, joinedAt: ago(40) },
        { id: asha, joinedAt: ago(25) },
        { id: gen1, joinedAt: ago(20) },
        { id: gen2, joinedAt: ago(12) },
      ]),
      messages: [
        { senderId: admin, body: "Welcome to the Ahmedabad chapter. Say hello and tell us which area you're in.", at: ago(48) },
        { senderId: ravi, body: "Navrangpura here. Happy to host a product workshop if there's interest.", at: ago(40) },
        ...(gen1 ? [{ senderId: gen1, body: "Satellite. Looking forward to Navratri at the hall.", at: ago(18) }] : []),
        { senderId: asha, body: "Nirma campus — any internship leads for marketing this summer?", at: ago(5) },
        { senderId: ravi, body: "I'll post a role in Jobs shortly. Watch that section.", at: ago(4, 60) },
      ],
    });
    await seedGroup(tx, {
      tenantId,
      name: "Navratri organising committee",
      description: "Planning Garba nights: volunteers, prasadam and seating.",
      visibility: "INVITE_ONLY",
      members: present([
        { id: admin, joinedAt: ago(30) },
        { id: hetal, joinedAt: ago(28) },
        { id: gen3, joinedAt: ago(15) },
      ]),
      messages: [
        { senderId: admin, body: "Can we confirm the hall booking for all nine evenings?", at: ago(29) },
        { senderId: hetal, body: "Surat chapter can send two volunteers for the final night.", at: ago(27) },
        ...(gen3 ? [{ senderId: gen3, body: "I'll draft the volunteer roster this week.", at: ago(14) }] : []),
      ],
      invited: present([{ id: gen4, at: ago(2) }]),
    });
  });
}

/** Mentors, a waiting request and an accepted mentorship with its chat. */
async function seedSamajMentorship(db: Db, tenantId: string, member: (phone: string) => string): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(mentorProfiles).where(eq(mentorProfiles.tenantId, tenantId));
  if ((row?.count ?? 0) > 0) return;
  const phones = ["+91934000005", "+91934000006"];
  const generated = await db
    .select({ id: memberships.id, phone: users.phoneE164 })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), inArray(users.phoneE164, phones)));
  const byPhone = new Map(generated.map((g) => [g.phone, g.id]));
  const [waiting, acceptedMentee] = phones.map((p) => byPhone.get(p));
  const [bhavin, nisha, asha] = ["+919100000035", "+919100000036", "+919100000034"].map(member) as [string, string, string];
  const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY - minutes * 60_000);
  const profile = (membershipId: string | undefined, areas: MentorArea[], availability: MentorAvailability, availabilityNote: string | null, note: string, days: number) =>
    membershipId ? [{ tenantId, membershipId, areas, availability, availabilityNote, note, createdAt: ago(days), updatedAt: ago(days) }] : [];

  await runInTransaction({ db, logger: createLogger("silent", false) }, async (tx) => {
    await tx.insert(mentorProfiles).values([
      ...profile(bhavin, ["ENTREPRENEURSHIP", "FINANCE"], "MONTHLY", "Sunday mornings, Ahmedabad time", "I work in SME banking. Happy to talk credit, cash flow and when to raise for a family business or startup.", 50),
      ...profile(nisha, ["CAREER_ADVICE", "WORKING_ABROAD", "CONSULTING"], "FORTNIGHTLY", "Weekday evenings, US East time", "I moved from Ahmedabad to New Jersey for consulting. Glad to help with CVs, interviews or settling in the US.", 40),
    ]);
    // Named mentee so the Mentors section is useful even before generated history runs.
    await tx.insert(mentorships).values({ tenantId, mentorMembershipId: nisha, menteeMembershipId: asha, note: "I'm finishing my BBA and considering a master's in the US. Could I ask how you decided and what helped in the first year?", createdAt: ago(2), updatedAt: ago(2) });
    if (waiting) {
      await tx.insert(mentorships).values({ tenantId, mentorMembershipId: bhavin, menteeMembershipId: waiting, note: "We're expanding our small manufacturing unit and need advice on working-capital loans versus raising from family.", createdAt: ago(1), updatedAt: ago(1) });
    }
    if (acceptedMentee) {
      const note = "I run a small packaged-food brand in Rajkot and would value advice on distribution into Ahmedabad kiranas.";
      const [accepted] = await tx
        .insert(mentorships)
        .values({ tenantId, mentorMembershipId: bhavin, menteeMembershipId: acceptedMentee, status: "ACCEPTED", note, respondedAt: ago(10), acceptedAt: ago(10), createdAt: ago(11), updatedAt: ago(10) })
        .returning({ id: mentorships.id });
      const [first] = await seedDirectThread(tx, {
        tenantId,
        aId: acceptedMentee,
        bId: bhavin,
        requesterId: acceptedMentee,
        state: "ACCEPTED",
        origin: { kind: "MENTORSHIP", id: accepted!.id },
        messages: [
          { senderId: acceptedMentee, body: note, at: ago(10) },
          { senderId: bhavin, body: "Glad to help. Send me your current SKUs and which cities you're in today, and we'll map a simple next step.", at: ago(9, 400) },
          { senderId: acceptedMentee, body: "Sent — six SKUs, Rajkot and Jamnagar so far.", at: ago(9, 200) },
        ],
      });
      await tx.update(mentorships).set({ conversationId: first!.conversationId }).where(eq(mentorships.id, accepted!.id));
    }
  });
}

/** Referral requests against Ravi's APM job: one waiting, one accepted with chat. */
async function seedSamajReferrals(db: Db, tenantId: string, member: (phone: string) => string): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(referralRequests).where(eq(referralRequests.tenantId, tenantId));
  if ((row?.count ?? 0) > 0) return;
  const [ravi, asha] = ["+919100000032", "+919100000034"].map(member) as [string, string];
  const offered = await db
    .update(jobs)
    .set({ canRefer: true })
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.authorMembershipId, ravi), eq(jobs.title, "Associate Product Manager")))
    .returning();
  const apm = offered[0];
  if (!apm) return;
  const phones = ["+91934000007"];
  const generated = await db
    .select({ id: memberships.id, phone: users.phoneE164 })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), inArray(users.phoneE164, phones)));
  const byPhone = new Map(generated.map((g) => [g.phone, g.id]));
  const engineer = byPhone.get("+91934000007");
  const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY - minutes * 60_000);

  await runInTransaction({ db, logger: createLogger("silent", false) }, async (tx) => {
    const pendingNote = "I'm finishing my BBA with a product internship behind me. Would you be willing to refer me for the APM role?";
    await tx.insert(referralRequests).values({ tenantId, jobId: apm.id, jobTitle: apm.title, jobCompany: apm.companyName, posterMembershipId: ravi, requesterMembershipId: asha, note: pendingNote, createdAt: ago(1, 100), updatedAt: ago(1, 100) });
    if (engineer && !(await lockDirectConversation(tx, tenantId, engineer, ravi))) {
      const note = "I've spent two years as a business analyst on enterprise apps. Would you be willing to refer me for the APM role at TCS Digital?";
      const [accepted] = await tx
        .insert(referralRequests)
        .values({ tenantId, jobId: apm.id, jobTitle: apm.title, jobCompany: apm.companyName, posterMembershipId: ravi, requesterMembershipId: engineer, status: "ACCEPTED", note, respondedAt: ago(3), acceptedAt: ago(3), createdAt: ago(4), updatedAt: ago(3) })
        .returning({ id: referralRequests.id });
      const [first] = await seedDirectThread(tx, {
        tenantId,
        aId: engineer,
        bId: ravi,
        requesterId: engineer,
        state: "ACCEPTED",
        origin: { kind: "REFERRAL", id: accepted!.id },
        messages: [
          { senderId: engineer, body: note, at: ago(3) },
          { senderId: ravi, body: "Happy to. Send me your CV and two lines on a product decision you owned, and I'll pass it to the hiring manager.", at: ago(2, 500) },
          { senderId: engineer, body: "Thank you — emailed both just now.", at: ago(2, 200) },
        ],
      });
      await tx.update(referralRequests).set({ conversationId: first!.conversationId }).where(eq(referralRequests.id, accepted!.id));
    }
  });
}

/** The Wave 2 connections data. Runs after everything else, and each part guards itself, so an existing database gets it from the next seed. */
export async function seedConnections(db: Db, tenantIds: Record<string, string>, m: Record<string, string>): Promise<void> {
  await seedBusinessListings(db, tenantIds, m);
  const mid = seededMember(m);
  const uni = tenantIds["demo-university"];
  if (uni) {
    await seedChatThreads(db, uni, (phone) => mid("demo-university", phone));
    await seedChatReport(db, uni);
    await seedChatGroups(db, uni, (phone) => mid("demo-university", phone));
    await seedMentorship(db, uni, (phone) => mid("demo-university", phone));
    await seedReferrals(db, uni, (phone) => mid("demo-university", phone));
  }
  const samaj = tenantIds["shri-gujarati-samaj"];
  if (samaj) {
    await seedSamajChatThreads(db, samaj, (phone) => mid("shri-gujarati-samaj", phone));
    await seedSamajChatGroups(db, samaj, (phone) => mid("shri-gujarati-samaj", phone));
    await seedSamajMentorship(db, samaj, (phone) => mid("shri-gujarati-samaj", phone));
    await seedSamajReferrals(db, samaj, (phone) => mid("shri-gujarati-samaj", phone));
  }
  await seedCurrentPupil(db, tenantIds);
}

export async function seedAll(db: Db, platformAdminPhones: string[]): Promise<SeedResult & { memberships: number; tenantsWithContent: number; history: DemoHistoryResult }> {
  const core = await seedCore(db, platformAdminPhones);
  const membershipIds = await seedMembers(db, core.tenantIds);
  const tenantsWithContent = await seedContent(db, core.tenantIds, membershipIds);
  await seedBilling(db, core.tenantIds, core.platformAdminUserId);
  const history = await seedDemoHistory(db, core.tenantIds, membershipIds);
  await seedConnections(db, core.tenantIds, membershipIds);
  return { ...core, memberships: Object.keys(membershipIds).length, tenantsWithContent, history };
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
