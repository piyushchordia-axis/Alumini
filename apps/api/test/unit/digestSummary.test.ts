import { digestSummary, type DigestDto } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** A digest holding `posts` posts, `jobs` jobs and `events` events; only the counts matter to the summary. */
function digest(posts: number, jobs: number, events: number): DigestDto {
  return {
    weekStart: "2026-11-02",
    createdAt: "2026-11-02T03:30:00.000Z",
    posts: Array.from({ length: posts }, (_, i) => ({ id: `p${i}`, excerpt: "Hello", authorName: "Asha", reactionCount: 3, commentCount: 1 })),
    jobs: Array.from({ length: jobs }, (_, i) => ({ id: `j${i}`, title: "Engineer", companyName: "Zylo", location: null, workMode: "REMOTE" as const })),
    events: Array.from({ length: events }, (_, i) => ({ id: `e${i}`, title: "Meetup", startAt: "2026-11-08T12:00:00.000Z", timezone: "Asia/Kolkata", city: "Pune" })),
    newMembers: 4,
  };
}

describe("digestSummary", () => {
  it("names each kind with its count, in the web banner's wording", () => {
    expect(digestSummary(digest(3, 2, 4))).toBe("3 popular posts, 2 new jobs, 4 upcoming events");
  });

  it("is singular for one", () => {
    expect(digestSummary(digest(1, 1, 1))).toBe("1 popular post, 1 new job, 1 upcoming event");
  });

  it("leaves out the kinds the digest has none of", () => {
    expect(digestSummary(digest(2, 0, 1))).toBe("2 popular posts, 1 upcoming event");
    expect(digestSummary(digest(0, 1, 0))).toBe("1 new job");
  });

  it("is empty for a digest with nothing in it, whatever its new-member count", () => {
    expect(digestSummary(digest(0, 0, 0))).toBe("");
  });
});
