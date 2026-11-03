import type { ReferralStatus } from "@illuminize/shared";
import { AppError } from "../../lib/errors";

export type ReferralAction = "accept" | "decline" | "withdraw" | "close";
/** Who acts: the job's poster, the member who asked, or the job itself stopping taking requests. */
export type ReferralSide = "POSTER" | "REQUESTER" | "JOB";

/** Who may move a request from where to where. Everything starts waiting, and nothing leaves where it ends up: asking again is a new request. */
const TRANSITIONS: Record<ReferralAction, { from: ReferralStatus; to: ReferralStatus; by: readonly ReferralSide[] }> = {
  accept: { from: "REQUESTED", to: "ACCEPTED", by: ["POSTER"] },
  decline: { from: "REQUESTED", to: "DECLINED", by: ["POSTER"] },
  withdraw: { from: "REQUESTED", to: "WITHDRAWN", by: ["REQUESTER"] },
  close: { from: "REQUESTED", to: "CLOSED", by: ["JOB"] },
};

export function canTransitionReferral(from: ReferralStatus, action: ReferralAction, side: ReferralSide): boolean {
  const t = TRANSITIONS[action];
  return t.from === from && t.by.includes(side);
}

const ALREADY: Record<ReferralStatus, string> = {
  REQUESTED: "This request hasn't been answered yet",
  ACCEPTED: "This request has already been accepted",
  DECLINED: "This request was declined",
  WITHDRAWN: "This request was withdrawn",
  CLOSED: "This request was closed",
};

const SIDE: Record<ReferralSide, string> = { POSTER: "poster", REQUESTER: "member who asked", JOB: "job" };

/** The status `action` leads to, or a 409 that says why it can't happen now. Callers check the side first, because the wrong one gets a 404. */
export function transitionReferral(from: ReferralStatus, action: ReferralAction, side: ReferralSide): ReferralStatus {
  const t = TRANSITIONS[action];
  if (!t.by.includes(side)) throw AppError.invalidTransition(`The ${SIDE[side]} can't ${action} this`);
  if (t.from !== from) throw AppError.invalidTransition(ALREADY[from]);
  return t.to;
}
