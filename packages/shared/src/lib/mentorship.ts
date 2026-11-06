import {
  MENTOR_AREA_LABELS,
  MENTOR_AVAILABILITY_LABELS,
  MENTORSHIP_MAX_REQUESTS_PER_PAIR,
  MENTORSHIP_REQUEST_WINDOW_DAYS,
  PROFESSION_TYPE_LABELS,
  type MentorArea,
  type MentorAvailability,
  type MentorshipBox,
} from "../constants";
import type { MemberCardDto, MentorCardDto, MentorProfileDto, MentorshipDto } from "../types/dto";

/** How a mentorship's status reads, in the same words on both apps. Withdrawn and ended share a status and differ in whether it was ever accepted. */
export function mentorshipStatusLabel(m: Pick<MentorshipDto, "box" | "status" | "acceptedAt">): string {
  switch (m.status) {
    case "REQUESTED":
      return m.box === "received" ? "Waiting for your answer" : "Request sent";
    case "ACCEPTED":
      return "Active";
    case "DECLINED":
      return "Declined";
    case "ENDED":
      return m.acceptedAt ? "Ended" : "Withdrawn";
  }
}

/**
 * When a mentorship was asked for, and when it last changed, with the caller's own date format. A request the mentor never
 * saw reads like any other still waiting, because it is REQUESTED like one.
 */
export function mentorshipWhen(m: Pick<MentorshipDto, "status" | "createdAt" | "respondedAt" | "acceptedAt" | "endedAt" | "endedByMe">, date: (iso: string) => string): string {
  const asked = `Asked ${date(m.createdAt)}`;
  switch (m.status) {
    case "REQUESTED":
      return asked;
    case "ACCEPTED":
      return m.acceptedAt ? `${asked} · accepted ${date(m.acceptedAt)}` : asked;
    case "DECLINED":
      return m.respondedAt ? `${asked} · declined ${date(m.respondedAt)}` : asked;
    case "ENDED":
      if (!m.endedAt) return asked;
      return m.acceptedAt ? `${asked} · ended ${date(m.endedAt)}${m.endedByMe ? " by you" : ""}` : `${asked} · withdrawn ${date(m.endedAt)}`;
  }
}

/** The Mentors section's tabs, kept in the URL as `?tab=` on both apps. Find mentors is the default and needs none. */
export const MENTORS_TABS = ["find", "requests", "be-a-mentor"] as const;
export type MentorsTab = (typeof MENTORS_TABS)[number];
export const MENTORS_TAB_LABELS: Record<MentorsTab, string> = { find: "Find mentors", requests: "Requests", "be-a-mentor": "Be a mentor" };
/** The two lists on Requests, kept in the URL as `?box=`. */
export const MENTORSHIP_BOX_LABELS: Record<MentorshipBox, string> = { received: "Received", sent: "Sent" };

/** The tab a URL asks for. Anything unknown, or nothing, is Find mentors. */
export const mentorsTabFrom = (value: unknown): MentorsTab => (MENTORS_TABS.find((t) => t === value) ?? "find");
/** The list a URL asks for on Requests. Anything but `sent` is the received list, where answers are waited for. */
export const mentorshipBoxFrom = (value: unknown): MentorshipBox => (value === "sent" ? "sent" : "received");

/**
 * The query string for a tab of the Mentors section, and on Requests for one of its lists: the same shape the mentorship
 * notifications link to, so a link, a reload and a push all land in the same place.
 */
export function mentorsQuery(tab: MentorsTab = "find", box?: MentorshipBox): string {
  if (tab === "find") return "";
  return `?tab=${tab}${tab === "requests" && box ? `&box=${box}` : ""}`;
}

/** What to filter the Mentors list by. Empty filters are left out, so they share a cache entry with none. */
export interface MentorFilters {
  q?: string;
  area?: MentorArea;
  availability?: MentorAvailability;
}

/** Query keys for mentorship, with the slug second like every other tenant key, so a tenant-wide invalidation reaches them. */
export const mentorshipKeys = {
  all: (slug: string) => ["mentorship", slug] as const,
  /** This member's own mentor profile. */
  me: (slug: string) => ["mentorship", slug, "me"] as const,
  /** Whether they still have anything in mentorship, for the way in while they can't use it. */
  summary: (slug: string) => ["mentorship", slug, "summary"] as const,
  mentors: (slug: string, filters: MentorFilters = {}) => ["mentorship", slug, "mentors", filters] as const,
  mentor: (slug: string, membershipId: string) => ["mentorship", slug, "mentor", membershipId] as const,
  requests: (slug: string, box: MentorshipBox) => ["mentorship", slug, "requests", box] as const,
};

/** What a member does, as mentor cards and requests say it: their title, or else their profession, and where. */
export function memberRoleLine(m: Pick<MemberCardDto, "designation" | "professionType" | "companyName">): string {
  const role = m.designation ?? PROFESSION_TYPE_LABELS[m.professionType];
  return m.companyName ? `${role} at ${m.companyName}` : role;
}

/** How often a mentor can meet, with what they added about when. */
export function mentorAvailabilityText(p: { availability: MentorAvailability; availabilityNote?: string | null }): string {
  const label = MENTOR_AVAILABILITY_LABELS[p.availability];
  return p.availabilityNote ? `${label}. ${p.availabilityNote}` : label;
}

/**
 * A mentor card's accessible name, the same on both apps: everything the card shows, because on a phone the whole card is
 * the link and its name stands in for what's inside it. It starts with the name, which is the link's visible text.
 */
export function mentorCardLabel(mentor: Pick<MentorCardDto, "member" | "areas" | "availability">): string {
  const { member } = mentor;
  const batch = `Batch of ${member.batchYear}${member.city ? ` · ${member.city}` : ""}`;
  const areas = mentor.areas.map((a) => MENTOR_AREA_LABELS[a]).join(", ");
  return [member.fullName, memberRoleLine(member), batch, areas, `Availability: ${MENTOR_AVAILABILITY_LABELS[mentor.availability]}`].join(", ");
}

/** What the filters on Find mentors say when they filter nothing out, the same on both apps. */
export const MENTOR_FILTER_ANY = { area: "All areas", availability: "Any availability" } as const;

/**
 * Said beside the note on the request form, before anything is sent. A pair who already chat keep their chat, which the
 * note joins as its latest message.
 */
export const mentorshipNoteHelp = (mentorName: string) => `${mentorName} will see this note. If they accept, it becomes the first message of a chat between you, or the latest one if you already chat.`;

/**
 * Said before a received request's note is reported. Admins see the note alone. A request still waiting is declined, which
 * its sender sees as a decline, though they aren't told it was reported; one already closed stays as it is.
 */
export const mentorshipReportHelp = (menteeName: string, waiting: boolean) =>
  `Admins will see only the note in this request, and nothing else. ${waiting ? `The request is declined: ${menteeName} will see it as declined, but won't be told it was reported.` : `${menteeName} won't be told it was reported.`}`;

/** What stopping does, said on Be a mentor beside the button and again before it's done. */
export const STOP_MENTORING_EXPLAINED = "You'll leave the Mentors list, and requests waiting for you will be declined. Mentorships already under way carry on, and you can end them from Requests.";

/** What each way out of a request or a mentorship does, said before it's done, the same on both apps. */
export const MENTORSHIP_CONFIRM = {
  withdraw: {
    title: "Withdraw this request?",
    body: (mentorName: string) =>
      `${mentorName} can't accept it any more, but can still see your note, marked as withdrawn. It still counts towards the ${MENTORSHIP_MAX_REQUESTS_PER_PAIR} requests you can send one mentor in ${MENTORSHIP_REQUEST_WINDOW_DAYS} days.`,
    confirm: "Withdraw request",
  },
  decline: {
    title: "Decline this request?",
    body: (menteeName: string) => `${menteeName} will be told that you declined.`,
    confirm: "Decline request",
  },
  end: {
    title: "End this mentorship?",
    body: (otherName: string) => `${otherName} will be told that it has ended. If your chat began with this mentorship, it closes, and you can both still read it.`,
    confirm: "End mentorship",
  },
  stop: { title: "Stop mentoring?", body: STOP_MENTORING_EXPLAINED, confirm: "Stop mentoring" },
} as const;

/** An admin taking a member out of the Mentors list, asked first on both consoles. Its note can't be reported, so this is the way to act on it. */
export const MENTOR_REMOVE_CONFIRM = {
  title: "Remove as mentor?",
  body: "They'll no longer appear in Mentors, and requests waiting for them will be declined. Mentorships already under way carry on. They can offer to mentor again, so suspend them if it happens again.",
  confirm: "Remove as mentor",
  done: "Removed as a mentor",
} as const;

/** Whether a member's mentor profile puts them in the Mentors list, as their admin page says it. */
export const mentorListedText = (isActive: boolean) => (isActive ? "Listed in Mentors" : "Not listed in Mentors");

/** A mentor profile as a member's admin page lists it: what they offer, when, and their note in their own words. */
export function mentorProfileRows(p: Pick<MentorProfileDto, "areas" | "availability" | "availabilityNote" | "note">): Array<{ label: string; value: string }> {
  return [
    { label: "Areas", value: p.areas.map((a) => MENTOR_AREA_LABELS[a]).join(", ") || "—" },
    { label: "Availability", value: mentorAvailabilityText(p) },
    { label: "Note", value: p.note ?? "—" },
  ];
}
