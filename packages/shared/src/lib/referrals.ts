import { REFERRAL_MAX_REQUESTS_PER_JOB, type ReferralBox, type ReferralStatus } from "../constants";
import type { JobCardDto, ReferralAskRefusal, ReferralDto } from "../types/dto";
import { jobIsOpen } from "./jobs";

/** The Jobs section's tabs, kept in the URL as `?tab=` on both apps. Openings is the default and needs none. */
export const JOBS_TABS = ["openings", "seekers", "referrals"] as const;
export type JobsTab = (typeof JOBS_TABS)[number];
export const JOBS_TAB_LABELS: Record<JobsTab, string> = { openings: "Openings", seekers: "Looking for work", referrals: "Referrals" };
/** The two lists on Referrals, kept in the URL as `?box=`. */
export const REFERRAL_BOX_LABELS: Record<ReferralBox, string> = { received: "Received", sent: "Sent" };

/** The tab a URL asks for. Anything unknown, or nothing, is Openings. */
export const jobsTabFrom = (value: unknown): JobsTab => JOBS_TABS.find((t) => t === value) ?? "openings";
/** The list a URL asks for on Referrals. Anything but `sent` is the received list, where answers are waited for. */
export const referralBoxFrom = (value: unknown): ReferralBox => (value === "sent" ? "sent" : "received");

/**
 * The query string for a tab of the Jobs section, and on Referrals for one of its lists: the same shape the referral
 * notifications link to, so a link, a reload and a push all land in the same place.
 */
export function jobsQuery(tab: JobsTab = "openings", box?: ReferralBox): string {
  if (tab === "openings") return "";
  return `?tab=${tab}${tab === "referrals" && box ? `&box=${box}` : ""}`;
}

/** Query keys for referral requests, with the slug second like every other tenant key, so a tenant-wide invalidation reaches them. */
export const referralKeys = {
  all: (slug: string) => ["referrals", slug] as const,
  /** How many requests wait in each list, for the way in while they can't use referrals. */
  summary: (slug: string) => ["referrals", slug, "summary"] as const,
  /** One of the member's own lists. */
  requests: (slug: string, box: ReferralBox) => ["referrals", slug, "requests", box] as const,
  /** The requests about one of the member's own jobs. */
  job: (slug: string, jobId: string) => ["referrals", slug, "job", jobId] as const,
};

/** How a referral request's status reads, in the same words on both apps. */
export function referralStatusLabel(r: Pick<ReferralDto, "box" | "status">): string {
  switch (r.status) {
    case "REQUESTED":
      return r.box === "received" ? "Waiting for your answer" : "Request sent";
    case "ACCEPTED":
      return "Accepted";
    case "DECLINED":
      return "Declined";
    case "WITHDRAWN":
      return "Withdrawn";
    case "CLOSED":
      return "Closed";
  }
}

/** When a referral was asked for, and when it last changed, with the caller's own date format. */
export function referralWhen(r: Pick<ReferralDto, "status" | "createdAt" | "respondedAt" | "acceptedAt" | "closedAt">, date: (iso: string) => string): string {
  const asked = `Asked ${date(r.createdAt)}`;
  switch (r.status) {
    case "REQUESTED":
      return asked;
    case "ACCEPTED":
      return r.acceptedAt ? `${asked} · accepted ${date(r.acceptedAt)}` : asked;
    case "DECLINED":
      return r.respondedAt ? `${asked} · declined ${date(r.respondedAt)}` : asked;
    case "WITHDRAWN":
      return r.closedAt ? `${asked} · withdrawn ${date(r.closedAt)}` : asked;
    case "CLOSED":
      return r.closedAt ? `${asked} · closed ${date(r.closedAt)}` : asked;
  }
}

/** The job form's checkbox, and what it says beside it, the same on both apps. */
export const CAN_REFER_LABEL = "I can refer people for this job";
export const CAN_REFER_HELP = "Members can ask you for a referral with a short note. If you accept, it opens a private chat between you.";
/** On a job's card and page, and the Openings filter that shows only those jobs. */
export const CAN_REFER_BADGE = "Can refer";

/** Where the request form's note starts out, the same on both apps. */
export const REFERRAL_NOTE_PLACEHOLDER = "Say who you are, why this job suits you, and why you're asking them.";

/**
 * Said by a job's poster before closing it, deleting it or unticking "I can refer", when requests are waiting for their
 * answer: all three close them.
 */
export function waitingReferralsCloseText(waiting: number): string {
  return waiting === 1
    ? "1 referral request is waiting for your answer. It will close, and its sender will be told this job is no longer taking referral requests."
    : `${waiting} referral requests are waiting for your answer. They will close, and each sender will be told this job is no longer taking referral requests.`;
}

/**
 * What a job's page says to a member about their own latest request on it. A request its poster never saw reads as one
 * waiting for an answer, because its status is the same.
 */
export function myReferralText(status: ReferralStatus, posterName: string): string {
  switch (status) {
    case "REQUESTED":
      return `You've asked ${posterName} for a referral. Their answer will show in Referrals.`;
    case "ACCEPTED":
      return `${posterName} accepted your referral request.`;
    case "DECLINED":
      return `${posterName} declined your referral request, so you can't ask again for this job.`;
    case "WITHDRAWN":
      return "You withdrew your referral request.";
    case "CLOSED":
      return "Your referral request closed when this job stopped taking requests.";
  }
}

/**
 * Why a member can't ask for referrals or answer them now, for the screens that keep only the ways out: the institution
 * switched them off (they need jobs and messaging), or the member is a current pupil.
 */
export const referralsOffReason = (institution: string, chatEligible: boolean) =>
  chatEligible ? `${institution} has switched referral requests off.` : "Referral requests aren't open to your account.";

/** Above the Referrals lists while the member can't use referrals, and has requests there still to leave or answer. */
export const referralsWayOutText = (institution: string, chatEligible: boolean) =>
  `${referralsOffReason(institution, chatEligible)} You can't ask for referrals or accept requests, but you can still withdraw your requests, and decline or report requests about your jobs, here.`;

/** Above the requests on the poster's own job while they can't use referrals. */
export const jobReferralsWayOutText = (institution: string, chatEligible: boolean) =>
  `${referralsOffReason(institution, chatEligible)} You can't accept requests now, but you can still decline or report them here.`;

/** Whether a job takes new referral requests now, as the API decides: open (`jobIsOpen`), and offered. */
export function takesReferralRequests(job: Pick<JobCardDto, "canRefer" | "moderationStatus" | "isClosed" | "expiresAt">, now: number): boolean {
  return job.canRefer && jobIsOpen(job, now);
}

/** On someone else's job that takes requests, to a member who hasn't asked yet: what asking does. */
export const referralAskText = (posterName: string) => `${posterName} can refer people for this job. Ask with a short note: if they accept, it opens a private chat between you.`;

/** On the poster's own job, above its requests, while they can use referrals: whether members can still ask, and if not, why. */
export function jobReferralsIntro(job: Pick<JobCardDto, "canRefer" | "moderationStatus" | "isClosed" | "expiresAt">, now: number): string {
  if (!job.canRefer) return "You no longer offer referrals for this job, so members can't ask any more.";
  if (job.isClosed) return "This job is closed, so members can't ask for a referral any more.";
  if (job.moderationStatus !== "APPROVED") return "While this job is in review, members can't ask for a referral. Requests already waiting stay here.";
  if (!takesReferralRequests(job, now)) return "This job is past its closing date, so members can't ask for a referral any more.";
  return "Members who'd like you to refer them ask here, with a short note. Accepting opens a private chat between you, with their note as its first message, or the latest one if you already chat.";
}

/**
 * On someone else's job and its request form, when something of the member's own stands in the way of their asking: said
 * before a note is written rather than when it's sent.
 */
export function referralAskRefusalText(reason: ReferralAskRefusal, posterName: string): { heading: string; body: string } {
  switch (reason) {
    case "LIMIT":
      return { heading: "You can't ask again for this job", body: `You've asked for a referral for this job ${REFERRAL_MAX_REQUESTS_PER_JOB} times, which is as many as you can.` };
    case "YOU_BLOCKED":
      return { heading: "You can't ask for a referral now", body: `You've blocked ${posterName}. To ask them for a referral, unblock them from Blocked members in Messages.` };
  }
}

/** What posting or editing a job says once it's saved, the same on both apps. One held for an admin says so. */
export function jobSavedText(edited: boolean, pending: boolean): string {
  if (pending) return edited ? "Saved — awaiting admin approval" : "Submitted — awaiting admin approval";
  return edited ? "Changes saved" : "Job published";
}
/** What deleting a job says, on the Jobs list it returns to. */
export const JOB_DELETED_TEXT = "Job deleted";

/** On the request form, about a job that doesn't take requests now. */
export const REFERRAL_NOT_TAKING = { heading: "This job isn't taking referral requests", body: "It may have closed, or its poster may have stopped offering referrals." } as const;

/**
 * Said beside the note on the request form, before anything is sent. A pair who already chat keep their chat, which the
 * note joins as its latest message.
 */
export const referralNoteHelp = (posterName: string) => `${posterName} will see this note. If they accept, it becomes the first message of a chat between you, or the latest one if you already chat.`;

/**
 * Said before a received request's note is reported. Admins see the note alone. A request still waiting is declined, which
 * its sender sees as a decline, though they aren't told it was reported; one already closed stays as it is.
 */
export const referralReportHelp = (requesterName: string, waiting: boolean) =>
  `Admins will see only the note in this request, and nothing else. ${waiting ? `The request is declined: ${requesterName} will see it as declined, but won't be told it was reported.` : `${requesterName} won't be told it was reported.`}`;

/** What each way out of a referral request does, said before it's done, the same on both apps. */
export const REFERRAL_CONFIRM = {
  withdraw: {
    title: "Withdraw this request?",
    body: (posterName: string) => `${posterName} can't accept it any more, but can still see your note, marked as withdrawn. It still counts towards the ${REFERRAL_MAX_REQUESTS_PER_JOB} requests you can send about one job.`,
    confirm: "Withdraw request",
  },
  decline: {
    title: "Decline this request?",
    body: (requesterName: string) => `${requesterName} will be told that you declined. They can't ask again about this job.`,
    confirm: "Decline request",
  },
} as const;
