import { homeSection, MEMBER_SECTIONS, splitSections, TENANT_FEATURES, type MemberSection, type TenantFeature, type TenantFeatures } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** Everything off except the named keys, so a rule reading the wrong key shows up. */
const only = (...on: TenantFeature[]) => Object.fromEntries(TENANT_FEATURES.map((f) => [f, on.includes(f)])) as TenantFeatures;

describe("MEMBER_SECTIONS", () => {
  it("is in priority order, which isn't the order of the feature keys", () => {
    expect(MEMBER_SECTIONS).toEqual(["feed", "messages", "jobs", "directory", "events", "businesses", "funding"]);
  });
});

describe("splitSections", () => {
  it("shows four and overflows the fifth, with exactly five enabled", () => {
    expect(splitSections(only("feed", "jobs", "directory", "events", "funding"), false)).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["funding"] });
    expect(splitSections(only("feed", "jobs", "directory", "events", "businesses"), false)).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["businesses"] });
  });

  it("puts Messages second, which pushes Events behind More, with everything enabled for a member who can use it", () => {
    expect(splitSections(only(...TENANT_FEATURES), true)).toEqual({ bar: ["feed", "messages", "jobs", "directory"], overflow: ["events", "businesses", "funding"] });
  });

  it("leaves Messages out for a member who can't use it, even with messaging on, and everything moves up", () => {
    expect(splitSections(only(...TENANT_FEATURES), false)).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["businesses", "funding"] });
  });

  it("leaves Messages out with messaging off, even for a member who could use it", () => {
    expect(splitSections(only("feed", "jobs", "directory", "events", "businesses", "funding"), true)).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["businesses", "funding"] });
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
  it.each<[MemberSection, TenantFeature]>([
    ["feed", "feed"],
    ["messages", "messaging"],
    ["jobs", "jobs"],
    ["directory", "directory"],
    ["events", "events"],
    ["businesses", "businesses"],
    ["funding", "funding"],
  ])("shows %s when %s is on, and no other section", (section, feature) => {
    expect(splitSections(only(feature), true).bar).toEqual([section]);
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

  it("never lands on Messages, even when it comes first", () => {
    expect(homeSection(only("messaging", "jobs"))).toBe("jobs");
    expect(homeSection(only("messaging"))).toBeNull();
    expect(homeSection(only(...TENANT_FEATURES))).toBe("feed");
  });

  it("has nowhere to land with everything off", () => {
    expect(homeSection(only())).toBeNull();
  });
});
