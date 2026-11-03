import { homeSection, MEMBER_SECTIONS, splitSections, TENANT_FEATURES, type MemberSection, type TenantFeature, type TenantFeatures } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** Everything off except the named keys, so a rule reading the wrong key shows up. */
const only = (...on: TenantFeature[]) => Object.fromEntries(TENANT_FEATURES.map((f) => [f, on.includes(f)])) as TenantFeatures;

describe("MEMBER_SECTIONS", () => {
  it("is in priority order, which isn't the order of the feature keys, with Groups after Events and Mentors after Groups", () => {
    expect(MEMBER_SECTIONS).toEqual(["feed", "messages", "jobs", "directory", "events", "groups", "mentors", "businesses", "funding"]);
  });
});

describe("splitSections", () => {
  it("shows four and overflows the fifth, with exactly five enabled", () => {
    expect(splitSections(only("feed", "jobs", "directory", "events", "funding"), false)).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["funding"] });
    expect(splitSections(only("feed", "jobs", "directory", "events", "businesses"), false)).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["businesses"] });
  });

  it("puts Messages second, which pushes Events and Groups behind More, with everything enabled for a member who can use it", () => {
    expect(splitSections(only(...TENANT_FEATURES), true)).toEqual({ bar: ["feed", "messages", "jobs", "directory"], overflow: ["events", "groups", "mentors", "businesses", "funding"] });
  });

  it("leaves Messages, Groups and Mentors out for a member who can't use them, even with all on, and everything moves up", () => {
    expect(splitSections(only(...TENANT_FEATURES), false)).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["businesses", "funding"] });
  });

  it("leaves Messages out with messaging and groups off, even for a member who could use it", () => {
    expect(splitSections(only("feed", "jobs", "directory", "events", "businesses", "funding"), true)).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["businesses", "funding"] });
  });

  it("shows Messages for groups alone, because group threads are in the inbox, alongside Groups itself", () => {
    expect(splitSections(only("feed", "groups"), true)).toEqual({ bar: ["feed", "messages", "groups"], overflow: [] });
    expect(splitSections(only("feed", "messaging"), true)).toEqual({ bar: ["feed", "messages"], overflow: [] });
    expect(splitSections(only("feed", "groups"), false)).toEqual({ bar: ["feed"], overflow: [] });
  });

  it("shows Mentors with mentorship on, which needs messaging, and only for a member who can use it", () => {
    expect(splitSections(only("mentorship", "messaging"), true)).toEqual({ bar: ["messages", "mentors"], overflow: [] });
    expect(splitSections(only("mentorship", "messaging"), false)).toEqual({ bar: [], overflow: [] });
    // A map that has mentorship without messaging can't come from the API, which resolves it off, and shows nothing either.
    expect(splitSections(only("mentorship"), true)).toEqual({ bar: [], overflow: [] });
    expect(splitSections(only("messaging", "groups"), true).bar).not.toContain("mentors");
  });

  it("keeps Mentors behind More, in its place, for a member who can't use it but has something there to leave", () => {
    expect(splitSections(only(...TENANT_FEATURES), false, { mentorsWayOut: true })).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["mentors", "businesses", "funding"] });
    // Never in the bar, even with room there: it's a way out, not a section to use.
    expect(splitSections(only("feed", "messaging"), true, { mentorsWayOut: true })).toEqual({ bar: ["feed", "messages"], overflow: ["mentors"] });
    // And no change where it shows anyway, or with nothing to leave.
    expect(splitSections(only(...TENANT_FEATURES), true, { mentorsWayOut: true })).toEqual(splitSections(only(...TENANT_FEATURES), true));
    expect(splitSections(only("feed", "messaging"), true, { mentorsWayOut: false })).toEqual({ bar: ["feed", "messages"], overflow: [] });
  });

  it("brings Businesses onto the bar ahead of Funding when a section above it is off", () => {
    expect(splitSections(only("jobs", "directory", "events", "businesses", "funding"), false)).toEqual({ bar: ["jobs", "directory", "events", "businesses"], overflow: ["funding"] });
  });

  it("shows all of them with four enabled, whichever four, in priority order", () => {
    expect(splitSections(only("funding", "events", "directory", "jobs"), false)).toEqual({ bar: ["jobs", "directory", "events", "funding"], overflow: [] });
  });

  it("shows one with one enabled", () => {
    expect(splitSections(only("events"), false)).toEqual({ bar: ["events"], overflow: [] });
  });

  it("is empty with nothing enabled", () => {
    expect(splitSections(only(), true)).toEqual({ bar: [], overflow: [] });
  });

  // A table rather than a loop over the keys: a section can have another name than its key, or depend on several.
  it.each<[TenantFeature, MemberSection[]]>([
    ["feed", ["feed"]],
    ["messaging", ["messages"]],
    ["groups", ["messages", "groups"]],
    ["jobs", ["jobs"]],
    ["directory", ["directory"]],
    ["events", ["events"]],
    ["businesses", ["businesses"]],
    ["funding", ["funding"]],
  ])("with only %s on, shows %j and no other section", (feature, sections) => {
    expect(splitSections(only(feature), true).bar).toEqual(sections);
  });
});

describe("homeSection", () => {
  it("lands on the feed when it is on", () => {
    expect(homeSection(only("funding", "feed", "jobs"))).toBe("feed");
  });

  it("lands on the next section in priority order with the feed off", () => {
    expect(homeSection(only("funding", "directory", "jobs"))).toBe("jobs");
    expect(homeSection(only("funding", "directory"))).toBe("directory");
  });

  it("never lands on Messages, Groups or Mentors, even when they come first", () => {
    expect(homeSection(only("messaging", "mentorship", "funding"))).toBe("funding");
    expect(homeSection(only("messaging", "jobs"))).toBe("jobs");
    expect(homeSection(only("messaging"))).toBeNull();
    expect(homeSection(only("groups", "messaging"))).toBeNull();
    expect(homeSection(only(...TENANT_FEATURES))).toBe("feed");
  });

  it("has nowhere to land with everything off", () => {
    expect(homeSection(only())).toBeNull();
  });
});
