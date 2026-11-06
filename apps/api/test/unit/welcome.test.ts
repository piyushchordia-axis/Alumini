import {
  MEMBER_SECTIONS,
  MEMBERSHIP_STATUSES,
  TENANT_FEATURES,
  WELCOME_PROFILE_ITEMS,
  WELCOME_SECTION_ORDER,
  missingProfileItems,
  profileStrength,
  resolveFeatures,
  welcomeDue,
  welcomeSections,
  welcomeSteps,
  type ProfileStrengthInput,
  type TenantFeature,
  type TenantFeatures,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** Everything off except the named keys, so a rule reading the wrong key shows up. */
const only = (...on: TenantFeature[]) => Object.fromEntries(TENANT_FEATURES.map((f) => [f, on.includes(f)])) as TenantFeatures;

describe("welcomeDue", () => {
  const DONE = "2026-11-07T09:30:00.000Z";

  it("owes the walk-through only to an approved member who hasn't had it", () => {
    expect(welcomeDue({ status: "APPROVED", welcomeDoneAt: null })).toBe(true);
    expect(welcomeDue({ status: "APPROVED", welcomeDoneAt: DONE })).toBe(false);
  });

  it("waits for approval: an applicant, a rejected or a suspended member isn't owed it yet", () => {
    for (const status of MEMBERSHIP_STATUSES.filter((s) => s !== "APPROVED")) expect(welcomeDue({ status, welcomeDoneAt: null }), status).toBe(false);
  });

  it("never opens it on a membership without the key, such as an older cached answer or a mock", () => {
    expect(welcomeDue({ status: "APPROVED" })).toBe(false);
    expect(welcomeDue({ status: "APPROVED", welcomeDoneAt: undefined })).toBe(false);
  });
});

describe("WELCOME_SECTION_ORDER", () => {
  it("lists every section but the feed, once each, so a new section can't be left off the last screen", () => {
    expect([...WELCOME_SECTION_ORDER].sort()).toEqual(MEMBER_SECTIONS.filter((s) => s !== "feed").sort());
    expect(new Set(WELCOME_SECTION_ORDER).size).toBe(WELCOME_SECTION_ORDER.length);
  });
});

describe("welcomeSections", () => {
  it("lists all eight, people first, at a university with its defaults for a member who can chat", () => {
    expect(welcomeSections(resolveFeatures("UNIVERSITY", {}), true)).toEqual(["directory", "mentors", "groups", "messages", "events", "jobs", "businesses", "funding"]);
  });

  it("leaves out what a school starts with off: messages, groups and mentors", () => {
    expect(welcomeSections(resolveFeatures("SCHOOL", {}), true)).toEqual(["directory", "events", "jobs", "businesses", "funding"]);
  });

  it("leaves out messages, groups and mentors for a current pupil, even with every switch on", () => {
    expect(welcomeSections(only(...TENANT_FEATURES), false)).toEqual(["directory", "events", "jobs", "businesses", "funding"]);
  });

  it("lists sections behind More as well as those in the bar, and never the feed", () => {
    const all = welcomeSections(only(...TENANT_FEATURES), true);
    expect(all).toEqual(WELCOME_SECTION_ORDER);
    expect(all).not.toContain("feed");
  });

  it("leaves out a section that's switched off", () => {
    const features = { ...resolveFeatures("UNIVERSITY", {}), directory: false };
    expect(welcomeSections(features, true)).not.toContain("directory");
    expect(welcomeSections(features, true)).toHaveLength(7);
  });

  it("lists Messages for groups alone, as the menus do, because group threads are in the inbox", () => {
    expect(welcomeSections(only("feed", "groups"), true)).toEqual(["groups", "messages"]);
  });

  it("is empty with only the feed on, or nothing at all", () => {
    expect(welcomeSections(only("feed"), true)).toEqual([]);
    expect(welcomeSections(only(), true)).toEqual([]);
  });
});

describe("welcomeSteps", () => {
  it("has three screens, or two with no section to list, so the counter reads of 2", () => {
    expect(welcomeSteps(["directory"])).toEqual(["hello", "profile", "explore"]);
    expect(welcomeSteps(welcomeSections(resolveFeatures("COLLEGE", {}), true))).toHaveLength(3);
    expect(welcomeSteps([])).toEqual(["hello", "profile"]);
    expect(welcomeSteps(welcomeSections(only("feed"), true))).toEqual(["hello", "profile"]);
  });
});

describe("WELCOME_PROFILE_ITEMS", () => {
  const fresh: ProfileStrengthInput = {
    avatarUrl: null,
    headline: null,
    companyName: null,
    designation: null,
    city: null,
    skills: [],
    bio: null,
    industry: null,
    careerStartYear: null,
    professionType: "EMPLOYED",
    batchYear: 2012,
    dateOfBirth: null,
    linkedinUrl: null,
    websiteUrl: null,
    githubUrl: null,
    instagramUrl: null,
    xUrl: null,
    degree: null,
    fieldOfStudy: null,
    experiences: [],
    education: [],
  };
  const college = { type: "COLLEGE" as const, timezone: "Asia/Kolkata" };

  it("suggests a new member's photo and headline first, then the next two once those are in", () => {
    expect(WELCOME_PROFILE_ITEMS).toBe(2);
    expect(missingProfileItems(profileStrength(fresh, college), WELCOME_PROFILE_ITEMS).map((i) => i.key)).toEqual(["photo", "headline"]);
    const started = profileStrength({ ...fresh, avatarUrl: "https://cdn.example.com/a.jpg", headline: "Engineer" }, college);
    expect(missingProfileItems(started, WELCOME_PROFILE_ITEMS).map((i) => i.key)).toEqual(["role", "city"]);
  });
});
