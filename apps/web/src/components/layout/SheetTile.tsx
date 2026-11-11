import clsx from "clsx";
import { useId, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { IconChevronRight, NavIcon, type NavIconName } from "@/components/icons";

/** A titled group of tiles in the More sheet: a group (not a landmark) named by its heading. */
export function SheetGroup({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="mb-1 px-3 text-[13px] font-semibold text-slate-500">
        {title}
      </h3>
      {/* role="list" because Tailwind's list-style: none drops the list from Safari's accessibility tree. */}
      <ul role="list" className="space-y-1">
        {children}
      </ul>
    </div>
  );
}

/**
 * A described link in the More sheet (the phone app's More draws the same rows): its icon in a well, the name and a line
 * under it, which is the link's description rather than part of its name: the name is set, as the link's text would
 * take the line in too. `name` replaces the label when the link has a count to say ("Groups, 1 invitation"), and
 * `badge` draws that count. The current link is chosen as the sidebar's is: the wash, a thin ring and the page's ink,
 * with hover only on the others. The walk-through's last screen lists sections with it too, and its `onClick` ends the
 * walk-through on the way. `onPointerEnter` and `onFocus` fetch a section's page ahead (useFetchAhead).
 */
export function SheetTile({
  to,
  icon,
  label,
  description,
  name,
  badge,
  onClick,
  onPointerEnter,
  onFocus,
}: {
  to: string;
  icon: NavIconName;
  label: string;
  description: string;
  name?: string;
  badge?: ReactNode;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onFocus?: () => void;
}) {
  const descriptionId = useId();
  return (
    <li>
      <NavLink
        to={to}
        aria-label={name ?? label}
        aria-describedby={descriptionId}
        onClick={onClick}
        onPointerEnter={onPointerEnter}
        onFocus={onFocus}
        className={({ isActive }) =>
          clsx(
            "group/tile flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ink",
            isActive ? "bg-primary-wash text-page-ink ring-1 ring-inset ring-primary-ring" : "text-slate-800 hover:bg-slate-100",
          )
        }
      >
        {({ isActive }) => (
          <>
            {/* On the wash, the well turns white so the icon, in the ink, still stands out; on the hover's slate-100, which
                is the well's own grey, it turns white too, or the well would melt into the row. */}
            <span
              aria-hidden
              className={clsx(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-[var(--duration-fast)]",
                isActive ? "bg-white text-primary-ink" : "bg-slate-100 text-slate-700 group-hover/tile:bg-white",
              )}
            >
              <NavIcon name={icon} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{label}</span>
              {/* Grey on a tinted surface (the wash, or the hover's slate-100) takes the secondary grey, which reads on any
                  brand's wash: slate-500 is under 4.5:1 on slate-100. */}
              <span id={descriptionId} className={clsx("block text-xs", isActive ? "text-slate-600" : "text-slate-500 group-hover/tile:text-slate-600")}>
                {description}
              </span>
            </span>
            {badge}
            <IconChevronRight size={16} className="text-slate-400" />
          </>
        )}
      </NavLink>
    </li>
  );
}
