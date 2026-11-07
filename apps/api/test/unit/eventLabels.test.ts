import {
  EXPLORE_TITLE,
  eventListQuerySchema,
  HUB_GROUP_TITLES,
  MORE_HUB_ROWS,
  MORE_HUB_YOU_TITLE,
  SECTION_LABELS,
  UPCOMING_EVENTS_SEE_ALL,
  UPCOMING_EVENTS_STRIP,
  UPCOMING_EVENTS_TITLE,
  upcomingEventName,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

describe("UPCOMING_EVENTS_STRIP", () => {
  it("asks the events list for the next three, as the API reads it", () => {
    expect(UPCOMING_EVENTS_STRIP).toEqual({ scope: "upcoming", limit: 3 });
    // Nothing the schema would drop or default differently: the API answers exactly what the strip asks.
    expect(eventListQuerySchema.parse(UPCOMING_EVENTS_STRIP)).toEqual({ scope: "upcoming", limit: 3 });
    // As a query string, the way the client sends it.
    expect(eventListQuerySchema.parse(Object.fromEntries(Object.entries(UPCOMING_EVENTS_STRIP).map(([k, v]) => [k, String(v)])))).toEqual({ scope: "upcoming", limit: 3 });
  });
});

describe("UPCOMING_EVENTS_TITLE and See all", () => {
  // Both apps name the strip's region by its title, and e2e finds it, and its links, by name.
  it("names the strip Upcoming events, which no section, group or row of More, nor Explore, is called", () => {
    expect(UPCOMING_EVENTS_TITLE).toBe("Upcoming events");
    const navNames = [...Object.values(SECTION_LABELS), ...Object.values(HUB_GROUP_TITLES), MORE_HUB_YOU_TITLE, ...Object.values(MORE_HUB_ROWS).map((r) => r.label), EXPLORE_TITLE];
    expect(navNames).not.toContain(UPCOMING_EVENTS_TITLE);
  });

  it("shows See all, named in full with the words it shows first, and never just Events, the section's own name", () => {
    expect(UPCOMING_EVENTS_SEE_ALL).toEqual({ label: "See all", name: "See all events" });
    expect(UPCOMING_EVENTS_SEE_ALL.name.startsWith(UPCOMING_EVENTS_SEE_ALL.label)).toBe(true);
    expect(UPCOMING_EVENTS_SEE_ALL.name).not.toBe(SECTION_LABELS.events);
  });
});

describe("upcomingEventName", () => {
  const event = { title: "Mumbai alumni coffee meetup", city: "Mumbai", myRsvp: null };
  const when = "16 Nov 2026, 11:00 am";

  it("says the title, when and where, the title first, as the chip shows them", () => {
    expect(upcomingEventName(event, when)).toBe("Mumbai alumni coffee meetup, 16 Nov 2026, 11:00 am, Mumbai");
    // e2e reads the title back as the name's first part.
    expect(upcomingEventName(event, when).split(", ")[0]).toBe(event.title);
  });

  it("ends with the member's answer, as its badge says it", () => {
    expect(upcomingEventName({ ...event, myRsvp: "YES" }, when)).toBe("Mumbai alumni coffee meetup, 16 Nov 2026, 11:00 am, Mumbai, You: yes");
    expect(upcomingEventName({ ...event, myRsvp: "MAYBE" }, when)).toMatch(/, You: maybe$/);
    expect(upcomingEventName({ ...event, myRsvp: "NO" }, when)).toMatch(/, You: no$/);
  });

  it("leaves out what's empty rather than saying a blank", () => {
    expect(upcomingEventName({ ...event, city: "" }, when)).toBe("Mumbai alumni coffee meetup, 16 Nov 2026, 11:00 am");
    expect(upcomingEventName(event, "")).toBe("Mumbai alumni coffee meetup, Mumbai");
  });
});
