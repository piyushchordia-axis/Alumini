import { resolveNotificationPrefs, wallPartsInZone, type CelebrationKind, type CelebrationsTodayDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import type { JobHandler } from "../jobs/JobQueue";
import { AppError } from "../lib/errors";
import { runInTransaction } from "../lib/transaction";
import { activeTenantsPage, celebrantsOn, claimTenantRun, countWishes, finishTenantRun, finishedTenantRuns, insertWish, wishesFor, type CelebrantRow } from "../repositories/engagement.repo";
import { findNotificationPrefs } from "../repositories/notifications.repo";
import { findTenantById } from "../repositories/tenants.repo";
import type { MembershipRow, TenantContext } from "../types/request";
import { notify } from "./notifications/notification.service";

/** Greetings go out once the institution's local time passes this hour. */
export const CELEBRATIONS_HOUR = 9;
/** People listed on the feed card (the rest are "and N more"). */
export const CELEBRATIONS_CARD_SIZE = 12;
const TENANT_PAGE = 500;
const pad = (n: number) => String(n).padStart(2, "0");

/** A date and hour in a time zone, for scheduling ("YYYY-MM-DD", 0-23, and the ISO weekday 1 = Monday). */
export function localClock(at: Date, timeZone: string): { day: string; hour: number; weekday: number } {
  const p = wallPartsInZone(at, timeZone);
  const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const weekday = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return { day, hour: p.hour, weekday };
}

/** Per-institution work the tick schedules: when its slot opens, the period key, and the job to queue. */
export interface TenantSlot {
  job: string;
  due: (clock: ReturnType<typeof localClock>) => string | null;
  enqueue: (ctx: AppContext, tenantId: string, periodKey: string, hour: number) => Promise<void>;
}

export const celebrationsSlot: TenantSlot = {
  job: "celebrations",
  due: (c) => (c.hour >= CELEBRATIONS_HOUR ? c.day : null),
  // The hour in the job id lets a failed run be tried again in the next hour, while the 15-minute ticks within an
  // hour collapse into one job.
  enqueue: (ctx, tenantId, day, hour) => ctx.jobs.enqueue("celebrations.tenant", { tenantId, day }, { jobId: `cel-${tenantId}-${day}-${hour}` }),
};

/** Slots the tick runs; the weekly digest adds itself here. */
export const tenantSlots: TenantSlot[] = [celebrationsSlot];

/**
 * The engagement.tick job (every 15 minutes): for every active institution, queues the per-institution jobs whose
 * local slot has opened and whose period isn't done yet. `at` lets tests and staff pick the moment.
 */
export const engagementTick: JobHandler<"engagement.tick"> = async (ctx, data) => {
  const at = data.at ? new Date(data.at) : new Date();
  let after: string | null = null;
  for (;;) {
    const page = await activeTenantsPage(ctx.db, after, TENANT_PAGE);
    if (page.length === 0) break;
    for (const slot of tenantSlots) {
      const due = page
        .map((t) => ({ t, clock: localClock(at, t.timezone) }))
        .map(({ t, clock }) => ({ tenantId: t.id, hour: clock.hour, period: slot.due(clock) }))
        .filter((x): x is { tenantId: string; hour: number; period: string } => !!x.period);
      const done = await finishedTenantRuns(
        ctx.db,
        slot.job,
        due.map((d) => d.tenantId),
        [...new Set(due.map((d) => d.period))],
      );
      for (const d of due) if (!done.has(`${d.tenantId}|${d.period}`)) await slot.enqueue(ctx, d.tenantId, d.period, d.hour);
    }
    if (page.length < TENANT_PAGE) break;
    after = page[page.length - 1]!.id;
  }
};

const firstName = (full: string) => full.split(/\s+/)[0] ?? full;

/**
 * The celebrations.tenant job: one greeting per person celebrating on `day` in the institution (deduped, so a retry
 * or a second run sends nothing new). The run is claimed first and marked done after.
 */
export const runCelebrations: JobHandler<"celebrations.tenant"> = async (ctx, { tenantId, day }) => {
  const tenant = await findTenantById(ctx.db, tenantId);
  if (!tenant || tenant.status !== "ACTIVE") return;
  if (!(await claimTenantRun(ctx.db, "celebrations", tenantId, day))) return;
  const celebrants = await celebrantsOn(ctx.db, tenantId, day, tenant.timezone);
  const groups = new Map<string, CelebrantRow[]>();
  for (const c of celebrants) {
    const key = `${c.kind}|${c.years ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  await runInTransaction(ctx, async (tx) => {
    for (const [, people] of groups) {
      const { kind, years } = people[0]!;
      await notify(
        ctx,
        {
          tenantId,
          recipientMembershipIds: people.map((p) => p.membershipId),
          type: "CELEBRATION",
          title: kind === "BIRTHDAY" ? "🎂 Happy birthday!" : `🎉 ${years} year${years === 1 ? "" : "s"} with ${tenant.shortName ?? tenant.name}!`,
          body: kind === "BIRTHDAY" ? `Everyone at ${tenant.name} wishes you a wonderful year ahead.` : `Thank you for being part of the ${tenant.name} alumni network.`,
          data: { kind, day },
          dedupeKey: `cel-${kind}-${day}`,
        },
        tx,
      );
    }
    await finishTenantRun(tx, "celebrations", tenantId, day);
  });
};

function todayFor(tenantCtx: TenantContext): string {
  return localClock(new Date(), tenantCtx.tenant.timezone).day;
}

/** Today's celebrations for the feed card (day and month are implied; no year or age is ever returned). */
export async function getCelebrationsToday(ctx: AppContext, tenantCtx: TenantContext, viewer: MembershipRow): Promise<CelebrationsTodayDto> {
  const day = todayFor(tenantCtx);
  const celebrants = await celebrantsOn(ctx.db, tenantCtx.tenant.id, day, tenantCtx.tenant.timezone);
  // The viewer first (if celebrating), then everyone else in name order.
  celebrants.sort((a, b) => Number(b.membershipId === viewer.id) - Number(a.membershipId === viewer.id));
  const shown = celebrants.slice(0, CELEBRATIONS_CARD_SIZE);
  const wishes = await wishesFor(
    ctx.db,
    shown.map((c) => c.membershipId),
    day,
  );
  const prefs = resolveNotificationPrefs(await findNotificationPrefs(ctx.db, viewer.id));
  return {
    date: day,
    items: shown.map((c) => {
      const mine = wishes.filter((w) => w.recipientId === c.membershipId && w.kind === c.kind);
      return {
        membershipId: c.membershipId,
        fullName: c.fullName,
        avatarUrl: c.avatarUrl,
        batchYear: c.batchYear,
        kind: c.kind,
        years: c.years,
        isMe: c.membershipId === viewer.id,
        wishedByMe: mine.some((w) => w.senderId === viewer.id),
        wishCount: mine.length,
      };
    }),
    more: Math.max(celebrants.length - shown.length, 0),
    showNotice: !!viewer.dateOfBirth && viewer.celebrateBirthday && !prefs.celebrationsNoticeSeenAt,
  };
}

/**
 * Sends wishes to someone celebrating today (once per sender, day and kind). The person gets one notification per day
 * and kind that updates as wishes come in ("Asha and 3 others sent you birthday wishes"), pushed only the first time.
 */
export async function sendWish(ctx: AppContext, tenantCtx: TenantContext, sender: MembershipRow, recipientId: string, kind: CelebrationKind): Promise<{ wishCount: number }> {
  if (recipientId === sender.id) throw AppError.badRequest("You can't send wishes to yourself");
  const day = todayFor(tenantCtx);
  const celebrants = await celebrantsOn(ctx.db, tenantCtx.tenant.id, day, tenantCtx.tenant.timezone);
  const target = celebrants.find((c) => c.membershipId === recipientId && c.kind === kind);
  if (!target) throw AppError.notFound("This member isn't celebrating today");
  await runInTransaction(ctx, async (tx) => {
    const added = await insertWish(tx, { tenantId: tenantCtx.tenant.id, senderMembershipId: sender.id, recipientMembershipId: recipientId, kind, day });
    if (!added) return;
    const n = await countWishes(tx, recipientId, day, kind);
    const what = kind === "BIRTHDAY" ? "birthday wishes" : "anniversary wishes";
    await notify(
      ctx,
      {
        tenantId: tenantCtx.tenant.id,
        recipientMembershipIds: [recipientId],
        type: "CELEBRATION_WISH",
        title: n <= 1 ? `${firstName(sender.fullName)} sent you ${what} 🎉` : `${firstName(sender.fullName)} and ${n - 1} other${n - 1 === 1 ? "" : "s"} sent you ${what} 🎉`,
        data: { kind, day },
        dedupeKey: `wish-${kind}-${day}`,
        merge: true,
      },
      tx,
    );
  });
  return { wishCount: await countWishes(ctx.db, recipientId, day, kind) };
}
