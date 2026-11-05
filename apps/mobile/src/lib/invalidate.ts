import { tenantKeyPredicate } from "@illuminize/shared";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Marks every cached query of one institution stale (every tenant key carries the slug second, see queryKeys.ts), after
 * an admin action that can change what members see anywhere in the app: moderation, reports, approvals, roles. Queries
 * in use refetch now, the rest when next used.
 */
export function invalidateTenant(qc: QueryClient, slug: string) {
  return qc.invalidateQueries({ predicate: tenantKeyPredicate(slug) });
}
