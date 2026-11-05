import { CHAT_REPORT_TARGET_KIND_LABELS, EMAIL_VERIFICATION_TTL_SECONDS, REPORT_REASON_LABELS, jobPlaceLabel, type MessageChannel } from "@illuminize/shared";
import type { AppContext } from "../../context";
import { findChatReport, listStaffWhoMayTake, releaseStaffAlert } from "../../repositories/chatReports.repo";
import { findEmailVerification } from "../../repositories/emailVerifications.repo";
import { findInvitationById } from "../../repositories/invitations.repo";
import { findMembershipById, findMembershipByIdUnscoped } from "../../repositories/memberships.repo";
import { findNotificationPrefs } from "../../repositories/notifications.repo";
import { findPostById } from "../../repositories/posts.repo";
import { digestDetails, findDigest } from "../../repositories/digest.repo";
import { findTenantById } from "../../repositories/tenants.repo";
import { findUserById } from "../../repositories/users.repo";
import { unsubscribeLinks } from "../../lib/unsubscribe";
import { resolveNotificationPrefs } from "@illuminize/shared";
import { emailButton, emailLayout, escapeHtml, textToHtml } from "./emailLayout";
import type { RenderedMessage, WhatsAppTemplateSpec } from "./types";

/**
 * Message types and their parameters. Payloads are stored in outbound_messages.payload, so keep them to ids and the
 * values a template needs; list anything sensitive (a confirmation link) in the template's `secretKeys`.
 */
export interface MessagePayloads {
  /** Staff check that WhatsApp, SMS and email are configured (POST /platform/messages/test). */
  PLATFORM_TEST: { sentBy: string; recipientName?: string | null };
  /** Confirms a member's email address. */
  EMAIL_VERIFY: { verificationId: string; link: string };
  /** An admin's announcement, sent by email/WhatsApp/SMS when the admin chose to (and the plan allows). */
  ANNOUNCEMENT: { postId: string; membershipId: string; tenantName: string; color: string; excerpt: string; link: string; path: string };
  /** The weekly digest email; the content is read from the stored digest when it is sent. */
  DIGEST: { tenantId: string; weekStart: string; membershipId: string };
  /** An invitation to join an institution (from an admin's import). */
  INVITE: { invitationId: string; tenantName: string; color: string; recipientName: string | null; link: string; token: string };
  /** Tells a member of Illuminize staff that a chat report has become theirs. Ids only: the load step reads the rest. */
  STAFF_CHAT_REPORT: { chatReportId: string; tenantId: string };
}
export type MessageType = keyof MessagePayloads;

/**
 * What a template renders from when it has a `load` step that turns the stored ids into content (keyed by type).
 * Types without an entry render from their stored payload.
 */
export interface LoadedPayloads {
  ANNOUNCEMENT: MessagePayloads["ANNOUNCEMENT"] & { unsubscribePage: string; unsubscribeHeaders: Record<string, string> };
  DIGEST: {
    tenantName: string;
    color: string;
    appLink: string;
    posts: Array<{ excerpt: string; authorName: string; link: string; reactions: number; comments: number }>;
    jobs: Array<{ title: string; meta: string; link: string }>;
    events: Array<{ title: string; meta: string; link: string }>;
    newMembers: number;
    unsubscribePage: string;
    unsubscribeHeaders: Record<string, string>;
  };
  /** Labels and fixed sentences only: never a name, the reporter's details or anything anyone wrote. */
  STAFF_CHAT_REPORT: { tenantName: string; reason: string; kind: string; basis: string; link: string | null };
}
export type RenderPayload<T extends MessageType> = T extends keyof LoadedPayloads ? LoadedPayloads[T] : MessagePayloads[T];

export interface LoadContext {
  messageId: string;
  tenantId: string | null;
  recipientUserId: string | null;
}

/** A load step either supplies what to render (and optionally a fresher recipient address) or cancels the message. */
export type LoadResult<T extends MessageType> =
  | { payload: RenderPayload<T>; to?: { phone?: string | null; email?: string | null; name?: string | null } }
  | { cancel: string };

export interface RenderedEmail {
  subject: string;
  text: string;
  html?: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

export interface MessageTemplate<T extends MessageType> {
  /** Default channel order; the first that works delivers the message. */
  channels: readonly MessageChannel[];
  /**
   * Queue priority, 1 = most urgent. Transactional messages (confirmations) stay fast while bulk sends (digest,
   * announcements) wait behind them.
   */
  priority: number;
  /** Bulk sends can sit in the queue for a while, so the stale-message sweeper waits longer before re-queueing them. */
  bulk?: boolean;
  /** Payload keys removed from the stored row once the message is final (sent, failed or cancelled). */
  secretKeys?: ReadonlyArray<keyof MessagePayloads[T] & string>;
  /**
   * Runs just before sending: resolves ids into content and re-checks that the message still applies (consent,
   * a verified address, content not removed). Throwing retries the message later.
   */
  load?: (ctx: AppContext, payload: MessagePayloads[T], message: LoadContext) => Promise<LoadResult<T>>;
  /**
   * WhatsApp: an approved template in the WhatsApp Business account. `configured` is the template named for this type
   * in WHATSAPP_TEMPLATES; return null to skip WhatsApp (e.g. none configured).
   */
  whatsapp?: (p: RenderPayload<T>, configured: { name: string; language: string } | undefined) => WhatsAppTemplateSpec | null;
  /** SMS: MSG91 flow variables; the flow template id comes from MSG91_FLOW_TEMPLATE_IDS (DLT-registered text). */
  sms?: (p: RenderPayload<T>) => Record<string, string>;
  email?: (p: RenderPayload<T>) => RenderedEmail;
}

const VERIFY_HOURS = Math.round(EMAIL_VERIFICATION_TTL_SECONDS / 3600);

/** Whether this membership belongs to a member of Illuminize staff. */
async function isStaffMembership(ctx: AppContext, tenantId: string, membershipId: string | null): Promise<boolean> {
  const membership = membershipId ? await findMembershipById(ctx.db, tenantId, membershipId) : undefined;
  return !!membership && !!(await findUserById(ctx.db, membership.userId))?.isPlatformAdmin;
}

export const messageTemplates: { [T in MessageType]: MessageTemplate<T> } = {
  PLATFORM_TEST: {
    channels: ["WHATSAPP", "SMS", "EMAIL"],
    priority: 1,
    // Meta's sample template, available on every WhatsApp Business account.
    whatsapp: () => ({ name: "hello_world", language: "en_US", components: [] }),
    sms: (p) => ({ name: p.recipientName ?? "there" }),
    email: (p) => {
      const text = `Hello ${p.recipientName ?? "there"},\n\nThis is a test message from Illuminize, sent by ${p.sentBy}. If you received it, email delivery is working.\n`;
      return { subject: "Illuminize test message", text, html: `<p>${escapeHtml(text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` };
    },
  },

  EMAIL_VERIFY: {
    channels: ["EMAIL"],
    priority: 1,
    secretKeys: ["link"],
    // A newer request (or a confirmed address) makes an older link useless; don't send it.
    load: async (ctx, p) => {
      const v = await findEmailVerification(ctx.db, p.verificationId);
      if (!v || v.consumedAt || v.expiresAt.getTime() <= Date.now()) return { cancel: "confirmation no longer pending" };
      return { payload: p };
    },
    // No member-supplied text (names, institution names) in this email: anyone can request it for any address.
    email: (p) => {
      const text = [
        "Someone asked to use this email address for an Illuminize account.",
        `To confirm it, open this link within ${VERIFY_HOURS} hours:\n${p.link}`,
        "If this wasn't you, ignore this email and the address won't be used.",
      ].join("\n\n");
      const html = emailLayout({
        title: "Confirm your email address",
        preheader: "Confirm this address for your Illuminize account",
        bodyHtml: [
          textToHtml("Someone asked to use this email address for an Illuminize account."),
          emailButton(p.link, "Confirm email address"),
          textToHtml(`The link works for ${VERIFY_HOURS} hours. If this wasn't you, ignore this email and the address won't be used.`),
        ].join(""),
      });
      return { subject: "Confirm your email address", text, html };
    },
  },

  ANNOUNCEMENT: {
    channels: ["EMAIL", "WHATSAPP", "SMS"],
    priority: 10,
    bulk: true,
    // Re-checked at send time: the post still up, the member still in and still wanting these, the current email.
    load: async (ctx, p) => {
      const m = await findMembershipByIdUnscoped(ctx.db, p.membershipId);
      if (!m || m.status !== "APPROVED") return { cancel: "no longer a member" };
      const [post, prefs, user] = await Promise.all([findPostById(ctx.db, m.tenantId, p.postId), findNotificationPrefs(ctx.db, m.id), findUserById(ctx.db, m.userId)]);
      if (!post || post.moderationStatus !== "APPROVED") return { cancel: "announcement removed" };
      if (!resolveNotificationPrefs(prefs).announcementMessages) return { cancel: "unsubscribed from announcement messages" };
      const links = unsubscribeLinks(ctx.config, m.id, "announcements");
      return { payload: { ...p, unsubscribePage: links.page, unsubscribeHeaders: links.headers }, to: { email: user?.email ?? null } };
    },
    // Template body: "{{1}}: {{2}}" (institution, announcement) with a URL button whose base is <WEB_APP_URL>/ and
    // whose variable part is the path to the post.
    whatsapp: (p, configured) =>
      configured
        ? {
            name: configured.name,
            language: configured.language,
            components: [
              { type: "body", parameters: [{ type: "text", text: p.tenantName }, { type: "text", text: p.excerpt.slice(0, 600) }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: p.path }] },
            ],
          }
        : null,
    sms: (p) => ({ institution: p.tenantName, message: p.excerpt.slice(0, 100), link: p.link }),
    email: (p) => {
      const text = [p.excerpt, `Read it and reply on Illuminize: ${p.link}`, `You get announcement emails from ${p.tenantName} as a member. To stop them: ${p.unsubscribePage}`].join("\n\n");
      const html = emailLayout({
        title: `Announcement from ${p.tenantName}`,
        color: p.color,
        preheader: p.excerpt.slice(0, 120),
        bodyHtml: [textToHtml(p.excerpt), emailButton(p.link, "Read and reply", p.color)].join(""),
        footerHtml: `You get announcement emails from ${escapeHtml(p.tenantName)} as a member. <a href="${escapeHtml(p.unsubscribePage)}" style="color:#64748b">Unsubscribe from announcement emails</a>.`,
      });
      const subject = `${p.tenantName}: ${p.excerpt.length > 70 ? `${p.excerpt.slice(0, 67)}…` : p.excerpt}`;
      return { subject, text, html, headers: p.unsubscribeHeaders };
    },
  },

  DIGEST: {
    channels: ["EMAIL"],
    priority: 20,
    bulk: true,
    load: async (ctx, p) => {
      const [m, digest, tenant] = await Promise.all([findMembershipByIdUnscoped(ctx.db, p.membershipId), findDigest(ctx.db, p.tenantId, p.weekStart), findTenantById(ctx.db, p.tenantId)]);
      if (!m || m.status !== "APPROVED" || !digest || !tenant || !ctx.config.webAppUrl) return { cancel: "digest no longer applies" };
      const [prefs, user, d] = await Promise.all([findNotificationPrefs(ctx.db, m.id), findUserById(ctx.db, m.userId), digestDetails(ctx.db, p.tenantId, digest.content)]);
      if (!resolveNotificationPrefs(prefs).digestEmail) return { cancel: "unsubscribed from the digest" };
      if (!user?.email) return { cancel: "no confirmed email" };
      if (d.posts.length + d.jobs.length + d.events.length === 0) return { cancel: "nothing left to show" };
      const app = `${ctx.config.webAppUrl}/t/${tenant.slug}/app`;
      const links = unsubscribeLinks(ctx.config, m.id, "digest");
      const when = (at: Date, tz: string) => at.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
      return {
        to: { email: user.email },
        payload: {
          tenantName: tenant.name,
          color: tenant.primaryColor,
          appLink: `${app}/digest`,
          posts: d.posts.map((x) => ({ excerpt: x.body.replace(/\s+/g, " ").trim().slice(0, 160), authorName: x.authorName, link: `${app}/feed/${x.id}`, reactions: x.reactionCount, comments: x.commentCount })),
          jobs: d.jobs.map((x) => ({ title: x.title, meta: [x.companyName, jobPlaceLabel(x)].filter(Boolean).join(" · "), link: `${app}/jobs/${x.id}` })),
          events: d.events.map((x) => ({ title: x.title, meta: `${when(x.startAt, x.timezone)} · ${x.city}`, link: `${app}/events/${x.id}` })),
          newMembers: digest.content.newMembers,
          unsubscribePage: links.page,
          unsubscribeHeaders: links.headers,
        },
      };
    },
    email: (p) => {
      const section = (title: string, items: string[]) => (items.length ? `<h2 style="margin:20px 0 8px;font-size:16px">${escapeHtml(title)}</h2><ul style="margin:0;padding-left:18px">${items.join("")}</ul>` : "");
      const li = (href: string, text: string, meta: string) =>
        `<li style="margin:0 0 10px"><a href="${escapeHtml(href)}" style="color:${escapeHtml(p.color)};text-decoration:none;font-weight:600">${escapeHtml(text)}</a>${meta ? `<br><span style="color:#64748b;font-size:13px">${escapeHtml(meta)}</span>` : ""}</li>`;
      const html = emailLayout({
        title: `This week at ${p.tenantName}`,
        color: p.color,
        preheader: [p.posts.length && `${p.posts.length} popular posts`, p.jobs.length && `${p.jobs.length} new jobs`, p.events.length && `${p.events.length} upcoming events`].filter(Boolean).join(", "),
        bodyHtml: [
          section("Popular posts", p.posts.map((x) => li(x.link, x.excerpt, `${x.authorName} · ${x.reactions} reactions · ${x.comments} comments`))),
          section("New jobs", p.jobs.map((x) => li(x.link, x.title, x.meta))),
          section("Coming up", p.events.map((x) => li(x.link, x.title, x.meta))),
          p.newMembers ? textToHtml(`${p.newMembers} new member${p.newMembers === 1 ? "" : "s"} joined this week.`) : "",
          emailButton(p.appLink, `Open ${p.tenantName}`, p.color),
        ].join(""),
        footerHtml: `You get this weekly digest as a member of ${escapeHtml(p.tenantName)}. <a href="${escapeHtml(p.unsubscribePage)}" style="color:#64748b">Unsubscribe from the digest</a>.`,
      });
      const lines = [
        `This week at ${p.tenantName}`,
        ...(p.posts.length ? ["", "Popular posts:", ...p.posts.map((x) => `- ${x.excerpt} (${x.authorName}) ${x.link}`)] : []),
        ...(p.jobs.length ? ["", "New jobs:", ...p.jobs.map((x) => `- ${x.title}, ${x.meta} ${x.link}`)] : []),
        ...(p.events.length ? ["", "Coming up:", ...p.events.map((x) => `- ${x.title}, ${x.meta} ${x.link}`)] : []),
        ...(p.newMembers ? ["", `${p.newMembers} new member(s) joined this week.`] : []),
        "",
        `Unsubscribe from the digest: ${p.unsubscribePage}`,
      ];
      return { subject: `This week at ${p.tenantName}`, text: lines.join("\n"), html, headers: p.unsubscribeHeaders };
    },
  },
  INVITE: {
    channels: ["WHATSAPP", "SMS", "EMAIL"],
    priority: 5,
    bulk: true,
    // Revoked, accepted or expired since it was queued: don't send.
    load: async (ctx, p) => {
      const inv = await findInvitationById(ctx.db, p.invitationId);
      if (!inv || (inv.status !== "PENDING" && inv.status !== "SENT") || inv.expiresAt.getTime() <= Date.now()) return { cancel: "invitation no longer open" };
      return { payload: p };
    },
    // Template body: "Hi {{1}}, you're invited to join the {{2}} alumni network on Illuminize." with a URL button
    // whose base is <WEB_APP_URL>/i/ and whose variable part is the token.
    whatsapp: (p, configured) =>
      configured
        ? {
            name: configured.name,
            language: configured.language,
            components: [
              { type: "body", parameters: [{ type: "text", text: p.recipientName ?? "there" }, { type: "text", text: p.tenantName }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: p.token }] },
            ],
          }
        : null,
    sms: (p) => ({ name: p.recipientName ?? "there", institution: p.tenantName, link: p.link }),
    email: (p) => {
      const greeting = `Hello ${p.recipientName ?? "there"},`;
      const intro = `You're invited to join the ${p.tenantName} alumni network on Illuminize: find batchmates, jobs, events and more.`;
      const text = [greeting, intro, `Join here: ${p.link}`, "Sign in with this phone number to accept the invitation."].join("\n\n");
      const html = emailLayout({
        title: `Join ${p.tenantName} on Illuminize`,
        color: p.color,
        preheader: intro,
        bodyHtml: [textToHtml(`${greeting}\n\n${intro}`), emailButton(p.link, `Join ${p.tenantName}`, p.color), textToHtml("Sign in with the phone number this invitation was sent to and you'll be taken straight in.")].join(""),
        footerHtml: `You received this because ${escapeHtml(p.tenantName)} invited you. If you don't want to join, you can ignore this email.`,
      });
      return { subject: `You're invited to join ${p.tenantName} on Illuminize`, text, html };
    },
  },

  STAFF_CHAT_REPORT: {
    channels: ["EMAIL", "WHATSAPP", "SMS"],
    priority: 2,
    // Re-checked at send time: the recipient still staff, and the report still open, still escalated, not naming them and
    // not left to another member of staff by them.
    load: async (ctx, p, message) => {
      const user = message.recipientUserId ? await findUserById(ctx.db, message.recipientUserId) : undefined;
      if (!user?.isPlatformAdmin) return { cancel: "no longer Illuminize staff" };
      const found = await findChatReport(ctx.db, p.tenantId, p.chatReportId, user.id);
      if (!found || found.report.status !== "OPEN") return { cancel: "report closed" };
      if (found.named) return { cancel: "the report names the recipient" };
      if (!found.escalated) {
        // Its admins can handle it again. Should it become staff's later, the sweep claims it and alerts them then.
        await releaseStaffAlert(ctx.db, p.tenantId, p.chatReportId);
        return { cancel: "report no longer for staff" };
      }
      if (found.rosterChangedByViewer) {
        // They changed its admins since it was queued. With nobody left who may take it, the sweep alerts whoever may next.
        if (!(await listStaffWhoMayTake(ctx.db, p.chatReportId)).length) await releaseStaffAlert(ctx.db, p.tenantId, p.chatReportId);
        return { cancel: "another member of staff must handle it" };
      }
      const tenant = await findTenantById(ctx.db, p.tenantId);
      if (!tenant) return { cancel: "institution gone" };
      // A reported admin who is also staff isn't held back (assertNoOpenReportAboutActor), so the alert doesn't say so.
      const heldBack = found.reportedIsAdmin && !(await isStaffMembership(ctx, p.tenantId, found.report.reportedMembershipId));
      return {
        to: { email: user.email, phone: user.phoneE164 },
        payload: {
          tenantName: tenant.name,
          reason: REPORT_REASON_LABELS[found.report.reason],
          kind: CHAT_REPORT_TARGET_KIND_LABELS[found.report.targetKind],
          basis: heldBack
            ? "It's about one of the institution's admins, who can't suspend anyone or change roles until it's closed."
            : found.reportedIsAdmin
              ? "It's about one of the institution's admins."
              : "No other admin there can handle it.",
          link: ctx.config.webAppUrl ? `${ctx.config.webAppUrl}/platform/chat-reports` : null,
        },
      };
    },
    // Template body: "A chat report at {{1}} needs Illuminize staff ({{2}}). Open Chat reports in the platform console."
    whatsapp: (p, configured) =>
      configured ? { name: configured.name, language: configured.language, components: [{ type: "body", parameters: [{ type: "text", text: p.tenantName }, { type: "text", text: p.reason }] }] } : null,
    sms: (p) => ({ institution: p.tenantName, reason: p.reason, link: p.link ?? "" }),
    email: (p) => {
      const intro = `A chat report at ${p.tenantName} needs Illuminize staff.`;
      const facts = `Reason: ${p.reason}. Reported: ${p.kind}.`;
      const open = p.link ? `Open Chat reports in the platform console: ${p.link}` : "Open Chat reports in the platform console.";
      const privacy = "This email names nobody and quotes nothing. Each view of the messages is recorded in the institution's audit log.";
      const html = emailLayout({
        title: "A chat report needs staff",
        preheader: `${p.tenantName}: ${p.reason}`,
        bodyHtml: [textToHtml([intro, facts, p.basis].join("\n\n")), p.link ? emailButton(p.link, "Open Chat reports") : textToHtml(open), textToHtml(privacy)].join(""),
        footerHtml: "You get these as Illuminize staff.",
      });
      return { subject: `A chat report at ${p.tenantName} needs staff`, text: [intro, facts, p.basis, open, privacy].join("\n\n"), html };
    },
  },
};

export function isMessageType(type: string): type is MessageType {
  return Object.prototype.hasOwnProperty.call(messageTemplates, type);
}

/** Message types whose template marks them as bulk sends. */
export const BULK_MESSAGE_TYPES: MessageType[] = (Object.keys(messageTemplates) as MessageType[]).filter((t) => messageTemplates[t].bulk);

/**
 * Renders one message for one channel, or returns why it cannot go that way (no address for the channel, no template
 * for it, or no MSG91 flow id configured).
 */
export interface TemplateConfig {
  msg91FlowTemplateIds: Record<string, string>;
  whatsappTemplates: Record<string, { name: string; language: string }>;
}

export function renderForChannel(
  type: MessageType,
  channel: MessageChannel,
  payload: unknown,
  to: { phone: string | null; email: string | null; name: string | null },
  config: TemplateConfig,
): { message: RenderedMessage } | { skip: string } {
  const template = messageTemplates[type] as unknown as MessageTemplate<MessageType>;
  const p = payload as never;
  switch (channel) {
    case "WHATSAPP": {
      if (!to.phone) return { skip: "no phone number" };
      if (!template.whatsapp) return { skip: "no WhatsApp template" };
      const spec = template.whatsapp(p, config.whatsappTemplates[type]);
      if (!spec) return { skip: `no WhatsApp template configured for ${type} (WHATSAPP_TEMPLATES)` };
      return { message: { channel, to: to.phone, template: spec } };
    }
    case "SMS": {
      if (!to.phone) return { skip: "no phone number" };
      if (!template.sms) return { skip: "no SMS template" };
      const flowTemplateId = config.msg91FlowTemplateIds[type];
      if (!flowTemplateId) return { skip: `no MSG91 flow template id for ${type}` };
      return { message: { channel, to: to.phone, flowTemplateId, vars: template.sms(p) } };
    }
    case "EMAIL":
      if (!to.email) return { skip: "no email address" };
      if (!template.email) return { skip: "no email template" };
      return { message: { channel, to: to.email, toName: to.name, ...template.email(p) } };
  }
}
