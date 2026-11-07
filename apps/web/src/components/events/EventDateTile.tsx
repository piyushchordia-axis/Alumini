import clsx from "clsx";

const SIZES = {
  md: { box: "size-16 rounded-lg", day: "text-2xl" },
  sm: { box: "size-12 rounded-md", day: "text-xl" },
} as const;

/**
 * An event's day, on its card and on the phone feed's Upcoming events strip, as the phone app draws it: on the brand's
 * wash, the month in the grey that reads on any wash and the day in the ink, each at 4.5:1 for any institution colour.
 * Screen readers skip it, as the line beside it, or the link's name, gives the date in full.
 */
export function EventDateTile({ startAt, timezone, size = "md" }: { startAt: string; timezone: string; size?: keyof typeof SIZES }) {
  const d = new Date(startAt);
  return (
    <span aria-hidden className={clsx("flex shrink-0 flex-col items-center justify-center bg-primary-wash", SIZES[size].box)}>
      <span className="text-xs font-semibold uppercase leading-4 tracking-wide text-slate-600">{d.toLocaleString(undefined, { month: "short", timeZone: timezone })}</span>
      <span className={clsx("font-bold leading-none text-primary-ink", SIZES[size].day)}>{d.toLocaleString(undefined, { day: "numeric", timeZone: timezone })}</span>
    </span>
  );
}
