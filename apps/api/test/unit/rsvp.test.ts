import {
  MY_RSVP_LABELS,
  RSVP_CLOSED_TEXT,
  RSVP_GROUP_LABEL,
  RSVP_STATUSES,
  RSVP_TONES,
  STATUS_TONES,
  myRsvpLabel,
  rsvpBadge,
  rsvpChoices,
  rsvpClosedText,
  rsvpsOpen,
  type ModerationStatus,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const NOW = Date.parse("2026-11-07T06:30:00Z");
const LATER = "2026-11-07T18:00:00.000Z";
const EARLIER = "2026-11-07T06:00:00.000Z";

describe("the RSVP buttons", () => {
  /** Each button as both apps draw it: label, tone, and whether it's chosen or full. */
  const drawn = (event: Parameters<typeof rsvpChoices>[0]) => rsvpChoices(event).map(({ value, label, tone, chosen, full }) => [value, label, tone, chosen, full]);

  it("are I'm going, Maybe and Can't make it, in that order, each in its tone, with the member's answer chosen", () => {
    expect(drawn({ maxAttendees: null, yesCount: 3, myRsvp: null })).toEqual([
      ["YES", "I'm going", "success", false, false],
      ["MAYBE", "Maybe", "warning", false, false],
      ["NO", "Can't make it", "neutral", false, false],
    ]);
    expect(drawn({ maxAttendees: null, yesCount: 3, myRsvp: "MAYBE" }).map(([value, , , chosen]) => [value, chosen])).toEqual([
      ["YES", false],
      ["MAYBE", true],
      ["NO", false],
    ]);
  });

  it("say Full on I'm going alone, once every place is taken, unless the member already has one", () => {
    const full = drawn({ maxAttendees: 10, yesCount: 10, myRsvp: "NO" });
    expect(full[0]).toEqual(["YES", "Full", "success", false, true]);
    expect(full.slice(1).map(([, label, , , isFull]) => [label, isFull])).toEqual([
      ["Maybe", false],
      ["Can't make it", false],
    ]);
    // Going already: their place is theirs, so they can still take it back.
    expect(drawn({ maxAttendees: 10, yesCount: 10, myRsvp: "YES" })[0]).toEqual(["YES", "I'm going", "success", true, false]);
    // A place left, or no limit.
    expect(drawn({ maxAttendees: 10, yesCount: 9, myRsvp: null })[0]).toEqual(["YES", "I'm going", "success", false, false]);
    expect(drawn({ maxAttendees: 0, yesCount: 40, myRsvp: null })[0]).toEqual(["YES", "I'm going", "success", false, false]);
  });

  it("draw every tone from the shared status tones, and are named for screen readers", () => {
    for (const status of RSVP_STATUSES) expect(STATUS_TONES[RSVP_TONES[status]], status).toBeDefined();
    expect(RSVP_TONES).toEqual({ YES: "success", MAYBE: "warning", NO: "neutral" });
    expect(RSVP_GROUP_LABEL).toBe("Your RSVP");
  });
});

describe("the member's answer on an event's card", () => {
  it("reads You: yes, You: maybe or You: no, in the answer's tone", () => {
    expect(RSVP_STATUSES.map(myRsvpLabel)).toEqual(["You: yes", "You: no", "You: maybe"]);
    expect(rsvpBadge("YES")).toEqual({ label: "You: yes", tone: "success" });
    expect(rsvpBadge("MAYBE")).toEqual({ label: "You: maybe", tone: "warning" });
    expect(rsvpBadge("NO")).toEqual({ label: "You: no", tone: "neutral" });
    for (const status of RSVP_STATUSES) expect(rsvpBadge(status)?.label).toBe(MY_RSVP_LABELS[status]);
  });

  it("is no badge at all without an answer", () => {
    expect(rsvpBadge(null)).toBeNull();
    expect(rsvpBadge(undefined)).toBeNull();
  });
});

describe("rsvpsOpen and rsvpClosedText", () => {
  const event = (over: Partial<{ isCancelled: boolean; startAt: string; moderationStatus: ModerationStatus }> = {}) => ({
    isCancelled: false,
    startAt: LATER,
    moderationStatus: "APPROVED" as ModerationStatus,
    ...over,
  });

  it("take answers for an approved event that hasn't begun, with nothing said under the buttons", () => {
    expect(rsvpsOpen(event(), NOW)).toBe(true);
    expect(rsvpsOpen(event(), new Date(NOW))).toBe(true);
    expect(rsvpClosedText(event(), NOW)).toBeNull();
  });

  it("close at the start time itself, and say so", () => {
    const starting = event({ startAt: new Date(NOW).toISOString() });
    expect(rsvpsOpen(starting, NOW)).toBe(false);
    expect(rsvpsOpen(starting, NOW - 1)).toBe(true);
    expect(rsvpClosedText(starting, NOW)).toBe(RSVP_CLOSED_TEXT);
    expect(RSVP_CLOSED_TEXT).toBe("RSVPs are closed: this event has started.");
    expect(rsvpClosedText(event({ startAt: EARLIER }), NOW)).toBe(RSVP_CLOSED_TEXT);
  });

  it("close for a cancelled event, whose badge says why, so no line is added", () => {
    expect(rsvpsOpen(event({ isCancelled: true }), NOW)).toBe(false);
    expect(rsvpClosedText(event({ isCancelled: true }), NOW)).toBeNull();
    expect(rsvpClosedText(event({ isCancelled: true, startAt: EARLIER }), NOW)).toBeNull();
  });

  it.each<ModerationStatus>(["PENDING", "REJECTED", "REMOVED"])("close for an event that is %s, before it begins too", (moderationStatus) => {
    expect(rsvpsOpen(event({ moderationStatus }), NOW)).toBe(false);
    expect(rsvpClosedText(event({ moderationStatus }), NOW)).toBeNull();
  });
});
