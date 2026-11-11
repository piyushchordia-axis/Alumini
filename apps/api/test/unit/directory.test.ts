import { awaitingFirstAnswer, cardInPages, directoryPrefetchSection, homeSection, TENANT_FEATURES, type DirectoryCardDto, type TenantFeature, type TenantFeatures } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const card = (id: string, fullName = `Member ${id}`): DirectoryCardDto => ({
  id,
  fullName,
  startYear: 2008,
  batchYear: 2012,
  professionType: "EMPLOYED",
  companyName: null,
  designation: null,
  city: null,
  country: null,
  avatarUrl: null,
  role: "MEMBER",
  isOpenToWork: false,
  headline: null,
  isMentor: false,
  openTo: [],
});

/** An infinite list's data as TanStack caches it: its pages of cards, each with the cursor to the next. */
const list = (...pages: DirectoryCardDto[][]) => ({ pages: pages.map((data, i) => ({ data, nextCursor: i < pages.length - 1 ? `c${i + 1}` : null })), pageParams: pages.map((_, i) => (i ? `c${i}` : undefined)) });

/** The directory's filters, which sit under the same key as its lists and hold no cards. */
const filters = { cities: ["Mumbai"], countries: ["IN"], companies: ["Google"], industries: [], skills: [], fieldsOfStudy: [], years: [2012], fields: [] };

describe("cardInPages", () => {
  it("finds a member's card in any page of any list cached under the directory's key", () => {
    const priya = card("b2", "Priya Nair");
    const datas = [list([card("a1")]), list([card("b1")], [priya, card("b3")])];
    expect(cardInPages(datas, "b2")).toBe(priya);
  });

  it("passes over the filters, lists not yet answered and anything that isn't pages of cards", () => {
    const sneha = card("s1", "Sneha Kulkarni");
    const datas = [filters, undefined, null, "text", { pages: "nope" }, { pages: [null, { data: "nope" }, { data: [null, 7] }] }, list([sneha])];
    expect(cardInPages(datas, "s1")).toBe(sneha);
  });

  it("takes the first card found when two lists hold the member, as a search and the whole directory do", () => {
    const fromSearch = card("p1", "Priya Nair");
    const fromAll = { ...card("p1", "Priya Nair"), headline: "Product manager at Google" };
    expect(cardInPages([list([fromSearch]), list([fromAll])], "p1")).toBe(fromSearch);
  });

  it("finds nothing for a member no list holds, in an empty cache, or for no id", () => {
    const datas = [list([card("a1")]), filters];
    expect(cardInPages(datas, "z9")).toBeUndefined();
    expect(cardInPages([], "a1")).toBeUndefined();
    expect(cardInPages(datas, "")).toBeUndefined();
  });
});

describe("awaitingFirstAnswer", () => {
  it("is true only while a profile's query waits for its first answer, online or paused offline", () => {
    expect(awaitingFirstAnswer({ isPending: true, isFetched: false })).toBe(true);
  });

  it("is false once it has answered: with the profile, or with an error, a retry from which is pending again", () => {
    expect(awaitingFirstAnswer({ isPending: false, isFetched: true })).toBe(false);
    // TanStack puts a query with no data back to pending while a retry is on its way; it has still answered.
    expect(awaitingFirstAnswer({ isPending: true, isFetched: true })).toBe(false);
  });
});

/** Everything off except the named keys, so a rule reading the wrong key shows up. */
const only = (...on: TenantFeature[]) => Object.fromEntries(TENANT_FEATURES.map((f) => [f, on.includes(f)])) as TenantFeatures;
const all = only(...TENANT_FEATURES);

describe("directoryPrefetchSection", () => {
  it("is the home section, the one the member opens on, while the directory is on and isn't home", () => {
    expect(directoryPrefetchSection(all)).toBe("feed");
    expect(directoryPrefetchSection(only("jobs", "directory", "events"))).toBe("jobs");
  });

  it("is none with the directory off, when the directory is home itself, or with every section off", () => {
    expect(directoryPrefetchSection(only("feed", "jobs", "events", "businesses", "funding", "messaging", "groups", "mentorship"))).toBeNull();
    expect(directoryPrefetchSection(only("directory", "events", "funding"))).toBeNull();
    expect(directoryPrefetchSection(only())).toBeNull();
  });

  it("is only ever Feed or Jobs, the two tab roots that ask, at every mix of switches", () => {
    const seen = new Set<string | null>();
    for (let mask = 0; mask < 2 ** TENANT_FEATURES.length; mask++) {
      const features = only(...TENANT_FEATURES.filter((_, i) => mask & (1 << i)));
      const section = directoryPrefetchSection(features);
      seen.add(section);
      if (section) expect(section).toBe(homeSection(features));
    }
    expect([...seen].sort()).toEqual(["feed", "jobs", null].sort());
  });
});
