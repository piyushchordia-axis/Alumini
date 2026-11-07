import { EXPLORE_TITLE } from "@illuminize/shared";
import { useId } from "react";
import { Link } from "react-router-dom";
import { NavIcon } from "@/components/icons";
import { NavBadge } from "@/components/layout/NavBadge";
import { useMemberSections } from "@/hooks/useMemberSections";

/**
 * The phone feed's shortcuts to the sections behind More, in priority order (the bar's, continued: More groups them
 * under Connect and Community) and with More's badges, so a member sees what else is here without opening it. The chips
 * wrap rather than scroll, so none is out of sight. A labelled region, never a nav: the bar is the page's only Main
 * navigation, and e2e finds the bar's links inside a nav. Nothing when there's nothing behind More. The phone app's feed
 * has the same row.
 */
export function ExploreRow() {
  const headingId = useId();
  const { overflow, toLink, badgeFor } = useMemberSections();
  if (overflow.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 text-sm font-semibold text-slate-900">
        {EXPLORE_TITLE}
      </h2>
      {/* role="list" because Tailwind's list-style: none drops the list from Safari's accessibility tree. */}
      <ul role="list" className="flex flex-wrap gap-2">
        {overflow.map((section) => {
          const link = toLink(section);
          const badge = badgeFor(section);
          return (
            <li key={section}>
              {/* Named as the sheet's tile is, so it says what the badge counts ("Groups, 1 invitation"). */}
              <Link
                to={link.to}
                aria-label={badge?.label ?? link.label}
                className="flex min-h-11 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] py-2 pl-3 pr-4 text-sm font-semibold text-slate-900 shadow-[var(--shadow-1)] transition-colors duration-[var(--duration-fast)] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ink"
              >
                <NavIcon name={link.icon} size={18} className="text-primary-ink" />
                <span>{link.label}</span>
                {badge && <NavBadge count={badge.count} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
