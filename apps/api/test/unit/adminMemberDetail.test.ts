import {
  MENTOR_REMOVE_CONFIRM,
  answersToValues,
  choiceOptionsWithCurrent,
  memberFacts,
  mentorListedText,
  mentorProfileRows,
  profileFieldHint,
  roleChangeCopy,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** What the formatters were asked to write, so a fact that bypasses them shows. */
const format = { formatDate: (iso: string) => `date(${iso})`, formatDateTime: (iso: string) => `time(${iso})` };

const NISHA = {
  phone: "+919100000036",
  batchYear: 2010,
  professionType: "EMPLOYED" as const,
  city: "New Jersey",
  country: "US",
  dateOfBirth: "1990-03-12",
  maritalStatus: "MARRIED" as const,
  kidsCount: 0,
  createdAt: "2026-01-05T10:00:00.000Z",
  lastActiveAt: "2026-11-01T08:30:00.000Z",
  lastLoginAt: "2026-10-30T07:00:00.000Z",
};

describe("memberFacts", () => {
  it("lists what a member's admin page shows beside their profile, in order, with labels and the place by name", () => {
    expect(memberFacts(NISHA, format)).toEqual([
      { label: "Phone", value: "+91 91000 00036" },
      { label: "Batch", value: "2010" },
      { label: "Profession", value: "Working at a company" },
      { label: "City", value: "New Jersey, United States" },
      { label: "Date of birth", value: "12 Mar 1990" },
      { label: "Marital status", value: "Married" },
      { label: "Kids", value: "0" },
      { label: "Member since", value: "date(2026-01-05T10:00:00.000Z)" },
      { label: "Last active", value: "time(2026-11-01T08:30:00.000Z)" },
      { label: "Last login", value: "time(2026-10-30T07:00:00.000Z)" },
    ]);
  });

  it("writes a date of birth from its text, never through the formatters, so it can't move a day in any time zone", () => {
    const dob = memberFacts({ ...NISHA, dateOfBirth: "2000-01-01" }, format).find((f) => f.label === "Date of birth");
    expect(dob?.value).toBe("1 Jan 2000");
  });

  it("says never for no activity or sign-in, and a dash for anything not given", () => {
    const facts = new Map(memberFacts({ ...NISHA, city: null, country: null, dateOfBirth: null, maritalStatus: null, kidsCount: null, lastActiveAt: null, lastLoginAt: null }, format).map((f) => [f.label, f.value]));
    expect(facts.get("Last active")).toBe("never");
    expect(facts.get("Last login")).toBe("never");
    for (const label of ["City", "Date of birth", "Marital status", "Kids"]) expect(facts.get(label), label).toBe("—");
  });
});

describe("roleChangeCopy", () => {
  it("asks before making a member an admin, naming what they could do and where", () => {
    expect(roleChangeCopy("Parth Joshi", "TENANT_ADMIN", "Shri Gujarati Samaj")).toEqual({
      label: "Make admin",
      title: "Make Parth Joshi an admin?",
      body: "They'll be able to approve members, moderate content, change settings and read the audit log for Shri Gujarati Samaj.",
      confirm: "Make admin",
      destructive: false,
      done: "Parth Joshi is now an admin",
    });
  });

  it("asks before taking the role away, as a destructive action that keeps the membership", () => {
    expect(roleChangeCopy("Parth Joshi", "MEMBER", "Shri Gujarati Samaj")).toEqual({
      label: "Remove admin role",
      title: "Remove Parth Joshi's admin role?",
      body: "They keep their membership but lose the admin console.",
      confirm: "Remove admin role",
      destructive: true,
      done: "Parth Joshi is no longer an admin",
    });
  });
});

describe("the mentor profile on a member's admin page", () => {
  it("asks before removing a mentor in the words the web console used", () => {
    expect(MENTOR_REMOVE_CONFIRM).toEqual({
      title: "Remove as mentor?",
      body: "They'll no longer appear in Mentors, and requests waiting for them will be declined. Mentorships already under way carry on. They can offer to mentor again, so suspend them if it happens again.",
      confirm: "Remove as mentor",
      done: "Removed as a mentor",
    });
  });

  it("lists the areas by name, the availability with its note, and the member's own note", () => {
    expect(mentorProfileRows({ areas: ["CAREER_ADVICE", "WORKING_ABROAD"], availability: "FORTNIGHTLY", availabilityNote: "Weekday evenings, US East time", note: "Glad to help with CVs." })).toEqual([
      { label: "Areas", value: "Career advice, Working abroad" },
      { label: "Availability", value: "Every two weeks. Weekday evenings, US East time" },
      { label: "Note", value: "Glad to help with CVs." },
    ]);
    expect(mentorProfileRows({ areas: [], availability: "MONTHLY", availabilityNote: null, note: null })).toEqual([
      { label: "Areas", value: "—" },
      { label: "Availability", value: "Monthly" },
      { label: "Note", value: "—" },
    ]);
  });

  it("says whether they are in the Mentors list", () => {
    expect(mentorListedText(true)).toBe("Listed in Mentors");
    expect(mentorListedText(false)).toBe("Not listed in Mentors");
  });
});

describe("the profile questions' helpers", () => {
  it("key a membership's answers by field, nothing for none", () => {
    expect(
      answersToValues([
        { key: "chapter", value: "diaspora" },
        { key: "interests", value: ["seva-and-charity"] },
        { key: "note", value: null },
      ]),
    ).toEqual({ chapter: "diaspora", interests: ["seva-and-charity"], note: null });
    expect(answersToValues(undefined)).toEqual({});
  });

  it("word the hint for whoever answers: the member, or an admin, who also learns who sees it and who can change it", () => {
    const field = (visibility: "MEMBERS" | "ADMINS", memberEditable: boolean, helpText: string | null = null) => ({ visibility, memberEditable, helpText });
    expect(profileFieldHint(field("MEMBERS", true))).toBeUndefined();
    expect(profileFieldHint(field("ADMINS", true), "member")).toBe("Only you and the admins see this.");
    expect(profileFieldHint(field("ADMINS", true, "As on your card."), "member")).toBe("As on your card. Only you and the admins see this.");
    expect(profileFieldHint(field("MEMBERS", true), "admin")).toBeUndefined();
    expect(profileFieldHint(field("ADMINS", true), "admin")).toBe("Only the member and the admins see this.");
    expect(profileFieldHint(field("ADMINS", false, "Office use."), "admin")).toBe("Office use. Only admins see this answer.");
    expect(profileFieldHint(field("MEMBERS", false), "admin")).toBe("Set by the admins: the member can't change it.");
  });

  it("keep a saved choice that is no longer an option, once, after the options", () => {
    const options = [
      { value: "surat", label: "Surat" },
      { value: "diaspora", label: "Diaspora" },
    ];
    expect(choiceOptionsWithCurrent(options, "surat")).toEqual(options);
    expect(choiceOptionsWithCurrent(options, "baroda")).toEqual([...options, { value: "baroda", label: "baroda" }]);
    expect(choiceOptionsWithCurrent(options, ["diaspora", "old", "old"])).toEqual([...options, { value: "old", label: "old" }]);
    for (const none of [null, undefined, "", true, 3, []]) expect(choiceOptionsWithCurrent(options, none), JSON.stringify(none)).toEqual(options);
  });
});
