import type { TenantFeatures } from "../constants";
import type { DirectoryCardDto } from "../types/dto";
import { homeSection, splitSections, type MemberSection } from "./sections";

/**
 * Cards in each page of the directory, on both apps. The Directory screen and the fetch ahead of it ask with this one
 * size, under one key, so the screen opens on the cards fetched ahead.
 */
export const DIRECTORY_PAGE_SIZE = 24;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * A member's card from the directory's cached lists, to draw their profile's header while the profile itself loads.
 * `datas` are what every query under the directory's key holds (TanStack's getQueriesData): each list's pages, whose
 * `data` holds the cards, and its filters, which hold none and are passed over, as is anything not yet answered. The
 * first card found wins; undefined when no list holds one with `id`.
 */
export function cardInPages<T extends { id: string } = DirectoryCardDto>(datas: readonly unknown[], id: string): T | undefined {
  if (!id) return undefined;
  for (const data of datas) {
    if (!isRecord(data) || !Array.isArray(data.pages)) continue;
    for (const page of data.pages) {
      if (!isRecord(page) || !Array.isArray(page.data)) continue;
      const card = page.data.find((row) => isRecord(row) && row.id === id);
      if (card) return card as T;
    }
  }
  return undefined;
}

/**
 * Whether a profile's own query is still waiting for its first answer (offline too, where it is paused), the only time
 * its header is drawn from a cached card. Once it has answered, even with an error, it stays answered: a query with no
 * data goes back to pending while a retry is on its way (TanStack), and a card then would show a member the server may
 * just have refused.
 */
export function awaitingFirstAnswer(query: { isPending: boolean; isFetched: boolean }): boolean {
  return query.isPending && !query.isFetched;
}

/**
 * The section whose first answer sets the phone fetching the directory's first page ahead: the member's home section,
 * the one they open on, so the fetch never races what they came to see. Null with the directory off, when it is home
 * itself (it loads its own cards), or with no home section (every section off).
 */
export function directoryPrefetchSection(features: TenantFeatures): MemberSection | null {
  const home = homeSection(features);
  if (!home || home === "directory") return null;
  // The directory's rule doesn't depend on chat, so asking as if the member can't use it changes nothing.
  const { bar, overflow } = splitSections(features, false);
  return bar.includes("directory") || overflow.includes("directory") ? home : null;
}
