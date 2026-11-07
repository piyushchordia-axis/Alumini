import {
  EMPTY_CREATE_LABELS,
  SEEKERS_EMPTY,
  TENANT_FEATURES,
  businessesEmpty,
  directoryEmpty,
  eventsEmpty,
  feedEmpty,
  fundingEmpty,
  groupsEmpty,
  jobsEmpty,
  mayCreate,
  notificationsEmpty,
  peersWord,
  referralsReceivedEmpty,
  tenantSearchEmpty,
  type EmptyCopy,
  type EmptyCreate,
  type EmptyViewer,
  type TenantFeature,
  type TenantFeatures,
  type TenantType,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** Everything off except the named keys, so a rule reading the wrong key shows up. */
const only = (...on: TenantFeature[]) => Object.fromEntries(TENANT_FEATURES.map((f) => [f, on.includes(f)])) as TenantFeatures;

const viewer = ({ type = "UNIVERSITY" as TenantType, features = only(...TENANT_FEATURES), chatEligible = true, shortName = "Demo U" as string | null } = {}): EmptyViewer => ({
  tenant: { type, name: "Demo University", shortName, settings: { features } },
  membership: { chatEligible },
});

/** Each list empty with nothing filtered, and with a filter or a search, with everything on. */
const unfiltered = (v: EmptyViewer): Record<string, EmptyCopy> => ({
  feed: feedEmpty(v),
  jobs: jobsEmpty(v, { canRefer: false, filtered: false }),
  referrals: referralsReceivedEmpty(v, false),
  businesses: businessesEmpty(v, false),
  events: eventsEmpty(v, "upcoming"),
  raising: fundingEmpty(v, "SEEKING"),
  investing: fundingEmpty(v, "OFFERING"),
  openGroups: groupsEmpty(v, "discover", false),
  myGroups: groupsEmpty(v, "mine", false),
});
const filtered = (v: EmptyViewer): Record<string, EmptyCopy> => ({
  jobs: jobsEmpty(v, { canRefer: false, filtered: true }),
  canRefer: jobsEmpty(v, { canRefer: true, filtered: true }),
  businesses: businessesEmpty(v, true),
  directory: directoryEmpty(true),
  groups: groupsEmpty(v, "discover", true),
  institutions: tenantSearchEmpty(true),
});

describe("peersWord", () => {
  it("is fellow members at a community and batchmates at a school, college or university", () => {
    expect(peersWord("OTHER")).toBe("fellow members");
    for (const type of ["UNIVERSITY", "COLLEGE", "SCHOOL"] as const) expect(peersWord(type)).toBe("batchmates");
  });

  it("is what the lists that address the other members say", () => {
    expect(feedEmpty(viewer({ type: "OTHER" })).description).toBe("Be the first to share an update with your fellow members.");
    expect(jobsEmpty(viewer({ type: "OTHER" }), { canRefer: false, filtered: false }).description).toBe("Know of a role? Post it for your fellow members.");
    expect(businessesEmpty(viewer({ type: "OTHER" }), false).description).toBe("Run a business? Add it for your fellow members.");
    expect(businessesEmpty(viewer({ type: "COLLEGE" }), false).description).toBe("Run a business? Add it for your batchmates.");
  });
});

describe("the titles e2e looks for", () => {
  it("stay word for word", () => {
    expect(directoryEmpty(true).title).toBe("No members match");
    expect(businessesEmpty(viewer(), true).title).toBe("No businesses match");
    expect(referralsReceivedEmpty(viewer(), false).title).toBe("No referral requests yet");
    expect(referralsReceivedEmpty(viewer(), true).title).toBe("No referral requests yet");
  });

  it("keep the titles the apps showed before", () => {
    expect(feedEmpty(viewer()).title).toBe("No posts yet at Demo U");
    expect(feedEmpty(viewer({ shortName: null })).title).toBe("No posts yet at Demo University");
    expect(jobsEmpty(viewer(), { canRefer: true, filtered: false }).title).toBe("No openings can refer right now");
    expect(jobsEmpty(viewer(), { canRefer: false, filtered: true }).title).toBe("No openings match");
    expect(jobsEmpty(viewer(), { canRefer: false, filtered: false }).title).toBe("No openings right now");
    expect(SEEKERS_EMPTY.title).toBe("Nobody is looking right now");
    expect(businessesEmpty(viewer(), false).title).toBe("No businesses listed yet");
    expect(eventsEmpty(viewer(), "upcoming").title).toBe("Nothing planned yet");
    expect(eventsEmpty(viewer(), "past").title).toBe("No past events");
    expect(fundingEmpty(viewer(), "SEEKING").title).toBe("No one is raising right now");
    expect(fundingEmpty(viewer(), "OFFERING").title).toBe("No investors listed yet");
    expect(groupsEmpty(viewer(), "discover", true).title).toBe("No groups match");
    expect(groupsEmpty(viewer(), "discover", false).title).toBe("No open groups yet");
    expect(groupsEmpty(viewer(), "mine", false).title).toBe("You're not in any groups yet");
    expect(notificationsEmpty(viewer()).title).toBe("You're all caught up");
    expect(tenantSearchEmpty(true).title).toBe("No institutions found");
    expect(tenantSearchEmpty(false).title).toBe("No institutions found");
  });
});

describe("every empty list", () => {
  it("says what it holds", () => {
    const all = [...Object.values(unfiltered(viewer())), ...Object.values(filtered(viewer())), SEEKERS_EMPTY, eventsEmpty(viewer(), "past"), directoryEmpty(false), notificationsEmpty(viewer()), tenantSearchEmpty(false)];
    for (const copy of all) expect(copy.description, copy.title).toMatch(/\S.*[.?]$/);
    expect(notificationsEmpty(viewer()).description).toBe("Replies, requests and news from Demo U show up here.");
  });

  it("offers to clear a search or a filter that found nothing, as a live result, and nothing else", () => {
    for (const [name, copy] of Object.entries(filtered(viewer()))) {
      expect(copy.live, name).toBe(true);
      // Groups: the search is what to change, so creating one is the outline way on.
      if (name === "groups") expect(copy.action, name).toEqual({ label: "Create group", kind: "create", variant: "outline" });
      else expect(copy.action?.kind, name).toBe("showAll");
    }
    expect(jobsEmpty(viewer(), { canRefer: true, filtered: false }).action?.label).toBe("Show all openings");
    expect(jobsEmpty(viewer(), { canRefer: false, filtered: true }).action?.label).toBe("Show all openings");
    expect(businessesEmpty(viewer(), true).action?.label).toBe("Show all businesses");
    expect(directoryEmpty(true).action).toEqual({ label: "Show all members", kind: "showAll", variant: "primary" });
    expect(tenantSearchEmpty(true).action).toEqual({ label: "Clear search", kind: "showAll", variant: "outline" });
  });

  it("offers to add the first one, under the screen's own name for it, when nothing is filtered", () => {
    const labels = Object.fromEntries(Object.entries(unfiltered(viewer())).map(([name, copy]) => [name, copy.action]));
    const primary = (label: string) => ({ label, kind: "create", variant: "primary" });
    expect(labels).toEqual({
      feed: primary("Write a post"),
      jobs: primary("Post a job"),
      referrals: primary("Post a job"),
      businesses: primary("Add a business"),
      events: primary("Plan a gathering"),
      raising: primary("I'm raising"),
      investing: primary("I'm investing"),
      openGroups: primary("Create group"),
      myGroups: primary("Create group"),
    });
    for (const copy of Object.values(unfiltered(viewer()))) expect(copy.live, copy.title).toBe(false);
  });

  it("offers nothing where there's nothing to add from there", () => {
    for (const copy of [SEEKERS_EMPTY, eventsEmpty(viewer(), "past"), directoryEmpty(false), notificationsEmpty(viewer()), tenantSearchEmpty(false)]) {
      expect(copy.action, copy.title).toBeUndefined();
      expect(copy.live, copy.title).toBe(false);
    }
  });
});

describe("mayCreate and the create actions", () => {
  const needs: Record<EmptyCreate, TenantFeature> = { post: "feed", job: "jobs", business: "businesses", event: "events", group: "groups", raising: "funding", investing: "funding" };

  it("needs each section's own switch", () => {
    for (const [what, key] of Object.entries(needs) as [EmptyCreate, TenantFeature][]) {
      expect(mayCreate(what, viewer({ features: only(key) })), `${what} with only ${key} on`).toBe(true);
      expect(mayCreate(what, viewer({ features: only(...TENANT_FEATURES.filter((f) => f !== key)) })), `${what} with ${key} off`).toBe(false);
    }
  });

  it("lets a current pupil post and list, but not create a group, which is a kind of chat", () => {
    const pupil = viewer({ type: "SCHOOL", chatEligible: false });
    for (const what of ["post", "job", "business", "event", "raising", "investing"] as const) expect(mayCreate(what, pupil), what).toBe(true);
    expect(mayCreate("group", pupil)).toBe(false);
    expect(groupsEmpty(pupil, "mine", false).action).toBeUndefined();
    expect(groupsEmpty(pupil, "discover", false).action).toBeUndefined();
    expect(groupsEmpty(pupil, "discover", true).action).toBeUndefined();
  });

  it("leaves the action out, and the words in, while its section is off", () => {
    const off = viewer({ features: only("directory", "messaging") });
    for (const [name, copy] of Object.entries(unfiltered(off))) {
      expect(copy.action, name).toBeUndefined();
      expect(copy).toEqual({ ...unfiltered(viewer())[name], action: undefined });
    }
  });

  it("uses the screens' own labels", () => {
    expect(EMPTY_CREATE_LABELS).toEqual({
      post: "Write a post",
      job: "Post a job",
      business: "Add a business",
      event: "Plan a gathering",
      group: "Create group",
      raising: "I'm raising",
      investing: "I'm investing",
    });
  });
});

describe("referralsReceivedEmpty", () => {
  it("as a way out offers only what's needed to leave, so no Post a job, and says so", () => {
    expect(referralsReceivedEmpty(viewer(), true)).toEqual({ title: "No referral requests yet", description: "Requests about the jobs you post show here.", live: false });
    // A member who can't use referrals because they're a pupil, with Jobs on: still a way out.
    expect(referralsReceivedEmpty(viewer({ type: "SCHOOL", chatEligible: false }), true).action).toBeUndefined();
  });

  it("otherwise explains how requests arrive, in the form's words, and offers to post a job", () => {
    expect(referralsReceivedEmpty(viewer(), false)).toEqual({
      title: "No referral requests yet",
      description: "When you post a job and tick “I can refer people for this job”, members can ask you for a referral. Their requests wait here for your answer.",
      action: { label: "Post a job", kind: "create", variant: "primary" },
      live: false,
    });
  });
});

describe("tenantSearchEmpty", () => {
  it("suggests another search only while there is one", () => {
    expect(tenantSearchEmpty(true).description).toBe("Try a different search, or ask your alumni office to join Illuminize.");
    expect(tenantSearchEmpty(false).description).toBe("Ask your alumni office to join Illuminize.");
  });
});
