import { homeSection, MEMBER_SECTIONS, splitSections, TENANT_FEATURES, type MemberSection, type TenantFeature, type TenantFeatures } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** Everything off except the named keys, so a rule reading the wrong key shows up. */
const only = (...on: TenantFeature[]) => Object.fromEntries(TENANT_FEATURES.map((f) => [f, on.includes(f)])) as TenantFeatures;

describe("MEMBER_SECTIONS", () => {
  it("is in priority order, which isn't the order of the feature keys", () => {
    expect(MEMBER_SECTIONS).toEqual(["feed", "jobs", "directory", "events", "funding"]);
  });
});

describe("splitSections", () => {
  it("shows four and overflows the fifth, with exactly five enabled", () => {
    expect(splitSections(only("feed", "jobs", "directory", "events", "funding"))).toEqual({ bar: ["feed", "jobs", "directory", "events"], overflow: ["funding"] });
  });

  it("shows all of them with four enabled, whichever four, in priority order", () => {
    expect(splitSections(only("funding", "events", "directory", "jobs"))).toEqual({ bar: ["jobs", "directory", "events", "funding"], overflow: [] });
  });

  it("shows one with one enabled", () => {
    expect(splitSections(only("events"))).toEqual({ bar: ["events"], overflow: [] });
  });

  it("is empty with nothing enabled", () => {
    expect(splitSections(only())).toEqual({ bar: [], overflow: [] });
  });

  // A table rather than a loop over the keys: a section can have another name than its key, or depend on several.
  it.each<[MemberSection, TenantFeature]>([
    ["feed", "feed"],
    ["jobs", "jobs"],
    ["directory", "directory"],
    ["events", "events"],
    ["funding", "funding"],
  ])("shows %s when %s is on, and no other section", (section, feature) => {
    expect(splitSections(only(feature)).bar).toEqual([section]);
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

  it("has nowhere to land with everything off", () => {
    expect(homeSection(only())).toBeNull();
  });
});
