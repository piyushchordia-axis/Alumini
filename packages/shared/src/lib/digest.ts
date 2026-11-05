import type { DigestDto } from "../types/dto";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a digest holds, for the banners that link to it on both apps: "3 popular posts, 1 new job, 2 upcoming events".
 * Kinds it has none of are left out, so an empty digest gives "".
 */
export function digestSummary(d: Pick<DigestDto, "posts" | "jobs" | "events">): string {
  return [
    d.posts.length > 0 && count(d.posts.length, "popular post", "popular posts"),
    d.jobs.length > 0 && count(d.jobs.length, "new job", "new jobs"),
    d.events.length > 0 && count(d.events.length, "upcoming event", "upcoming events"),
  ]
    .filter(Boolean)
    .join(", ");
}
