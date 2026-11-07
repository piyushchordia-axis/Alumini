import { EVENT_KIND_LABELS, nameWithYears, rsvpBadge, type EventDto } from "@illuminize/shared";
import { EventDateTile } from "@/components/events/EventDateTile";
import { ContentCard } from "@/components/moderation/ContentCard";
import { ModerationCardNote, ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export function EventCard({ slug, event }: { slug: string; event: EventDto }) {
  const rsvp = rsvpBadge(event.myRsvp);
  return (
    <ContentCard to={`/t/${slug}/app/events/${event.id}`} status={event.moderationStatus} className="flex gap-4 p-4">
      <EventDateTile startAt={event.startAt} timezone={event.timezone} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-semibold text-slate-900">{event.title}</h3>
          {event.isCancelled && <Badge tone="danger">Cancelled</Badge>}
          {rsvp && <Badge tone={rsvp.tone}>{rsvp.label}</Badge>}
          <ModerationStatusBadge status={event.moderationStatus} />
        </div>
        <p className="text-sm text-slate-600">
          {formatDateTime(event.startAt, event.timezone)} · {event.city}
          {event.venueName ? ` · ${event.venueName}` : ""}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {EVENT_KIND_LABELS[event.kind]} · {event.yesCount} going{event.maybeCount ? `, ${event.maybeCount} maybe` : ""}
          {event.maxAttendees ? ` · ${event.maxAttendees} spots` : ""} · hosted by {nameWithYears(event.author)}
        </p>
        <ModerationCardNote status={event.moderationStatus} note={event.moderationNote} />
      </div>
    </ContentCard>
  );
}
