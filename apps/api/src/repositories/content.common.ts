import type { ModerationStatus } from "@illuminize/shared";

export interface ModerationPatch {
  moderationStatus: ModerationStatus;
  moderatedByUserId: string | null;
  moderatedAt: Date | null;
  moderationNote: string | null;
}

export const escapeLike = (s: string) => s.replace(/[%_]/g, "\\$&");
