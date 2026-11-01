import { resolveNotificationPrefs, type DigestDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import type { JobHandler } from "../jobs/JobQueue";
import { runInTransaction } from "../lib/transaction";
import { digestCandidates, digestDetails, digestRecipientsPage, findDigest, latestDigest, saveDigest, type DigestRow } from "../repositories/digest.repo";
import { claimTenantRun, finishTenantRun } from "../repositories/engagement.repo";
import { findSettings, findTenantById } from "../repositories/tenants.repo";
import { localClock, tenantSlots, type TenantSlot } from "./celebrations.service";
import { queueMessages } from "./messages/message.service";

/** The digest goes out on Monday once the institution's local time passes this hour. */
export const DIGEST_HOUR = 8;
export const DIGEST_PAGE = 500;

export const digestSlot: TenantSlot = {
  job: "digest",
  due: (c) => (c.weekday === 1 && c.hour >= DIGEST_HOUR ? c.day : null),
  enqueue: (ctx, tenantId, weekStart, hour) => ctx.jobs.enqueue("digest.tenant", { tenantId, weekStart }, { jobId: `dig-${tenantId}-${weekStart}-${hour}` }),
};
tenantSlots.push(digestSlot);

/** Monday of the week containing `at`, in the time zone. */
export function weekStartIn(at: Date, timeZone: string): string {
  const { day, weekday } = localClock(at, timeZone);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (weekday - 1));
  return d.toISOString().slice(0, 10);
}

const isEmpty = (c: DigestRow["content"]) => c.postIds.length + c.jobIds.length + c.eventIds.length === 0;

/**
 * The digest.tenant job: picks the past week's highlights (only for features the institution has on) and stores
 * them, then queues the email batches. A week with nothing to show is skipped. Claimed per week, so repeated ticks
 * and retries build and send it once.
 */
export const runDigest: JobHandler<"digest.tenant"> = async (ctx, { tenantId, weekStart, at }) => {
  const [tenant, settings] = await Promise.all([findTenantById(ctx.db, tenantId), findSettings(ctx.db, tenantId)]);
  if (!tenant || tenant.status !== "ACTIVE" || !settings) return;
  if (!(await claimTenantRun(ctx.db, "digest", tenantId, weekStart))) return;
  const now = at ? new Date(at) : new Date();
  const found = await digestCandidates(ctx.db, tenantId, new Date(now.getTime() - 7 * 86_400_000), now);
  const content = {
    postIds: settings.features.feed ? found.postIds : [],
    jobIds: settings.features.jobs ? found.jobIds : [],
    eventIds: settings.features.events ? found.eventIds : [],
    newMembers: found.newMembers,
  };
  await runInTransaction(ctx, async (tx) => {
    if (!isEmpty(content)) {
      await saveDigest(tx, tenantId, weekStart, content);
      await ctx.jobs.enqueue("digest.batch", { tenantId, weekStart }, { jobId: `dig-batch-${tenantId}-${weekStart}-start` });
    }
    await finishTenantRun(tx, "digest", tenantId, weekStart);
  });
};

/**
 * The digest.batch job: emails one page of members (confirmed email, digest email on) and queues the next page. Not
 * limited by the plan: the digest is included for every institution. Messages are deduped per member and week.
 */
export const sendDigestBatch: JobHandler<"digest.batch"> = async (ctx, { tenantId, weekStart, afterMembershipId }) => {
  if (!ctx.messageSenders.EMAIL || !ctx.config.webAppUrl) return;
  if (!(await findDigest(ctx.db, tenantId, weekStart))) return;
  const page = await digestRecipientsPage(ctx.db, tenantId, afterMembershipId ?? null, DIGEST_PAGE);
  await runInTransaction(ctx, async (tx) => {
    await queueMessages(
      ctx,
      page
        .filter((m) => resolveNotificationPrefs(m.prefs).digestEmail)
        .map((m) => ({
          type: "DIGEST" as const,
          tenantId,
          to: { email: m.email, name: m.fullName, userId: m.userId },
          payload: { tenantId, weekStart, membershipId: m.id },
          channels: ["EMAIL"] as ["EMAIL"],
          dedupeKey: `digest-${m.id}-${weekStart}`,
          context: { type: "digest", id: `${tenantId}:${weekStart}` },
        })),
      tx,
    );
    if (page.length === DIGEST_PAGE) {
      const last = page[page.length - 1]!.id;
      await ctx.jobs.enqueue("digest.batch", { tenantId, weekStart, afterMembershipId: last }, { jobId: `dig-batch-${tenantId}-${weekStart}-${last}` });
    }
  });
};

/** A digest's details as members see them (what was removed since is left out). */
export async function digestToDto(ctx: AppContext, row: DigestRow): Promise<DigestDto> {
  const d = await digestDetails(ctx.db, row.tenantId, row.content);
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  return {
    weekStart: row.weekStart,
    createdAt: row.createdAt.toISOString(),
    posts: d.posts.map((p) => ({ id: p.id, excerpt: flat(p.body).slice(0, 200), authorName: p.authorName, reactionCount: p.reactionCount, commentCount: p.commentCount })),
    jobs: d.jobs,
    events: d.events.map((e) => ({ ...e, startAt: e.startAt.toISOString() })),
    newMembers: row.content.newMembers,
  };
}

export async function getLatestDigest(ctx: AppContext, tenantId: string): Promise<DigestDto | null> {
  const row = await latestDigest(ctx.db, tenantId);
  return row ? digestToDto(ctx, row) : null;
}
