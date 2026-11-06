import { MESSAGE_CHANNELS, MESSAGE_CHANNEL_LABELS, channelName, type MessageChannel } from "../constants";
import type { AnnouncementAudienceDto, PostDto } from "../types/dto";
import { formatCount } from "./admin";

/** The post composer's Announce panel, the same words on both apps. */
export const ANNOUNCEMENT_PIN_LABEL = "Pin to the top of the feed";
export const ANNOUNCEMENT_NO_CHANNELS = "Your plan doesn't include email, WhatsApp or SMS announcements.";
/**
 * Under the channel boxes when the plan offers more than one. The send tries a member's chosen channels in the order
 * the boxes are listed (MESSAGE_CHANNELS) and stops at the first that works, so ticking more adds no messages.
 */
export const ANNOUNCEMENT_ONE_MESSAGE = "If you tick more than one, each member still gets one message: by the first of them, in the order listed, that can be sent.";

function members(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "member" : "members"}`;
}

/** "WhatsApp, SMS or email". */
function orList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** How many members a channel reaches: email needs a confirmed address, and everyone has a phone. */
function reachBy(channel: MessageChannel, audience: AnnouncementAudienceDto): number {
  return channel === "EMAIL" ? audience.withEmail : audience.withPhone;
}

/** Who gets it whatever else is chosen: "Every member (12) gets it in the app and as a push notification." */
export function announcementReachText(audience?: Pick<AnnouncementAudienceDto, "members"> | null): string {
  return `Every member${audience ? ` (${formatCount(audience.members)})` : ""} gets it in the app and as a push notification.`;
}

/** A channel's checkbox: "Also email it (5 members with a confirmed email)", "Also send by WhatsApp (12 members)". */
export function announcementChannelLabel(channel: MessageChannel, audience: AnnouncementAudienceDto): string {
  const reach = members(reachBy(channel, audience));
  return channel === "EMAIL" ? `Also email it (${reach} with a confirmed email)` : `Also send by ${MESSAGE_CHANNEL_LABELS[channel]} (${reach})`;
}

/**
 * The confirmation before an announcement also goes by email, WhatsApp or SMS, which the institution pays for. Each
 * member gets one message at most: announcements.service gives every member one message with the chosen channels as a
 * chain, in MESSAGE_CHANNELS order, and the sender moves to the next only when one can't be sent. So this says how many
 * members that reaches (as far as the composer knows) and the order, never a count per channel. Null when none is
 * chosen, as nothing is billed then.
 */
export function announcementConfirmCopy(audience: AnnouncementAudienceDto | null | undefined, channels: readonly MessageChannel[]): { title: string; body: string; confirm: string } | null {
  const chosen = MESSAGE_CHANNELS.filter((c) => channels.includes(c));
  if (chosen.length === 0) return null;
  const [first, ...rest] = chosen.map(channelName);
  // A phone channel reaches everyone, and email after it only stands in when that fails; email alone, only those with one.
  const reached = audience ? (chosen.some((c) => c !== "EMAIL") ? audience.withPhone : audience.withEmail) : null;
  const goes =
    rest.length === 0
      ? `It goes by ${first}${reached === null ? "" : ` to ${members(reached)}`}.`
      : `It goes to ${reached === null ? "each member once" : `${members(reached)}, ${reached === 1 ? "in one message" : "one message each"}`}: by ${first}, or when that can't be sent, by ${rest.join(", then ")}.`;
  return {
    title: `Send this announcement by ${orList(chosen.map(channelName))}?`,
    body: `${goes} Messages are billed to your institution.`,
    confirm: "Post and send",
  };
}

/** What posting says once it's done. */
export function postCreatedText(post: Pick<PostDto, "kind" | "moderationStatus">): string {
  if (post.kind === "ANNOUNCEMENT") return "Announcement posted; members are being notified";
  return post.moderationStatus === "PENDING" ? "Posted — awaiting admin approval" : "Posted!";
}
