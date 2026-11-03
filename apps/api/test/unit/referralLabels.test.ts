import {
  JOBS_TABS,
  REFERRAL_BOXES,
  REFERRAL_STATUSES,
  jobReferralsIntro,
  jobReferralsWayOutText,
  jobSavedText,
  jobsQuery,
  jobsTabFrom,
  myReferralText,
  referralAskRefusalText,
  referralAskText,
  referralBoxFrom,
  referralsOffReason,
  referralStatusLabel,
  referralsWayOutText,
  referralWhen,
  takesReferralRequests,
  waitingReferralsCloseText,
  type ReferralDto,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import { canTransitionReferral, transitionReferral, type ReferralAction, type ReferralSide } from "../../src/services/referrals/transitions";

/** Where a URL with this query string lands, read back the way both apps read it. */
const landing = (query: string) => {
  const params = new URLSearchParams(query);
  return { tab: jobsTabFrom(params.get("tab")), box: referralBoxFrom(params.get("box")) };
};

describe("the Jobs section's URL", () => {
  it("leaves Openings, the default, with no query, and names the list only on Referrals", () => {
    expect(jobsQuery()).toBe("");
    expect(jobsQuery("openings", "sent")).toBe("");
    expect(jobsQuery("seekers", "sent")).toBe("?tab=seekers");
    expect(jobsQuery("referrals")).toBe("?tab=referrals");
    expect(jobsQuery("referrals", "sent")).toBe("?tab=referrals&box=sent");
  });

  it("reads back as the tab and list it was written for, and anything unknown as Openings and Received", () => {
    for (const tab of JOBS_TABS) for (const box of REFERRAL_BOXES) expect(landing(jobsQuery(tab, box))).toEqual({ tab, box: tab === "referrals" ? box : "received" });
    expect(landing("?tab=constructor&box=__proto__")).toEqual({ tab: "openings", box: "received" });
  });
});

describe("a referral request's status and dates", () => {
  const base: Pick<ReferralDto, "box" | "status" | "createdAt" | "respondedAt" | "acceptedAt" | "closedAt"> = { box: "sent", status: "REQUESTED", createdAt: "2026-01-01", respondedAt: null, acceptedAt: null, closedAt: null };
  const date = (iso: string) => iso;

  it("reads the same for every status on both sides, waiting being the only one that differs", () => {
    for (const status of REFERRAL_STATUSES) {
      const sent = referralStatusLabel({ box: "sent", status });
      const received = referralStatusLabel({ box: "received", status });
      if (status === "REQUESTED") expect([sent, received]).toEqual(["Request sent", "Waiting for your answer"]);
      else expect(sent).toBe(received);
    }
  });

  it("says when it was asked for and when it last changed", () => {
    expect(referralWhen(base, date)).toBe("Asked 2026-01-01");
    expect(referralWhen({ ...base, status: "ACCEPTED", respondedAt: "2026-01-02", acceptedAt: "2026-01-02" }, date)).toBe("Asked 2026-01-01 · accepted 2026-01-02");
    expect(referralWhen({ ...base, status: "DECLINED", respondedAt: "2026-01-03" }, date)).toBe("Asked 2026-01-01 · declined 2026-01-03");
    expect(referralWhen({ ...base, status: "WITHDRAWN", closedAt: "2026-01-04" }, date)).toBe("Asked 2026-01-01 · withdrawn 2026-01-04");
    expect(referralWhen({ ...base, status: "CLOSED", closedAt: "2026-01-05" }, date)).toBe("Asked 2026-01-01 · closed 2026-01-05");
  });
});

describe("what a job's page says about referrals", () => {
  it("tells a member where their own request stands, naming the poster only where they acted", () => {
    const said = Object.fromEntries(REFERRAL_STATUSES.map((s) => [s, myReferralText(s, "Priya Sharma")]));
    expect(said).toEqual({
      REQUESTED: "You've asked Priya Sharma for a referral. Their answer will show in Referrals.",
      ACCEPTED: "Priya Sharma accepted your referral request.",
      DECLINED: "Priya Sharma declined your referral request, so you can't ask again for this job.",
      WITHDRAWN: "You withdrew your referral request.",
      CLOSED: "Your referral request closed when this job stopped taking requests.",
    });
  });

  it("warns the poster how many waiting requests closing the job would close, in the singular for one", () => {
    expect(waitingReferralsCloseText(1)).toBe("1 referral request is waiting for your answer. It will close, and its sender will be told this job is no longer taking referral requests.");
    expect(waitingReferralsCloseText(3)).toBe("3 referral requests are waiting for your answer. They will close, and each sender will be told this job is no longer taking referral requests.");
  });

  it("says why referrals are off: the institution's switch, or a current pupil's account", () => {
    expect(referralsOffReason("DemoU", true)).toBe("DemoU has switched referral requests off.");
    expect(referralsOffReason("DemoU", false)).toBe("Referral requests aren't open to your account.");
    expect(referralsWayOutText("DemoU", true)).toBe(
      "DemoU has switched referral requests off. You can't ask for referrals or accept requests, but you can still withdraw your requests, and decline or report requests about your jobs, here.",
    );
    expect(jobReferralsWayOutText("DemoU", false)).toBe("Referral requests aren't open to your account. You can't accept requests now, but you can still decline or report them here.");
  });

  const NOW = Date.parse("2026-06-01T12:00:00Z");
  const open = { canRefer: true, moderationStatus: "APPROVED" as const, isClosed: false, expiresAt: null };

  it("takes requests only for a job that is offered, published, open and before its closing date, as the API decides", () => {
    expect(takesReferralRequests(open, NOW)).toBe(true);
    expect(takesReferralRequests({ ...open, expiresAt: "2026-06-01T12:00:01Z" }, NOW)).toBe(true);
    expect(takesReferralRequests({ ...open, canRefer: false }, NOW)).toBe(false);
    expect(takesReferralRequests({ ...open, isClosed: true }, NOW)).toBe(false);
    expect(takesReferralRequests({ ...open, moderationStatus: "PENDING" }, NOW)).toBe(false);
    expect(takesReferralRequests({ ...open, moderationStatus: "REJECTED" }, NOW)).toBe(false);
    expect(takesReferralRequests({ ...open, expiresAt: "2026-06-01T12:00:00Z" }, NOW)).toBe(false);
  });

  it("tells the poster above their job's requests whether members can still ask, and if not, the first reason why", () => {
    // Accepting a member they already chat with reuses that chat, as the request form tells its sender.
    expect(jobReferralsIntro(open, NOW)).toBe(
      "Members who'd like you to refer them ask here, with a short note. Accepting opens a private chat between you, with their note as its first message, or the latest one if you already chat.",
    );
    expect(jobReferralsIntro({ ...open, canRefer: false, isClosed: true }, NOW)).toBe("You no longer offer referrals for this job, so members can't ask any more.");
    expect(jobReferralsIntro({ ...open, isClosed: true, moderationStatus: "PENDING" }, NOW)).toBe("This job is closed, so members can't ask for a referral any more.");
    expect(jobReferralsIntro({ ...open, moderationStatus: "PENDING" }, NOW)).toBe("While this job is in review, members can't ask for a referral. Requests already waiting stay here.");
    expect(jobReferralsIntro({ ...open, expiresAt: "2026-05-01T00:00:00Z" }, NOW)).toBe("This job is past its closing date, so members can't ask for a referral any more.");
    expect(referralAskText("Priya Sharma")).toBe("Priya Sharma can refer people for this job. Ask with a short note: if they accept, it opens a private chat between you.");
  });

  it("says before a note is written what of the member's own stands in the way of asking", () => {
    expect(referralAskRefusalText("LIMIT", "Priya Sharma")).toEqual({ heading: "You can't ask again for this job", body: "You've asked for a referral for this job 3 times, which is as many as you can." });
    expect(referralAskRefusalText("YOU_BLOCKED", "Priya Sharma")).toEqual({
      heading: "You can't ask for a referral now",
      body: "You've blocked Priya Sharma. To ask them for a referral, unblock them from Blocked members in Messages.",
    });
  });
});

describe("what saving a job says", () => {
  it("is the same on both apps, and says when an admin has to approve it first", () => {
    expect([jobSavedText(false, false), jobSavedText(false, true), jobSavedText(true, false), jobSavedText(true, true)]).toEqual([
      "Job published",
      "Submitted — awaiting admin approval",
      "Changes saved",
      "Saved — awaiting admin approval",
    ]);
  });
});

describe("referral transitions", () => {
  const ALLOWED: Array<[ReferralAction, ReferralSide, string]> = [
    ["accept", "POSTER", "ACCEPTED"],
    ["decline", "POSTER", "DECLINED"],
    ["withdraw", "REQUESTER", "WITHDRAWN"],
    ["close", "JOB", "CLOSED"],
  ];

  it("move a waiting request on, each only by its own side", () => {
    for (const [action, side, to] of ALLOWED) {
      expect(transitionReferral("REQUESTED", action, side)).toBe(to);
      for (const other of (["POSTER", "REQUESTER", "JOB"] as const).filter((s) => s !== side)) {
        expect(canTransitionReferral("REQUESTED", action, other), `${action} by ${other}`).toBe(false);
        expect(() => transitionReferral("REQUESTED", action, other)).toThrow();
      }
    }
  });

  it("never move one that has stopped waiting", () => {
    for (const from of REFERRAL_STATUSES.filter((s) => s !== "REQUESTED")) {
      for (const [action, side] of ALLOWED) {
        expect(canTransitionReferral(from, action, side), `${action} from ${from}`).toBe(false);
        expect(() => transitionReferral(from, action, side)).toThrow();
      }
    }
  });
});
