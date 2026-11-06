import clsx from "clsx";

// The shared status tones (lib/tones.ts). Each has a 1px edge (transparent on the red), so a count keeps its shape where
// forced colours drop the fill; the padding and line height give way to it, so the badge stays 16px tall.
const NAV_BADGE_TONES = {
  // Something unread: white on the danger solid.
  danger: "border-transparent bg-tone-danger-solid text-white",
  // Work waiting for an admin, in the console's amber.
  warning: "border-tone-warning-edge bg-tone-warning-fill text-tone-warning-ink",
};

/** A count on a navigation link. Hidden from screen readers, because the link's own name says it. */
export function NavBadge({ count, tone = "danger", className }: { count: number; tone?: keyof typeof NAV_BADGE_TONES; className?: string }) {
  return (
    <span aria-hidden className={clsx("rounded-full border px-[5px] text-[10px] font-semibold leading-[14px]", NAV_BADGE_TONES[tone], className)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
