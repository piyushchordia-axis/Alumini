import {
  MEMBER_SECTIONS,
  MEMBERSHIP_STATUSES,
  TENANT_FEATURES,
  WELCOME_COPY,
  WELCOME_PROFILE_ITEMS,
  WELCOME_SECTION_ORDER,
  missingProfileItems,
  profileStrength,
  resolveFeatures,
  welcomeDue,
  welcomeProfile,
  welcomeSections,
  welcomeStepCount,
  welcomeSteps,
  welcomeTitle,
  type ProfileStrengthInput,
  type TenantFeature,
  type TenantFeatures,
} from "@illuminize/shared";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECTION_PATHS, entryHref, homeHref, isWelcomePath, welcomeHref } from "../../../mobile/src/lib/entry";

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
const photoAndHeadline: ProfileStrengthInput = { ...fresh, avatarUrl: "https://cdn.example.com/a.jpg", headline: "Engineer" };
const complete: ProfileStrengthInput = {
  ...photoAndHeadline,
  designation: "Engineer",
  city: "Pune",
  skills: ["Go", "SQL", "Kafka"],
  bio: "Building payments.",
  industry: "SOFTWARE_INTERNET",
  careerStartYear: 2014,
  linkedinUrl: "https://www.linkedin.com/in/someone",
  degree: "B.E.",
  experiences: [{ company: "Acme", title: "Engineer", startYear: 2014, endYear: 2018 }],
};

describe("WELCOME_PROFILE_ITEMS", () => {
  it("suggests a new member's photo and headline first, then the next two once those are in", () => {
    expect(WELCOME_PROFILE_ITEMS).toBe(2);
    expect(missingProfileItems(profileStrength(fresh, college), WELCOME_PROFILE_ITEMS).map((i) => i.key)).toEqual(["photo", "headline"]);
    expect(missingProfileItems(profileStrength(photoAndHeadline, college), WELCOME_PROFILE_ITEMS).map((i) => i.key)).toEqual(["role", "city"]);
  });
});

describe("welcomeProfile", () => {
  it("asks a new member for a photo and a headline, as links to where each is added", () => {
    const { items, body } = welcomeProfile(profileStrength(fresh, college));
    expect(items.map((i) => [i.label, i.section])).toEqual([
      ["Add a profile photo", "basics"],
      ["Write a headline", "work"],
    ]);
    expect(body).toBe("A photo and a headline help people recognise you and see what you do.");
  });

  it("still asks while either of the two is missing", () => {
    expect(welcomeProfile(profileStrength({ ...fresh, avatarUrl: "https://cdn.example.com/a.jpg" }, college)).body).toBe(WELCOME_COPY.profile.start);
    expect(welcomeProfile(profileStrength({ ...fresh, headline: "Engineer" }, college)).body).toBe(WELCOME_COPY.profile.start);
  });

  it("says the photo and headline are in, and suggests the next two, once they are", () => {
    const { items, body } = welcomeProfile(profileStrength(photoAndHeadline, college));
    expect(items.map((i) => i.key)).toEqual(["role", "city"]);
    expect(body).toBe("Your photo and headline are in. A little more helps people find you.");
  });

  it("suggests nothing on a complete profile, and says so", () => {
    const strength = profileStrength(complete, college);
    expect(strength.score).toBe(100);
    expect(welcomeProfile(strength)).toEqual({ items: [], body: "Your profile has what people look for first." });
  });

  it("says each link ends the welcome, in the singular when there's one", () => {
    expect(WELCOME_COPY.profile.linksHint(2)).toBe("Each opens My profile and ends this welcome.");
    expect(WELCOME_COPY.profile.linksHint(1)).toBe("It opens My profile and ends this welcome.");
  });
});

describe("welcomeTitle", () => {
  it("greets the member by the first word of their name", () => {
    expect(welcomeTitle("Smoke Tester")).toBe("Welcome, Smoke");
    expect(welcomeTitle("  Asha   Rao ")).toBe("Welcome, Asha");
    expect(welcomeTitle("Kavita")).toBe("Welcome, Kavita");
  });

  it("is just Welcome with no name to go by", () => {
    expect(welcomeTitle("")).toBe("Welcome");
    expect(welcomeTitle("   ")).toBe("Welcome");
    expect(welcomeTitle(null)).toBe("Welcome");
    expect(welcomeTitle(undefined)).toBe("Welcome");
  });
});

describe("welcomeStepCount", () => {
  it("counts from one, out of however many screens there are", () => {
    expect(welcomeStepCount(0, 3)).toBe("1 of 3");
    expect(welcomeStepCount(2, 3)).toBe("3 of 3");
    expect(welcomeStepCount(1, welcomeSteps([]).length)).toBe("2 of 2");
  });
});

describe("WELCOME_COPY", () => {
  it("names the institution on the last screen", () => {
    expect(WELCOME_COPY.explore.body("DemoU")).toBe("Here's what DemoU has for you. It's all in the menu too, any time.");
  });

  it("keeps its buttons' names apart, so each is found by its own", () => {
    const buttons = [WELCOME_COPY.skip, WELCOME_COPY.back, WELCOME_COPY.next, WELCOME_COPY.done];
    expect(buttons).toEqual(["Skip", "Back", "Next", "Get started"]);
    expect(new Set(buttons.map((b) => b.toLowerCase())).size).toBe(buttons.length);
  });
});

describe("the phone app's front door (entryHref)", () => {
  const university = resolveFeatures("UNIVERSITY", {});

  it("opens the walk-through, above the tabs, for an approved member who is owed it", () => {
    expect(welcomeHref("demo")).toBe("/t/demo/welcome");
    expect(entryHref("demo", university, { status: "APPROVED", welcomeDoneAt: null })).toBe("/t/demo/welcome");
  });

  it("goes home once it's done, or when the membership doesn't say", () => {
    expect(entryHref("demo", university, { status: "APPROVED", welcomeDoneAt: "2026-11-07T09:30:00.000Z" })).toBe(homeHref("demo", university));
    expect(entryHref("demo", university, { status: "APPROVED" })).toBe("/t/demo/feed");
  });

  it("goes to the home section that's on, as homeHref does", () => {
    const noFeed = { ...university, feed: false };
    expect(entryHref("demo", noFeed, { status: "APPROVED", welcomeDoneAt: "2026-11-07T09:30:00.000Z" })).toBe(homeHref("demo", noFeed));
    expect(homeHref("demo", noFeed)).not.toBe("/t/demo/feed");
    expect(entryHref("demo", only(), { status: "APPROVED", welcomeDoneAt: "2026-11-07T09:30:00.000Z" })).toBe("/t/demo/profile");
  });
});

describe("the phone app's section paths", () => {
  it("name a route folder under the tabs for every section, and the walk-through is a screen above them", () => {
    const app = resolve(fileURLToPath(import.meta.url), "../../../../mobile/src/app/t/[slug]/(app)");
    for (const section of MEMBER_SECTIONS) expect(existsSync(resolve(app, "(tabs)", SECTION_PATHS[section])), section).toBe(true);
    expect(existsSync(resolve(app, "welcome.tsx"))).toBe(true);
  });
});

describe("isWelcomePath", () => {
  it("is this institution's walk-through and nothing else", () => {
    expect(isWelcomePath("/t/demo/welcome", "demo")).toBe(true);
    expect(isWelcomePath("/t/demo/welcome/", "demo")).toBe(true);
    expect(isWelcomePath("/t/other/welcome", "demo")).toBe(false);
    expect(isWelcomePath("/t/demo/feed", "demo")).toBe(false);
    expect(isWelcomePath("/t/demo", "demo")).toBe(false);
    expect(isWelcomePath("/", "demo")).toBe(false);
  });
});
