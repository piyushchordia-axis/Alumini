import {
  applyFeatureChange,
  changedFeatures,
  chatAvailable,
  defaultFeaturesFor,
  enabledGroupVisibilities,
  FEATURE_PREREQUISITES,
  resolveFeatures,
  retypeToSchool,
  SCHOOL_OFF_FEATURES,
  TENANT_FEATURES,
  TENANT_TYPES,
  type TenantFeature,
} from "@illuminize/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const allOn = () => Object.fromEntries(TENANT_FEATURES.map((f) => [f, true]));

describe("defaultFeaturesFor", () => {
  it("gives every type a complete map with everything on outside the school-off table", () => {
    for (const type of TENANT_TYPES) {
      const features = defaultFeaturesFor(type);
      expect(Object.keys(features).sort()).toEqual([...TENANT_FEATURES].sort());
      for (const f of TENANT_FEATURES) expect(features[f]).toBe(!(type === "SCHOOL" && SCHOOL_OFF_FEATURES.includes(f)));
    }
  });
});

describe("the businesses key", () => {
  it("starts on for every type, schools included", () => {
    for (const type of TENANT_TYPES) expect(defaultFeaturesFor(type).businesses, type).toBe(true);
    expect(SCHOOL_OFF_FEATURES).not.toContain("businesses");
  });

  it("reads on for a row stored before the key existed, and off once an admin turns it off", () => {
    for (const type of TENANT_TYPES) expect(resolveFeatures(type, { feed: true }).businesses, type).toBe(true);
    expect(resolveFeatures("SCHOOL", { businesses: false }).businesses).toBe(false);
    expect(applyFeatureChange("SCHOOL", { feed: true }, { businesses: false }).features.businesses).toBe(false);
  });

  it("isn't forced off by retyping to a school", () => {
    const { features, forcedOff } = retypeToSchool("COLLEGE", { businesses: true });
    expect(features.businesses).toBe(true);
    expect(forcedOff).not.toContain("businesses");
  });
});

describe("the messaging key", () => {
  it("starts off for schools and on everywhere else", () => {
    expect(defaultFeaturesFor("SCHOOL").messaging).toBe(false);
    for (const type of TENANT_TYPES.filter((t) => t !== "SCHOOL")) expect(defaultFeaturesFor(type).messaging, type).toBe(true);
    expect(SCHOOL_OFF_FEATURES).toContain("messaging");
  });

  it("reads off for a school whose row doesn't mention it, on for anyone else's, and on where a school's admin turned it on", () => {
    expect(resolveFeatures("SCHOOL", { feed: true }).messaging).toBe(false);
    expect(resolveFeatures("COLLEGE", { feed: true }).messaging).toBe(true);
    expect(resolveFeatures("SCHOOL", { messaging: true }).messaging).toBe(true);
  });

  it("isn't switched on at a school by a partial change to another key", () => {
    expect(applyFeatureChange("SCHOOL", { feed: true }, { jobs: false }).features.messaging).toBe(false);
  });

  it("is forced off by retyping to a school", () => {
    const { features, forcedOff } = retypeToSchool("COLLEGE", {});
    expect(features.messaging).toBe(false);
    expect(forcedOff).toContain("messaging");
  });
});

describe("the groups key", () => {
  it("starts off for schools and on everywhere else", () => {
    expect(defaultFeaturesFor("SCHOOL").groups).toBe(false);
    for (const type of TENANT_TYPES.filter((t) => t !== "SCHOOL")) expect(defaultFeaturesFor(type).groups, type).toBe(true);
    expect(SCHOOL_OFF_FEATURES).toContain("groups");
  });

  it("reads off for a school whose row doesn't mention it, on for anyone else's, and on where a school's admin turned it on", () => {
    expect(resolveFeatures("SCHOOL", { feed: true, messaging: true }).groups).toBe(false);
    expect(resolveFeatures("COLLEGE", { feed: true }).groups).toBe(true);
    expect(resolveFeatures("SCHOOL", { groups: true }).groups).toBe(true);
  });

  it("isn't switched on at a school by a partial change to another key, messaging included", () => {
    expect(applyFeatureChange("SCHOOL", { feed: true }, { messaging: true }).features.groups).toBe(false);
  });

  it("is forced off by retyping to a school, alongside messaging", () => {
    const { features, forcedOff } = retypeToSchool("COLLEGE", {});
    expect(features.groups).toBe(false);
    expect(forcedOff).toEqual(expect.arrayContaining(["messaging", "groups"]));
  });

  it("stands on its own: switching messaging off leaves groups on, and the other way round", () => {
    expect(applyFeatureChange("COLLEGE", {}, { messaging: false }).features).toMatchObject({ messaging: false, groups: true });
    expect(applyFeatureChange("COLLEGE", {}, { groups: false }).features).toMatchObject({ messaging: true, groups: false });
  });
});

describe("enabledGroupVisibilities", () => {
  it("allows open groups on groups alone, and invite-only ones only with messaging as well", () => {
    expect(enabledGroupVisibilities({ ...defaultFeaturesFor("COLLEGE") })).toEqual(["OPEN", "INVITE_ONLY"]);
    expect(enabledGroupVisibilities({ ...defaultFeaturesFor("COLLEGE"), messaging: false })).toEqual(["OPEN"]);
    expect(enabledGroupVisibilities({ ...defaultFeaturesFor("COLLEGE"), groups: false })).toEqual([]);
    expect(enabledGroupVisibilities(defaultFeaturesFor("SCHOOL"))).toEqual([]);
  });
});

describe("chatAvailable", () => {
  it("is on with either chat switch, for a member who isn't a pupil", () => {
    const off = { ...defaultFeaturesFor("COLLEGE"), messaging: false, groups: false };
    expect(chatAvailable({ ...off, messaging: true }, true)).toBe(true);
    expect(chatAvailable({ ...off, groups: true }, true)).toBe(true);
    expect(chatAvailable(off, true)).toBe(false);
    expect(chatAvailable(defaultFeaturesFor("COLLEGE"), false)).toBe(false);
  });
});

describe("resolveFeatures", () => {
  it("fills missing keys, lets stored keys win and drops keys that no longer exist", () => {
    expect(resolveFeatures("COLLEGE", {})).toEqual(allOn());
    expect(resolveFeatures("COLLEGE", null)).toEqual(allOn());
    expect(resolveFeatures("COLLEGE", { jobs: false })).toEqual({ ...allOn(), jobs: false });
    expect(resolveFeatures("COLLEGE", { retired: true } as never)).toEqual(allOn());
  });
});

// These borrow a key that isn't in the tables, so they keep proving the rules whichever keys later slices add.
describe("with a key in the school-off table", () => {
  const table = SCHOOL_OFF_FEATURES as TenantFeature[];
  beforeEach(() => void table.push("funding"));
  afterEach(() => void table.pop());

  it("starts off for schools only", () => {
    expect(defaultFeaturesFor("SCHOOL").funding).toBe(false);
    expect(defaultFeaturesFor("SCHOOL").jobs).toBe(true);
    for (const type of TENANT_TYPES.filter((t) => t !== "SCHOOL")) expect(defaultFeaturesFor(type).funding).toBe(true);
  });

  it("reads off for a school whose row doesn't mention it, and on where an admin turned it on", () => {
    expect(resolveFeatures("SCHOOL", { feed: true }).funding).toBe(false);
    expect(resolveFeatures("COLLEGE", { feed: true }).funding).toBe(true);
    expect(resolveFeatures("SCHOOL", { funding: true }).funding).toBe(true);
  });

  it("isn't switched on by a partial change to another key", () => {
    const { features } = applyFeatureChange("SCHOOL", { feed: true }, { jobs: false });
    expect(features.funding).toBe(false);
    expect(features).toEqual({ ...defaultFeaturesFor("SCHOOL"), jobs: false });
  });

  it("can be turned on by the school's admin", () => {
    expect(applyFeatureChange("SCHOOL", { feed: true }, { funding: true }).features.funding).toBe(true);
  });

  it("is forced off by retyping to a school, and only keys that were on count as forced", () => {
    const stored = { funding: true, jobs: false };
    const { features, forcedOff } = retypeToSchool("COLLEGE", stored);
    expect(features).toEqual({ ...defaultFeaturesFor("SCHOOL"), jobs: false });
    expect(forcedOff).toContain("funding");
    expect(stored).toEqual({ funding: true, jobs: false });
    // On by default for a college, even with no stored value.
    expect(retypeToSchool("COLLEGE", {}).forcedOff).toContain("funding");
    expect(retypeToSchool("COLLEGE", { funding: false }).forcedOff).not.toContain("funding");
    expect(retypeToSchool("COLLEGE", { funding: false }).features.funding).toBe(false);
  });
});

describe("with a prerequisite", () => {
  const table = FEATURE_PREREQUISITES as Partial<Record<TenantFeature, TenantFeature>>;
  beforeEach(() => {
    table.funding = "jobs";
  });
  afterEach(() => {
    delete table.funding;
  });

  it("reads the dependent off while what it needs is off, whatever is stored", () => {
    expect(resolveFeatures("COLLEGE", { jobs: false, funding: true }).funding).toBe(false);
    expect(resolveFeatures("COLLEGE", { jobs: true, funding: true }).funding).toBe(true);
    expect(resolveFeatures("COLLEGE", { funding: false }).funding).toBe(false);
  });
});

describe("applyFeatureChange", () => {
  it("returns a complete map that changes only the named keys, with no conflict", () => {
    const stored = { feed: false };
    expect(applyFeatureChange("COLLEGE", stored, { jobs: false })).toEqual({ features: { ...allOn(), feed: false, jobs: false }, conflict: null });
    expect(stored).toEqual({ feed: false });
    expect(applyFeatureChange("COLLEGE", stored, {}).features).toEqual({ ...allOn(), feed: false });
  });
});

describe("retypeToSchool", () => {
  it("forces nothing when no school-off key is on, and keeps everything else", () => {
    const stored = { ...defaultFeaturesFor("SCHOOL"), feed: false };
    expect(retypeToSchool("COLLEGE", stored)).toEqual({ features: stored, forcedOff: [] });
  });
});

describe("changedFeatures", () => {
  it("names only the keys the form changed", () => {
    const saved = defaultFeaturesFor("COLLEGE");
    expect(changedFeatures(saved, saved)).toEqual({});
    expect(changedFeatures(saved, { ...saved, jobs: false })).toEqual({ jobs: false });
    expect(changedFeatures({ ...saved, jobs: false }, { ...saved, jobs: true, funding: false })).toEqual({ jobs: true, funding: false });
  });
});
