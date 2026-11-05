import { keepPreviousData, useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/** The console's list of profile questions, with or without the archived ones (the web console's key). */
export const adminProfileFieldsKey = (slug: string, showArchived: boolean) => [...qk.admin.profileFields(slug), { showArchived }] as const;

/** The console's profile questions. Showing or hiding the archived ones keeps the list on screen while the other loads. */
export function useAdminProfileFields(slug: string, showArchived: boolean) {
  return useQuery({ queryKey: adminProfileFieldsKey(slug, showArchived), queryFn: () => api.admin.profileFields.list(slug, showArchived), placeholderData: keepPreviousData });
}

/**
 * After a question is added, changed, moved, archived or restored: the console's lists (both toggles, by prefix), the
 * member forms' questions, and the directory's filters, which a question's filter switch changes.
 */
export function refreshProfileFields(qc: QueryClient, slug: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.admin.profileFields(slug) }),
    qc.invalidateQueries({ queryKey: qk.profileFields(slug) }),
    qc.invalidateQueries({ queryKey: qk.directoryFilters(slug) }),
  ]);
}
