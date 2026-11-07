import { rsvpBadge, UPCOMING_EVENTS_SEE_ALL, UPCOMING_EVENTS_STRIP, UPCOMING_EVENTS_TITLE, upcomingEventName } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useId } from "react";
import { Link } from "react-router-dom";
import { EventDateTile } from "@/components/events/EventDateTile";
import { IconEvents } from "@/components/icons";
import { Badge, Card } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";

// The header and the chips have fixed heights (the chips' fits a two-line title, a two-line date and place, and an
// answer, about 120px, with room to spare), so the placeholder takes the strip's own height and nothing under it moves
// when the events come.
const HEADER = "flex min-h-7 items-center justify-between gap-3";
const CHIP = "min-h-32 w-60 shrink-0 rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200";
// On a touch screen the next chip peeking in at the edge says there's more, with no scrollbar to take height. A mouse
// can't swipe sideways, so with one (a narrow desktop window) the list keeps a thin scrollbar to drag, always drawn
// (overflow-x: scroll) so the strip's height doesn't depend on whether its chips overflow, and the placeholder holds
// the same scrollbar's room.
const SCROLLBAR = "pointer-fine:overflow-x-scroll pointer-fine:[scrollbar-width:thin]";
const NO_SCROLLBAR = "not-pointer-fine:[scrollbar-width:none] not-pointer-fine:[&::-webkit-scrollbar]:hidden";

/**
 * The phone feed's next few events while Events is on (Events on the bar included, as at a school), each a link to its
 * page with its day, title, when and where, and the member's answer, then See all. Nothing when nothing is coming, or
 * when they can't be fetched; a placeholder of its height while they load. Keyed under ["events", slug], so an RSVP or
 * any other change to an event refreshes it. A labelled region of plain cards, never an article, so the feed's first
 * article stays a post. The phone app's feed has the same strip.
 */
export function UpcomingEvents({ slug }: { slug: string }) {
  const { tenant } = useMembership();
  const headingId = useId();
  const on = tenant.settings.features.events;
  const upcoming = useQuery({ queryKey: qk.events(slug, UPCOMING_EVENTS_STRIP), queryFn: () => api.events.list(slug, UPCOMING_EVENTS_STRIP), enabled: on, staleTime: 60_000 });
  // Switched off while the app was open, a cached answer would still be there.
  if (!on) return null;
  if (!upcoming.data) return upcoming.isLoading ? <UpcomingEventsPlaceholder /> : null;
  const events = upcoming.data.data;
  if (events.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <Card className="p-3">
        <div className={HEADER}>
          <h2 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <IconEvents size={16} className="text-primary-ink" /> {UPCOMING_EVENTS_TITLE}
          </h2>
          {/* A full 44px target, drawn no taller than the heading. */}
          <Link
            to={`/t/${slug}/app/events`}
            aria-label={UPCOMING_EVENTS_SEE_ALL.name}
            className="-my-2 -mr-2 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-primary-ink hover:underline focus-visible:outline-2 focus-visible:outline-primary-ink"
          >
            {UPCOMING_EVENTS_SEE_ALL.label}
          </Link>
        </div>
        {/* role="list" because Tailwind's list-style: none drops the list from Safari's accessibility tree. */}
        <ul role="list" className={clsx("mt-2 flex snap-x gap-2 overflow-x-auto motion-safe:scroll-smooth", SCROLLBAR, NO_SCROLLBAR)}>
          {events.map((e) => {
            const when = formatDateTime(e.startAt, e.timezone);
            const rsvp = rsvpBadge(e.myRsvp);
            return (
              <li key={e.id} className="w-60 shrink-0 snap-start">
                <Link
                  to={`/t/${slug}/app/events/${e.id}`}
                  aria-label={upcomingEventName(e, when)}
                  className={clsx(CHIP, "flex h-full gap-2.5 p-2.5 transition-colors duration-[var(--duration-fast)] hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ink")}
                >
                  <EventDateTile startAt={e.startAt} timezone={e.timezone} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900 [overflow-wrap:anywhere]">{e.title}</span>
                    <span className="mt-0.5 line-clamp-2 text-xs leading-4 text-slate-500">
                      {when} · {e.city}
                    </span>
                    {rsvp && (
                      // A flex box, so the badge's height is all it adds, with no line of text around it.
                      <span className="mt-auto flex pt-1.5">
                        <Badge tone={rsvp.tone}>{rsvp.label}</Badge>
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

/** The strip's shape while its events load: no words and nothing to reach, so screen readers and keyboards skip it. */
function UpcomingEventsPlaceholder() {
  return (
    <div aria-hidden data-testid="upcoming-events-loading">
      <Card className="p-3">
        <div className={HEADER}>
          <span className="h-3.5 w-36 rounded-full bg-slate-100" />
        </div>
        {/* The scrollbar's room, with a mouse, around a row that never overflows, so there's nothing to scroll or focus. */}
        <div className={clsx("mt-2", SCROLLBAR)}>
          <div className="flex gap-2 overflow-hidden">
            <span className={CHIP} />
            <span className={CHIP} />
          </div>
        </div>
      </Card>
    </div>
  );
}
