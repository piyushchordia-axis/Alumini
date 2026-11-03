import {
  MENTORS_TABS,
  MENTORSHIP_BOXES,
  MENTORSHIP_CONFIRM,
  MENTORSHIP_MAX_REQUESTS_PER_PAIR,
  MENTORSHIP_REQUEST_WINDOW_DAYS,
  memberRoleLine,
  mentorAvailabilityText,
  mentorCardLabel,
  mentorshipNoteHelp,
  mentorshipReportHelp,
  mentorsQuery,
  mentorsTabFrom,
  mentorshipBoxFrom,
  mentorshipStatusLabel,
  mentorshipWhen,
  notificationTarget,
  type MentorCardDto,
  type MentorshipDto,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** Where a URL with this query string lands, read back the way both apps read it. */
const landing = (query: string) => {
  const params = new URLSearchParams(query);
  return { tab: mentorsTabFrom(params.get("tab")), box: mentorshipBoxFrom(params.get("box")) };
};

describe("the Mentors section's URL", () => {
  it("leaves Find mentors, the default, with no query, and names the list only on Requests", () => {
    expect(mentorsQuery()).toBe("");
    expect(mentorsQuery("find", "sent")).toBe("");
    expect(mentorsQuery("requests")).toBe("?tab=requests");
    expect(mentorsQuery("requests", "sent")).toBe("?tab=requests&box=sent");
    expect(mentorsQuery("be-a-mentor", "sent")).toBe("?tab=be-a-mentor");
  });

  it("reads back as the tab and list it was written for, for every tab and list", () => {
    for (const tab of MENTORS_TABS) for (const box of MENTORSHIP_BOXES) expect(landing(mentorsQuery(tab, box))).toEqual({ tab, box: tab === "requests" ? box : "received" });
  });

  it("reads anything unknown, or nothing, as Find mentors and the received list", () => {
    for (const value of [null, undefined, "", "REQUESTS", "mine", ["requests"], 3]) expect(mentorsTabFrom(value)).toBe("find");
    for (const value of [null, undefined, "", "SENT", "outbox"]) expect(mentorshipBoxFrom(value)).toBe("received");
  });

  it("is where each mentorship notification lands that doesn't open a chat, on the right side's list", () => {
    const cases = [
      ["MENTORSHIP_REQUESTED", "received"],
      ["MENTORSHIP_DECLINED", "sent"],
      ["MENTORSHIP_ENDED", "received"],
      ["MENTORSHIP_ENDED", "sent"],
    ] as const;
    for (const [type, box] of cases) {
      const target = notificationTarget(type, { mentorshipId: "m1", box });
      expect(target).toEqual({ kind: "mentorship", box });
      if (target?.kind !== "mentorship") throw new Error("not a mentorship target");
      expect(landing(mentorsQuery("requests", target.box))).toEqual({ tab: "requests", box });
    }
  });
});

const at = (day: number) => `2026-11-0${day}T10:00:00.000Z`;
const base: Pick<MentorshipDto, "box" | "status" | "createdAt" | "respondedAt" | "acceptedAt" | "endedAt" | "endedByMe"> = { box: "sent", status: "REQUESTED", createdAt: at(1), respondedAt: null, acceptedAt: null, endedAt: null, endedByMe: false };
const day = (iso: string) => iso.slice(8, 10);

describe("how a mentorship reads", () => {
  it("says whose answer a waiting request needs, and tells a withdrawn request from an ended mentorship", () => {
    expect(mentorshipStatusLabel({ ...base, box: "received" })).toBe("Waiting for your answer");
    expect(mentorshipStatusLabel(base)).toBe("Request sent");
    expect(mentorshipStatusLabel({ ...base, status: "ACCEPTED", acceptedAt: at(2) })).toBe("Active");
    expect(mentorshipStatusLabel({ ...base, status: "DECLINED" })).toBe("Declined");
    expect(mentorshipStatusLabel({ ...base, status: "ENDED" })).toBe("Withdrawn");
    expect(mentorshipStatusLabel({ ...base, status: "ENDED", acceptedAt: at(2) })).toBe("Ended");
  });

  it("dates when it was asked for and when it last changed, and who ended it only when it was this member", () => {
    expect(mentorshipWhen(base, day)).toBe("Asked 01");
    expect(mentorshipWhen({ ...base, status: "ACCEPTED", respondedAt: at(2), acceptedAt: at(2) }, day)).toBe("Asked 01 · accepted 02");
    expect(mentorshipWhen({ ...base, status: "DECLINED", respondedAt: at(3) }, day)).toBe("Asked 01 · declined 03");
    expect(mentorshipWhen({ ...base, status: "ENDED", endedAt: at(4), endedByMe: true }, day)).toBe("Asked 01 · withdrawn 04");
    expect(mentorshipWhen({ ...base, status: "ENDED", acceptedAt: at(2), endedAt: at(5), endedByMe: true }, day)).toBe("Asked 01 · ended 05 by you");
    expect(mentorshipWhen({ ...base, status: "ENDED", acceptedAt: at(2), endedAt: at(5), endedByMe: false }, day)).toBe("Asked 01 · ended 05");
  });

  it("names what a member does, and how often a mentor meets with what they added", () => {
    expect(memberRoleLine({ designation: "CEO", professionType: "FOUNDER", companyName: "Zylo Labs" })).toBe("CEO at Zylo Labs");
    expect(memberRoleLine({ designation: null, professionType: "STUDENT", companyName: null })).toBe("Student");
    expect(mentorAvailabilityText({ availability: "FORTNIGHTLY", availabilityNote: "Weekday evenings" })).toBe("Every two weeks. Weekday evenings");
    expect(mentorAvailabilityText({ availability: "ONE_OFF", availabilityNote: null })).toBe("A one-off conversation");
  });

  it("warns that a withdrawn request stays readable to the mentor and still counts towards the limit, with the limit's own numbers", () => {
    expect(MENTORSHIP_CONFIRM.withdraw.body("Priya Nair")).toBe(
      `Priya Nair can't accept it any more, but can still see your note, marked as withdrawn. It still counts towards the ${MENTORSHIP_MAX_REQUESTS_PER_PAIR} requests you can send one mentor in ${MENTORSHIP_REQUEST_WINDOW_DAYS} days.`,
    );
  });

  it("says what reporting a note does to its sender: a waiting one reads as declined, and they're never told of the report", () => {
    expect(mentorshipReportHelp("Arjun Singh", true)).toBe("Admins will see only the note in this request, and nothing else. The request is declined: Arjun Singh will see it as declined, but won't be told it was reported.");
    expect(mentorshipReportHelp("Arjun Singh", false)).toBe("Admins will see only the note in this request, and nothing else. Arjun Singh won't be told it was reported.");
  });

  it("says a note joins a chat the two already have, rather than promising it's the first message", () => {
    expect(mentorshipNoteHelp("Priya Nair")).toBe("Priya Nair will see this note. If they accept, it becomes the first message of a chat between you, or the latest one if you already chat.");
  });

  it("names a mentor card by everything it shows, starting with the name it shows, the same on both apps", () => {
    const member = { fullName: "Priya Nair", designation: "Product manager", professionType: "EMPLOYED", companyName: "Wise", batchYear: 2012, city: "London" } as MentorCardDto["member"];
    expect(mentorCardLabel({ member, areas: ["CAREER_ADVICE", "WORKING_ABROAD"], availability: "FORTNIGHTLY" })).toBe(
      "Priya Nair, Product manager at Wise, Batch of 2012 · London, Career advice, Working abroad, Availability: Every two weeks",
    );
    expect(mentorCardLabel({ member: { ...member, city: null }, areas: ["LAW"], availability: "ONE_OFF" })).toBe("Priya Nair, Product manager at Wise, Batch of 2012, Law, Availability: A one-off conversation");
  });
});
