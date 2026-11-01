import { MESSAGE_CHANNELS, resolveNotificationPrefs, type AnnouncementAudienceDto, type MessageChannel } from "@illuminize/shared";
import type { AppContext } from "../context";
import type { JobHandler } from "../jobs/JobQueue";
import { runInTransaction } from "../lib/transaction";
import { audienceCounts, audiencePage, findAnnouncement, updateAnnouncement } from "../repositories/announcements.repo";
import { findPostById } from "../repositories/posts.repo";
import { findTenantById } from "../repositories/tenants.repo";
import { tenantOutboundChannels } from "./billing.service";
import { queueMessages, type QueueMessageInput } from "./messages/message.service";
import { notify } from "./notifications/notification.service";

/** Members per fan-out job (one notification insert and one message batch each). */
export const ANNOUNCEMENT_PAGE = 1000;

export const announcementPath = (slug: string, postId: string) => `t/${slug}/app/feed/${postId}`;

/** Text for notifications and messages: the post's first ~line, trimmed at a word. */
export function announcementExcerpt(body: string, max: number): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
}

export async function getAnnouncementAudience(ctx: AppContext, tenantId: string, excludeMembershipId: string): Promise<AnnouncementAudienceDto> {
  const [counts, channels] = await Promise.all([audienceCounts(ctx.db, tenantId, excludeMembershipId), tenantOutboundChannels(ctx, tenantId)]);
  return { ...counts, channels };
}

/**
 * The announcements.fanout job, one page of members at a time (it queues the next page): an in-app notification for
 * everyone (one realtime broadcast per batch), and, when the admin chose channels, a message to each member who hasn't
 * turned announcement messages off (email only to confirmed addresses). Each page is one transaction; notifications
 * and messages are deduped per member, so a retried page adds nothing. Stops if the post was removed meanwhile.
 */
export const fanoutAnnouncement: JobHandler<"announcements.fanout"> = async (ctx, { tenantId, postId, afterMembershipId }) => {
  const [tenant, ann, post] = await Promise.all([findTenantById(ctx.db, tenantId), findAnnouncement(ctx.db, postId), findPostById(ctx.db, tenantId, postId)]);
  if (!tenant || !ann || !post || post.kind !== "ANNOUNCEMENT" || post.moderationStatus !== "APPROVED" || tenant.status !== "ACTIVE") {
    if (ann) await updateAnnouncement(ctx.db, postId, { fanoutFinishedAt: new Date() });
    return;
  }
  const page = await audiencePage(ctx.db, tenantId, post.authorMembershipId, afterMembershipId ?? null, ANNOUNCEMENT_PAGE);
  // Channels are re-checked against the plan in force now (it may have changed since posting).
  const allowed = await tenantOutboundChannels(ctx, tenantId);
  const channels = MESSAGE_CHANNELS.filter((c) => ann.channels.includes(c) && allowed.includes(c));
  const path = announcementPath(tenant.slug, postId);
  const link = ctx.config.webAppUrl ? `${ctx.config.webAppUrl}/${path}` : null;

  await runInTransaction(ctx, async (tx) => {
    if (!ann.fanoutStartedAt) await updateAnnouncement(tx, postId, { fanoutStartedAt: new Date() });
    await notify(
      ctx,
      {
        tenantId,
        recipientMembershipIds: page.map((m) => m.id),
        type: "ANNOUNCEMENT",
        title: `📣 ${tenant.shortName ?? tenant.name}`,
        body: announcementExcerpt(post.body, 160),
        data: { postId },
        dedupeKey: `ann-${postId}`,
        bulk: true,
      },
      tx,
    );
    let messaged = 0;
    if (channels.length && link) {
      const inputs: Array<QueueMessageInput<"ANNOUNCEMENT">> = [];
      for (const m of page) {
        if (!resolveNotificationPrefs(m.prefs).announcementMessages) continue;
        const chain: MessageChannel[] = channels.filter((c) => c !== "EMAIL" || !!m.email);
        if (chain.length === 0) continue;
        inputs.push({
          type: "ANNOUNCEMENT",
          tenantId,
          to: { phoneE164: m.phone, email: m.email, name: m.fullName, userId: m.userId },
          payload: { postId, membershipId: m.id, tenantName: tenant.name, color: tenant.primaryColor, excerpt: announcementExcerpt(post.body, 1000), link, path },
          channels: chain,
          dedupeKey: `ann-${postId}-${m.id}`,
          context: { type: "announcement", id: postId },
        });
      }
      messaged = (await queueMessages(ctx, inputs, tx)).length;
    }
    const last = page.length === ANNOUNCEMENT_PAGE ? page[page.length - 1]!.id : null;
    await updateAnnouncement(tx, postId, { addNotified: page.length, addMessaged: messaged, ...(last ? {} : { fanoutFinishedAt: new Date() }) });
    if (last) await ctx.jobs.enqueue("announcements.fanout", { tenantId, postId, afterMembershipId: last }, { jobId: `ann-${postId}-${last}` });
  });
};
