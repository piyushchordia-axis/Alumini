import type { ModerationStatus } from "@illuminize/shared";

export interface ModerationPatch {
  moderationStatus: ModerationStatus;
  moderatedByUserId: string | null;
  moderatedAt: Date | null;
  moderationNote: string | null;
}

/** Backslash too: it is ILIKE's escape character, so one left bare would change what follows it, or fail at the end of a pattern. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
