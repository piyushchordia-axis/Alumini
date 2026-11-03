import type { MentorshipStatus } from "@illuminize/shared";
import { AppError } from "../../lib/errors";

export type MentorshipAction = "accept" | "decline" | "withdraw" | "end";
export type MentorshipSide = "MENTOR" | "MENTEE";

/** Who may move a mentorship from where to where. Nothing leaves DECLINED or ENDED: asking again is a new request. */
const TRANSITIONS: Record<MentorshipAction, { from: MentorshipStatus; to: MentorshipStatus; by: readonly MentorshipSide[] }> = {
  accept: { from: "REQUESTED", to: "ACCEPTED", by: ["MENTOR"] },
  decline: { from: "REQUESTED", to: "DECLINED", by: ["MENTOR"] },
  withdraw: { from: "REQUESTED", to: "ENDED", by: ["MENTEE"] },
  end: { from: "ACCEPTED", to: "ENDED", by: ["MENTOR", "MENTEE"] },
};

export function canTransitionMentorship(from: MentorshipStatus, action: MentorshipAction, side: MentorshipSide): boolean {
  const t = TRANSITIONS[action];
  return t.from === from && t.by.includes(side);
}

/** The status `action` leads to, or a 409 that says why it can't happen now. Callers check the side first, because the wrong one gets a 404. */
export function transitionMentorship(from: MentorshipStatus, action: MentorshipAction, side: MentorshipSide): MentorshipStatus {
  const t = TRANSITIONS[action];
  if (!t.by.includes(side)) throw AppError.invalidTransition(`The ${side === "MENTOR" ? "mentor" : "mentee"} can't ${action} this`);
  if (t.from !== from) throw AppError.invalidTransition(from === "REQUESTED" ? "This request hasn't been answered yet" : from === "ACCEPTED" ? "This request has already been accepted" : "This request is already closed");
  return t.to;
}
