import { wallPartsInZone, zonedWallTimeToUtc, type ProfileFieldValue } from "@illuminize/shared";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  events,
  invitations,
  jobs,
  memberActivityDays,
  memberFieldValues,
  memberships,
  pollOptions,
  pollVotes,
  postAnnouncements,
  postComments,
  postPolls,
  postReactions,
  posts,
  tenantBillingPlans,
  tenantProfileFields,
  users,
} from "./schema";

/**
 * Demo history, relative to today, so analytics, celebrations, the digest and invitations have something to show:
 * six months of approvals, activity and content, profile questions with answers, invitations in every
 * state, a poll, an announcement, a birthday and a membership anniversary today, and a few confirmed emails.
 * Deterministic and safe to run again: each part is skipped when it already exists.
 */

const ZONE = "Asia/Kolkata";
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Small seeded PRNG (mulberry32): the same demo every time for the same key. */
function rng(key: string): () => number {
  let a = 0;
  for (const ch of key) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 0x9e3779b9) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;

function localDay(at: Date): string {
  const p = wallPartsInZone(at, ZONE);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** An instant on a local calendar day at a local hour (minutes from the PRNG so times look natural). */
function at(day: string, hour: number, minute = 0): Date {
  return new Date(zonedWallTimeToUtc(`${day}T${pad(hour)}:${pad(minute)}`, ZONE)!);
}

const FIRST = ["Aarav", "Ishaan", "Kavya", "Diya", "Saanvi", "Aditi", "Riya", "Ira", "Kabir", "Vihaan", "Reyansh", "Myra", "Anika", "Farhan", "Zoya", "Imran", "Sana", "Harpreet", "Gurleen", "Manish", "Sunita", "Deepak", "Ritu", "Nandini", "Varun", "Siddharth", "Tanvi", "Yash", "Omkar", "Aisha", "Joseph", "Maria", "Fatima", "Rajesh", "Smita", "Gaurav"] as const;
const LAST = ["Agarwal", "Banerjee", "Chopra", "Dutta", "Fernandes", "Gupta", "Hegde", "Jain", "Khan", "Lobo", "Mishra", "Naidu", "Pandey", "Qureshi", "Saxena", "Thakur", "Vaidya", "Wadhwa", "Yadav", "Zaveri", "D'Souza", "Chatterjee"] as const;
const PLACES = [
  ["Mumbai", "IN", 9],
  ["Pune", "IN", 6],
  ["Bengaluru", "IN", 8],
  ["Delhi", "IN", 6],
  ["Hyderabad", "IN", 4],
  ["Chennai", "IN", 3],
  ["Kolkata", "IN", 2],
  ["Ahmedabad", "IN", 2],
  ["London", "GB", 3],
  ["Dubai", "AE", 3],
  ["Singapore", "SG", 2],
  ["New York", "US", 2],
  ["San Francisco", "US", 2],
  ["Toronto", "CA", 1],
  ["Sydney", "AU", 1],
] as const;
const COMPANIES = ["Infosys", "TCS", "Wipro", "HDFC Bank", "Reliance", "Flipkart", "Swiggy", "Zomato", "Accenture", "KPMG", "Amazon", "Microsoft", "Razorpay", "Freshworks", "Tata Motors", "Mahindra", "ICICI Bank", "Byju's", "Ola", "Paytm"] as const;
const ROLES = ["Software Engineer", "Product Manager", "Analyst", "Consultant", "Designer", "Sales Lead", "Operations Manager", "Data Scientist", "Marketing Manager", "Chartered Accountant"] as const;
const PROFESSIONS = ["EMPLOYED", "EMPLOYED", "EMPLOYED", "EMPLOYED", "EMPLOYED", "FOUNDER", "BUSINESS_OWNER", "STUDENT", "OTHER"] as const;

const POSTS = [
  "Just moved to {city}. Any alumni around for a coffee this weekend?",
  "Our team at {company} is hiring. Happy to refer anyone from the community — DM me.",
  "Throwback to the {batch} farewell. Who remembers the power cut during the cultural night?",
  "Wrote a short piece on what I learnt in my first year as a {role}. Feedback welcome!",
  "Looking for advice on moving from engineering to product. Who has made the switch?",
  "Batch of {batch}: we're planning a reunion next year. Reply if you want to help organise.",
  "Congratulations to everyone who graduated this year. The network is here for you.",
  "Anyone attending the tech meetup in {city} next week? Let's sit together.",
  "Started mentoring two final-year students this month. Highly recommend it.",
  "Our startup crossed 1,000 customers today. Grateful to the alumni who opened doors early on.",
] as const;
const COMMENTS = ["Count me in!", "Congratulations, well deserved 👏", "Sent you a message.", "This is so useful, thanks for sharing.", "Great to see this!", "Would love to join.", "Ha, I remember that night!"] as const;

interface FieldSeed {
  key: string;
  label: string;
  type: (typeof tenantProfileFields.$inferInsert)["type"];
  options?: Array<{ value: string; label: string }>;
  filterable?: boolean;
  visibility?: "MEMBERS" | "ADMINS";
  memberEditable?: boolean;
  helpText?: string;
}
const opts = (...labels: string[]) => labels.map((l) => ({ value: l.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: l }));
const FIELDS: Record<string, FieldSeed[]> = {
  "demo-university": [
    { key: "department", label: "Department", type: "SELECT", options: opts("Computer Science", "Electronics", "Mechanical", "Civil", "Commerce", "Design"), filterable: true },
    { key: "hostel", label: "Hostel", type: "SELECT", options: opts("Tagore", "Raman", "Sarojini", "Bhabha"), filterable: true },
    { key: "mentoring", label: "Open to mentoring students", type: "BOOLEAN", helpText: "Students can find you in the directory." },
    { key: "office_notes", label: "Alumni office notes", type: "LONG_TEXT", visibility: "ADMINS", memberEditable: false },
  ],
  "demo-college": [
    { key: "branch", label: "Branch", type: "SELECT", options: opts("Computer", "IT", "E&TC", "Mechanical", "Civil"), filterable: true },
    { key: "higher_studies", label: "Higher studies", type: "SELECT", options: opts("None", "MS", "MBA", "PhD") },
    { key: "mentoring", label: "Open to mentoring students", type: "BOOLEAN" },
  ],
  "demo-school": [
    { key: "house", label: "School house", type: "SELECT", options: opts("Red", "Blue", "Green", "Yellow"), filterable: true },
    { key: "year_joined", label: "Year you joined the school", type: "NUMBER" },
    { key: "mentoring", label: "Open to mentoring students", type: "BOOLEAN" },
  ],
};

/** Generated members per institution (approved, spread over the last six months). */
const GENERATED: Record<string, { count: number; batches: [number, number]; prefix: string }> = {
  "demo-university": { count: 64, batches: [1998, 2024], prefix: "+919310" },
  "demo-college": { count: 28, batches: [1995, 2023], prefix: "+919320" },
  "demo-school": { count: 18, batches: [2000, 2024], prefix: "+919330" },
};

async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export interface DemoHistoryResult {
  generatedMembers: number;
  activityDays: number;
  posts: number;
}

export async function seedDemoHistory(db: Db, tenantIds: Record<string, string>, named: Record<string, string>, now = new Date()): Promise<DemoHistoryResult> {
  const today = localDay(now);
  const result: DemoHistoryResult = { generatedMembers: 0, activityDays: 0, posts: 0 };
  const namedId = (slug: string, phone: string) => named[`${slug}:${phone}`];

  for (const [slug, tenantId] of Object.entries(tenantIds)) {
    const gen = GENERATED[slug];
    if (!gen) continue;
    const r = rng(slug);

    // ---------- approval dates for the named demo members (admins first, the rest over recent months) ----------
    const namedRows = await db
      .select({ id: memberships.id, role: memberships.role, approvedAt: memberships.approvedAt, createdAt: memberships.createdAt })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), sql`${memberships.userId} in (select id from users where phone_e164 not like '+9193%')`));
    for (const [i, m] of namedRows.entries()) {
      // A trigger stamps approved_at when the row is inserted; only move dates the seed itself just created.
      const fresh = !m.approvedAt || (Math.abs(m.approvedAt.getTime() - m.createdAt.getTime()) < 5_000 && now.getTime() - m.createdAt.getTime() < 2 * DAY);
      if (!fresh) continue;
      const approvedAt = m.role === "TENANT_ADMIN" ? at(shiftDay(today, -730), 11) : at(shiftDay(today, -(30 + ((i * 37) % 150))), 10 + (i % 8));
      await db.update(memberships).set({ approvedAt, createdAt: new Date(approvedAt.getTime() - 3_600_000) }).where(eq(memberships.id, m.id));
    }

    // ---------- generated members ----------
    const existing = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), like(users.phoneE164, `${gen.prefix}%`)));
    if ((existing[0]?.c ?? 0) === 0) {
      const weights = PLACES.reduce((s, p) => s + p[2], 0);
      const place = () => {
        let x = r() * weights;
        for (const p of PLACES) if ((x -= p[2]) < 0) return p;
        return PLACES[0];
      };
      const people = Array.from({ length: gen.count }, (_, i) => {
        const fullName = `${FIRST[(i * 7 + slug.length) % FIRST.length]} ${LAST[(i * 5 + 3) % LAST.length]}`;
        const [city, country] = place();
        const profession = pick(r, PROFESSIONS);
        // More recent approvals are likelier (a community that's growing).
        const daysAgo = Math.floor(182 * r() ** 1.7);
        const approvedAt = at(shiftDay(today, -daysAgo), 8 + Math.floor(r() * 13), Math.floor(r() * 60));
        if (approvedAt > now) approvedAt.setTime(now.getTime() - 3_600_000);
        const batch = gen.batches[1] - Math.floor((gen.batches[1] - gen.batches[0]) * r() ** 1.4);
        const dob = r() < 0.45 ? `${batch - 21}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))}` : null;
        return {
          phone: `${gen.prefix}${String(i + 1).padStart(5, "0")}`,
          fullName,
          batch,
          city,
          country,
          profession,
          company: profession === "STUDENT" ? null : pick(r, COMPANIES),
          designation: profession === "EMPLOYED" ? pick(r, ROLES) : null,
          approvedAt,
          createdAt: new Date(approvedAt.getTime() - Math.floor(r() * 2 * DAY)),
          dob,
          linkedin: r() < 0.4 ? `https://www.linkedin.com/in/${fullName.toLowerCase().replace(/[^a-z]+/g, "-")}-${i}` : null,
        };
      });
      const userRows = await db
        .insert(users)
        .values(people.map((p) => ({ phoneE164: p.phone, phoneRegion: "IN", displayName: p.fullName })))
        .onConflictDoUpdate({ target: users.phoneE164, set: { displayName: sql`excluded.display_name` } })
        .returning({ id: users.id, phone: users.phoneE164 });
      const userBy = new Map(userRows.map((u) => [u.phone, u.id]));
      await db
        .insert(memberships)
        .values(
          people.map((p) => ({
            tenantId,
            userId: userBy.get(p.phone)!,
            status: "APPROVED" as const,
            statusChangedAt: p.approvedAt,
            approvedAt: p.approvedAt,
            createdAt: p.createdAt,
            fullName: p.fullName,
            batchYear: p.batch,
            professionType: p.profession,
            companyName: p.company,
            designation: p.designation,
            city: p.city,
            country: p.country,
            dateOfBirth: p.dob,
            linkedinUrl: p.linkedin,
          })),
        )
        .onConflictDoNothing();
      result.generatedMembers += people.length;
    }

    const all = await db
      .select({ id: memberships.id, role: memberships.role, approvedAt: memberships.approvedAt, fullName: memberships.fullName, batch: memberships.batchYear, city: memberships.city, company: memberships.companyName, designation: memberships.designation, generated: sql<boolean>`${users.phoneE164} like '+9193%'` })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED")))
      .orderBy(memberships.createdAt, memberships.id);
    const generated = all.filter((m) => m.generated);

    // ---------- 26 weeks of activity (weekdays busier, slowly growing), so the 12-week view has a previous period ----------
    const HISTORY_DAYS = 182;
    const firstDay = shiftDay(today, -(HISTORY_DAYS - 1));
    const activity: Array<{ tenantId: string; membershipId: string; day: string }> = [];
    const lastActive = new Map<string, string>();
    for (const m of all) {
      const mr = rng(`${slug}:${m.fullName}:${m.id.slice(0, 8)}`);
      const propensity = m.role === "TENANT_ADMIN" ? 0.8 : 0.06 + mr() ** 1.5 * 0.55;
      const from = m.approvedAt ? localDay(m.approvedAt) : firstDay;
      for (let d = 0; d < HISTORY_DAYS; d++) {
        const day = shiftDay(firstDay, d);
        if (day < from) continue;
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        const factor = (weekday === 0 || weekday === 6 ? 0.55 : 1) * (0.6 + (0.4 * d) / (HISTORY_DAYS - 1));
        if (mr() < propensity * factor) {
          activity.push({ tenantId, membershipId: m.id, day });
          lastActive.set(m.id, day);
        }
      }
    }
    await chunked(activity, 1000, async (rows) => {
      result.activityDays += (await db.insert(memberActivityDays).values(rows).onConflictDoNothing().returning({ day: memberActivityDays.day })).length;
    });
    for (const [id, day] of lastActive) {
      await db.update(memberships).set({ lastActiveAt: at(day, 20) }).where(and(eq(memberships.id, id), sql`(${memberships.lastActiveAt} is null or ${memberships.lastActiveAt} < ${at(day, 20)})`));
    }

    // ---------- backdated posts, comments and reactions from generated members ----------
    const genIds = generated.map((g) => g.id);
    const [hasHistory] = genIds.length ? await db.select({ c: sql<number>`count(*)::int` }).from(posts).where(and(eq(posts.tenantId, tenantId), inArray(posts.authorMembershipId, genIds))) : [{ c: 1 }];
    if (generated.length > 0 && (hasHistory?.c ?? 0) === 0) {
      const perWeek =
        slug === "demo-university"
          ? [1, 2, 1, 2, 2, 1, 2, 3, 2, 2, 3, 2, 2, 3, 2, 3, 4, 3, 4, 5, 4, 5, 6, 5, 6, 5]
          : [0, 1, 1, 0, 1, 1, 1, 0, 1, 2, 1, 1, 1, 1, 2, 1, 2, 2, 1, 2, 3, 2, 3, 2, 2, 3];
      for (const [w, n] of perWeek.entries()) {
        for (let k = 0; k < n; k++) {
          const author = pick(r, generated);
          const day = shiftDay(firstDay, w * 7 + Math.floor(r() * 7));
          if (day >= today) continue;
          const createdAt = at(day, 9 + Math.floor(r() * 12), Math.floor(r() * 60));
          const body = pick(r, POSTS)
            .replace("{city}", author.city ?? "town")
            .replace("{company}", author.company ?? "my company")
            .replace("{batch}", String(author.batch))
            .replace("{role}", (author.designation ?? "founder").toLowerCase());
          const [post] = await db.insert(posts).values({ tenantId, authorMembershipId: author.id, body, moderationStatus: "APPROVED", moderatedAt: createdAt, createdAt, updatedAt: createdAt }).returning({ id: posts.id });
          result.posts++;
          const commenters = new Set(Array.from({ length: Math.floor(r() * 4) }, () => pick(r, all).id));
          commenters.delete(author.id);
          for (const c of commenters) {
            const when = new Date(createdAt.getTime() + Math.floor(r() * 2 * DAY));
            if (when > now) continue;
            await db.insert(postComments).values({ tenantId, postId: post!.id, authorMembershipId: c, body: pick(r, COMMENTS), moderationStatus: "APPROVED", moderatedAt: when, createdAt: when, updatedAt: when });
          }
          const reactors = new Set(Array.from({ length: Math.floor(r() * 9) }, () => pick(r, all).id));
          if (reactors.size) await db.insert(postReactions).values([...reactors].map((id) => ({ tenantId, postId: post!.id, membershipId: id, type: pick(r, ["LIKE", "LIKE", "CELEBRATE", "INSIGHTFUL"] as const), createdAt }))).onConflictDoNothing();
        }
      }
      await db.execute(sql`update posts set comment_count = (select count(*) from post_comments c where c.post_id = posts.id and c.moderation_status = 'APPROVED'), reaction_count = (select count(*) from post_reactions x where x.post_id = posts.id) where tenant_id = ${tenantId}`);

      // A few older openings and a past meetup, so jobs and events show up in the weekly chart too.
      for (let k = 0; k < 4; k++) {
        const author = pick(r, generated);
        const createdAt = at(shiftDay(firstDay, 14 + k * 40 + Math.floor(r() * 10)), 11);
        await db.insert(jobs).values({ tenantId, authorMembershipId: author.id, title: `${pick(r, ROLES)}`, companyName: author.company ?? "Stealth startup", location: author.city, isRemote: r() < 0.3, jobType: "FULL_TIME", description: "Referral available for alumni. Message me for details.", isClosed: k < 2, moderationStatus: "APPROVED", moderatedAt: createdAt, createdAt, updatedAt: createdAt });
      }
      const host = pick(r, generated);
      const eventDay = shiftDay(today, -12);
      await db.insert(events).values({ tenantId, authorMembershipId: host.id, title: `${host.city ?? "City"} alumni evening`, description: "An informal evening for alumni in the city. Thanks to everyone who came!", kind: "CASUAL_MEETUP", city: host.city ?? "Mumbai", startAt: at(eventDay, 19), endAt: at(eventDay, 22), timezone: ZONE, moderationStatus: "APPROVED", moderatedAt: at(shiftDay(eventDay, -10), 10), createdAt: at(shiftDay(eventDay, -10), 10) });
    }

    // ---------- profile questions, with answers from most members ----------
    const [hasFields] = await db.select({ c: sql<number>`count(*)::int` }).from(tenantProfileFields).where(eq(tenantProfileFields.tenantId, tenantId));
    if ((hasFields?.c ?? 0) === 0) {
      const defs = await db
        .insert(tenantProfileFields)
        .values(FIELDS[slug]!.map((f, position) => ({ tenantId, key: f.key, label: f.label, type: f.type, options: f.options ?? [], filterable: f.filterable ?? false, visibility: f.visibility ?? "MEMBERS", memberEditable: f.memberEditable ?? true, helpText: f.helpText ?? null, position })))
        .returning();
      const answers: Array<{ tenantId: string; membershipId: string; fieldId: string; value: ProfileFieldValue }> = [];
      for (const m of all) {
        for (const f of defs) {
          if (r() > (f.visibility === "ADMINS" ? 0.15 : 0.7)) continue;
          const value: ProfileFieldValue =
            f.type === "SELECT"
              ? pick(r, f.options).value
              : f.type === "BOOLEAN"
                ? r() < 0.45
                : f.type === "NUMBER"
                  ? m.batch - 12 + Math.floor(r() * 4)
                  : pick(r, ["Donated to the library fund in 2024.", "Spoke at the career fair.", "Prefers WhatsApp over email."]);
          answers.push({ tenantId, membershipId: m.id, fieldId: f.id, value });
        }
      }
      await chunked(answers, 1000, (rows) => db.insert(memberFieldValues).values(rows).onConflictDoNothing());
    }
  }

  // ---------- Demo University: invitations, a poll, an announcement, celebrations today, confirmed emails ----------
  const uni = tenantIds["demo-university"];
  if (uni) {
    const adminMembership = namedId("demo-university", "+919000000001");
    const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.phoneE164, "+919000000001"));
    const [hasInvites] = await db.select({ c: sql<number>`count(*)::int` }).from(invitations).where(eq(invitations.tenantId, uni));
    if ((hasInvites?.c ?? 0) === 0) {
      const token = () => randomBytes(16).toString("base64url");
      const expiresAt = new Date(now.getTime() + 90 * DAY);
      const sentAt = new Date(now.getTime() - 3 * DAY);
      const [joined] = await db
        .select({ id: memberships.id, phone: users.phoneE164, name: memberships.fullName, batch: memberships.batchYear, approvedAt: memberships.approvedAt })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, uni), like(users.phoneE164, "+919310%")))
        .orderBy(sql`${memberships.approvedAt} desc`)
        .limit(1);
      const base = { tenantId: uni, invitedByUserId: adminUser?.id ?? null, expiresAt };
      await db.insert(invitations).values([
        { ...base, phoneE164: "+919400000001", fullName: "Harsh Vora", batchYear: 2016, token: token(), fieldValues: { department: "mechanical" } },
        { ...base, phoneE164: "+919400000002", fullName: "Leela Menon", batchYear: 2019, token: token() },
        { ...base, phoneE164: "+919400000003", fullName: "Kunal Shah", batchYear: 2011, email: "kunal@example.com", token: token() },
        { ...base, phoneE164: "+919400000004", fullName: "Nisha Kaur", batchYear: 2014, token: token(), status: "SENT" as const, sendCount: 1, lastSentAt: sentAt },
        { ...base, phoneE164: "+919400000005", fullName: "Rohit Bajaj", batchYear: 2009, token: token(), status: "SENT" as const, sendCount: 2, lastSentAt: sentAt },
        { ...base, phoneE164: "+919400000006", fullName: "Old Number", batchYear: 2003, token: token(), status: "REVOKED" as const },
        ...(joined ? [{ ...base, phoneE164: joined.phone, fullName: joined.name, batchYear: joined.batch, token: token(), status: "ACCEPTED" as const, sendCount: 1, lastSentAt: joined.approvedAt, acceptedMembershipId: joined.id, acceptedAt: joined.approvedAt }] : []),
      ]);
    }

    if (adminMembership) {
      const [hasAnnouncement] = await db.select({ c: sql<number>`count(*)::int` }).from(posts).where(and(eq(posts.tenantId, uni), eq(posts.kind, "ANNOUNCEMENT")));
      if ((hasAnnouncement?.c ?? 0) === 0) {
        const createdAt = new Date(now.getTime() - 2 * DAY);
        const [ann] = await db
          .insert(posts)
          .values({ tenantId: uni, authorMembershipId: adminMembership, kind: "ANNOUNCEMENT", isPinned: true, body: "Registrations for DemoU Alumni Day 2026 are open. RSVP from the Events tab so we can plan seating and dinner.", moderationStatus: "APPROVED", moderatedAt: createdAt, createdAt, updatedAt: createdAt })
          .returning({ id: posts.id });
        // Recorded as already delivered in the app (the seed doesn't run the fan-out job).
        await db.insert(postAnnouncements).values({ postId: ann!.id, tenantId: uni, channels: [], createdByUserId: adminUser?.id ?? null, fanoutStartedAt: createdAt, fanoutFinishedAt: createdAt });
      }
    }

    const priya = namedId("demo-university", "+919100000002");
    if (priya) {
      const [hasPoll] = await db.select({ c: sql<number>`count(*)::int` }).from(postPolls).where(eq(postPolls.tenantId, uni));
      if ((hasPoll?.c ?? 0) === 0) {
        const createdAt = new Date(now.getTime() - 4 * DAY);
        const [poll] = await db
          .insert(posts)
          .values({ tenantId: uni, authorMembershipId: priya, body: "Where should we hold the next London meetup?", moderationStatus: "APPROVED", moderatedAt: createdAt, createdAt, updatedAt: createdAt })
          .returning({ id: posts.id });
        await db.insert(postPolls).values({ postId: poll!.id, tenantId: uni, closesAt: new Date(now.getTime() + 10 * DAY), createdAt });
        const options = await db
          .insert(pollOptions)
          .values(["King's Cross", "Shoreditch", "Canary Wharf"].map((label, position) => ({ postId: poll!.id, tenantId: uni, label, position })))
          .returning({ id: pollOptions.id });
        const r = rng("poll");
        const voters = await db
          .select({ id: memberships.id })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.tenantId, uni), like(users.phoneE164, "+919310%")))
          .limit(14);
        if (voters.length) await db.insert(pollVotes).values(voters.map((v) => ({ optionId: options[r() < 0.5 ? 0 : r() < 0.6 ? 1 : 2]!.id, postId: poll!.id, tenantId: uni, membershipId: v.id }))).onConflictDoNothing();
      }
    }

    // Celebrations today (refreshed on every run, so the demo always has them): Meera's birthday (day and month only
    // are ever shown) and Rahul's third anniversary of joining.
    const [y, mo, d] = today.split("-");
    const meera = namedId("demo-university", "+919100000004");
    if (meera) await db.update(memberships).set({ dateOfBirth: `1996-${mo}-${d}` }).where(eq(memberships.id, meera)); // 1996 was a leap year
    const rahul = namedId("demo-university", "+919100000001");
    if (rahul) {
      const joinedAt = at(`${Number(y) - 3}-${mo}-${mo === "02" && d === "29" ? "28" : d}`, 10);
      await db.update(memberships).set({ approvedAt: joinedAt, createdAt: new Date(joinedAt.getTime() - 3_600_000) }).where(eq(memberships.id, rahul));
    }

    // Confirmed emails for a few members, so the digest and email announcements have recipients.
    for (const [phone, email] of [
      ["+919100000001", "rahul@example.com"],
      ["+919100000002", "priya.nair@example.com"],
      ["+919100000006", "sneha.k@example.com"],
    ] as const) {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(and(eq(users.phoneE164, phone), isNull(users.email)));
    }

    // The plan includes WhatsApp, SMS and email at per-message rates (console senders in development).
    await db
      .update(tenantBillingPlans)
      .set({ includedChannels: ["WHATSAPP", "SMS", "EMAIL"], messageRatesMinor: { WHATSAPP: 80, SMS: 25, EMAIL: 0.5 } })
      .where(and(eq(tenantBillingPlans.tenantId, uni), isNull(tenantBillingPlans.effectiveTo), sql`${tenantBillingPlans.includedChannels} = '{}'`));
  }
  return result;
}
