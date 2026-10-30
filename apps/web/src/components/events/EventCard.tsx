import { EVENT_KIND_LABELS, type EventDto } from "@illuminize/shared";
import { Link } from "react-router-dom";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Badge, Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export function EventCard({ slug, event }: { slug: string; event: EventDto }) {
  const d = new Date(event.startAt);
  return (
    <Link to={`/t/${slug}/app/events/${event.id}`}>
      <Card className="flex gap-4 p-4 transition hover:border-slate-300 hover:shadow">
        <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span className="text-xs font-semibold uppercase">{d.toLocaleString(undefined, { month: "short", timeZone: event.timezone })}</span>
          <span className="text-2xl font-bold leading-none">{d.toLocaleString(undefined, { day: "numeric", timeZone: event.timezone })}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-slate-900">{event.title}</h3>
            {event.isCancelled && <Badge tone="danger">Cancelled</Badge>}
            {event.myRsvp && <Badge tone={event.myRsvp === "YES" ? "success" : event.myRsvp === "MAYBE" ? "warning" : "neutral"}>You: {event.myRsvp.toLowerCase()}</Badge>}
            <ModerationStatusBadge status={event.moderationStatus} />
          </div>
          <p className="text-sm text-slate-600">
            {formatDateTime(event.startAt, event.timezone)} · {event.city}
            {event.venueName ? ` · ${event.venueName}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {EVENT_KIND_LABELS[event.kind]} · {event.yesCount} going{event.maybeCount ? `, ${event.maybeCount} maybe` : ""}
            {event.maxAttendees ? ` · ${event.maxAttendees} spots` : ""} · hosted by {event.author.fullName}
          </p>
        </div>
      </Card>
    </Link>
  );
}
