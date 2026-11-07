import type { EventListQuery } from "../schemas/events";
import type { EventDto } from "../types/dto";
import { rsvpBadge } from "./rsvp";

/**
 * What the phone feed's Upcoming events strip asks the events list for: the next three that haven't begun, soonest
 * first, which the API gives with cancelled, held and past events already left out. Both apps key it under
 * `["events", slug]` (`qk.events(slug, UPCOMING_EVENTS_STRIP)`), so every change to an event (an RSVP, a cancellation,
 * a new one) refreshes it along with the Events lists. Those are infinite queries under the same prefix and this one
 * isn't, so nothing may write to the prefix as if every entry had pages.
 */
export const UPCOMING_EVENTS_STRIP = { scope: "upcoming", limit: 3 } as const satisfies Partial<EventListQuery>;

/** The strip's heading, and its region's name. No section, group or row of More is called it (sections.test.ts). */
export const UPCOMING_EVENTS_TITLE = "Upcoming events";

/** The strip's way to the rest: "See all" on screen, named in full, starting with the words it shows. */
export const UPCOMING_EVENTS_SEE_ALL = { label: "See all", name: "See all events" } as const;

/**
 * An event's link on the strip, named for everything the chip says: its title, when, where, then the member's answer
 * when they've given one ("Mumbai alumni coffee meetup, 16 Nov 2026, 11:00 am, Mumbai, You: yes"). `when` is the app's
 * own `formatDateTime` of its start, in its time zone, as the chip writes it.
 */
export function upcomingEventName(event: Pick<EventDto, "title" | "city" | "myRsvp">, when: string): string {
  return [event.title, when, event.city, rsvpBadge(event.myRsvp)?.label].filter((part) => !!part).join(", ");
}
