import { PROFILE_DETAILS_OUTLINE } from "@illuminize/shared";
import { SkeletonLines, SkeletonStatus } from "@/components/ui";

/**
 * Stands in for a profile's details (ProfileDetails, and Message and Block with them) under its header drawn from a
 * directory card while the full profile loads (MemberProfilePage): groups of grey lines set off by hairlines, under a
 * status saying "Loading…". `className` places it where ProfileDetails goes.
 */
export function ProfileDetailsOutline({ className }: { className?: string }) {
  return (
    <SkeletonStatus className={className}>
      {PROFILE_DETAILS_OUTLINE.map((lines, row) => (
        <SkeletonLines key={row} widths={lines} row={row} className={row > 0 ? "mt-5 border-t border-slate-100 pt-5" : undefined} />
      ))}
    </SkeletonStatus>
  );
}
