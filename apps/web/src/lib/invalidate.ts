import type { QueryClient } from "@tanstack/react-query";

/**
 * Marks every cached query of one institution stale (all tenant query keys carry the slug second, see queryKeys.ts).
 * Used after admin actions that can change what members see anywhere in the app: moderation, reports, member
 * approval/suspension, role or profile changes. Only queries on screen refetch straight away.
 */
export function invalidateTenant(qc: QueryClient, slug: string) {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === slug });
}
