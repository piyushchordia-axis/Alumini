import type { RsvpStatus, StatusTone } from "../constants";
import type { EventDto } from "../types/dto";

/** The RSVP buttons, in the order both apps show them. */
export const RSVP_CHOICES: readonly RsvpStatus[] = ["YES", "MAYBE", "NO"];
export const RSVP_LABELS: Readonly<Record<RsvpStatus, string>> = { YES: "I'm going", MAYBE: "Maybe", NO: "Can't make it" };
/** I'm going's label once the event has as many going as it takes, for anyone not already among them. */
export const RSVP_FULL_LABEL = "Full";
/** The tone a chosen answer is drawn in (STATUS_TONES): its button on the event's page and its badge on the event's card. */
export const RSVP_TONES: Readonly<Record<RsvpStatus, StatusTone>> = { YES: "success", MAYBE: "warning", NO: "neutral" };
/** The member's own answer, as an event's card shows it. */
export const MY_RSVP_LABELS: Readonly<Record<RsvpStatus, string>> = { YES: "You: yes", MAYBE: "You: maybe", NO: "You: no" };
/** What screen readers call the row of RSVP buttons. */
export const RSVP_GROUP_LABEL = "Your RSVP";
/** Under the buttons once the event has begun. */
export const RSVP_CLOSED_TEXT = "RSVPs are closed: this event has started.";

export const myRsvpLabel = (status: RsvpStatus): string => MY_RSVP_LABELS[status];

/** The badge an event's card shows for the member's answer, or null when they haven't given one. */
export function rsvpBadge(status: RsvpStatus | null | undefined): { label: string; tone: StatusTone } | null {
  return status ? { label: MY_RSVP_LABELS[status], tone: RSVP_TONES[status] } : null;
}

export interface RsvpChoice {
  value: RsvpStatus;
  label: string;
  tone: StatusTone;
  /** The member's answer now. Pressing it again takes the answer back. */
  chosen: boolean;
  /** I'm going, with no places left for this member: shown as "Full", and it can't be chosen. */
  full: boolean;
}

/** The RSVP buttons for an event, as the member sees them. */
export function rsvpChoices(event: Pick<EventDto, "maxAttendees" | "yesCount" | "myRsvp">): RsvpChoice[] {
  const full = !!event.maxAttendees && event.yesCount >= event.maxAttendees && event.myRsvp !== "YES";
  return RSVP_CHOICES.map((value) => {
    const isFull = value === "YES" && full;
    return { value, label: isFull ? RSVP_FULL_LABEL : RSVP_LABELS[value], tone: RSVP_TONES[value], chosen: event.myRsvp === value, full: isFull };
  });
}

const hasStarted = (event: Pick<EventDto, "startAt">, now: number | Date) => new Date(event.startAt).getTime() <= Number(now);

/**
 * Whether an event takes answers at `now`, taking one back included: approved, not cancelled and not yet begun. The
 * apps pass the time the page opened, so the buttons don't close under a member's finger.
 */
export function rsvpsOpen(event: Pick<EventDto, "isCancelled" | "startAt" | "moderationStatus">, now: number | Date): boolean {
  return !event.isCancelled && event.moderationStatus === "APPROVED" && !hasStarted(event, now);
}

/** The line under the buttons once the event has begun (RSVP_CLOSED_TEXT), or null. A cancelled event says so in its badge. */
export function rsvpClosedText(event: Pick<EventDto, "isCancelled" | "startAt">, now: number | Date): string | null {
  return !event.isCancelled && hasStarted(event, now) ? RSVP_CLOSED_TEXT : null;
}
