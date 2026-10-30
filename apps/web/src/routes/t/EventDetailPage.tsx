import { EVENT_KIND_LABELS } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MemberLink } from "@/components/common/MemberLink";
import { RsvpButtons } from "@/components/events/RsvpButtons";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Avatar, Badge, Button, Card, ErrorBox, LinkButton, LoadMore, Loading } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function EventDetailPage() {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: qk.event(slug, id), queryFn: () => api.events.get(slug, id) });
  const attendees = useInfiniteList(qk.attendees(slug, id, "YES"), (cursor) => api.events.attendees(slug, id, { status: "YES", cursor, limit: 30 }), !!ev.data);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["events", slug] });
    void qc.invalidateQueries({ queryKey: qk.event(slug, id) });
  };
  const cancel = useMutation({
    mutationFn: () => api.events.cancel(slug, id, prompt("Reason for cancelling (optional)") || null),
    onSuccess: () => {
      invalidate();
      toast.success("Event cancelled; attendees have been notified");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.events.remove(slug, id),
    onSuccess: () => {
      invalidate();
      navigate(`/t/${slug}/app/events`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (ev.isLoading) return <Loading />;
  if (ev.error || !ev.data) return <ErrorBox error={ev.error ?? "Not found"} />;
  const e = ev.data;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={`/t/${slug}/app/events`} className="text-sm text-slate-500 hover:text-slate-800">
        ← All events
      </Link>
      <Card className="overflow-hidden">
        {e.coverImageUrl && <img src={e.coverImageUrl} alt="" className="h-48 w-full object-cover" />}
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{e.title}</h1>
              <p className="text-slate-600">
                {formatDateTime(e.startAt, e.timezone)}
                {e.endAt ? ` – ${formatDateTime(e.endAt, e.timezone)}` : ""} <span className="text-xs text-slate-400">({e.timezone})</span>
              </p>
              <p className="text-slate-600">
                📍 {e.city}
                {e.venueName ? ` · ${e.venueName}` : ""}
              </p>
              {e.address && <p className="text-sm text-slate-500">{e.address}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="info">{EVENT_KIND_LABELS[e.kind]}</Badge>
              {e.isCancelled && <Badge tone="danger">Cancelled</Badge>}
              <ModerationStatusBadge status={e.moderationStatus} note={e.moderationNote} />
            </div>
          </div>
          <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-slate-800">{e.description}</p>
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-3 text-sm text-slate-600">
              <strong className="text-slate-900">{e.yesCount}</strong> going{e.maybeCount ? ` · ${e.maybeCount} maybe` : ""}
              {e.maxAttendees ? ` · ${Math.max(e.maxAttendees - e.yesCount, 0)} spots left` : ""}
            </div>
            <RsvpButtons slug={slug} event={e} />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <MemberLink slug={slug} member={e.author} meta="Organiser" />
            <div className="flex items-center gap-2">
              {e.isMine && (
                <LinkButton to={`/t/${slug}/app/events/${e.id}/edit`} variant="outline" size="sm">
                  Edit
                </LinkButton>
              )}
              {(e.isMine || isTenantAdmin) && !e.isCancelled && (
                <Button variant="outline" size="sm" onClick={() => confirm("Cancel this event? Attendees will be notified.") && cancel.mutate()} loading={cancel.isPending}>
                  Cancel event
                </Button>
              )}
              {e.isMine ? (
                <Button variant="ghost" size="sm" onClick={() => confirm("Delete this event?") && remove.mutate()}>
                  Delete
                </Button>
              ) : (
                <ReportButton slug={slug} contentType="EVENT" contentId={e.id} />
              )}
            </div>
          </div>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Who's going</h2>
        {attendees.items.length === 0 && !attendees.isLoading && <p className="text-sm text-slate-400">No RSVPs yet — be the first!</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {attendees.items.map((m) => (
            <li key={m.id}>
              <Link to={`/t/${slug}/app/directory/${m.id}`} className="flex items-center gap-2">
                <Avatar name={m.fullName} src={m.avatarUrl} size="sm" />
                <span className="text-sm">
                  <span className="font-medium text-slate-900">{m.fullName}</span>
                  <span className="text-slate-500"> · {m.batchYear}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <LoadMore hasNextPage={!!attendees.hasNextPage} isFetchingNextPage={attendees.isFetchingNextPage} fetchNextPage={() => void attendees.fetchNextPage()} />
      </Card>
    </div>
  );
}
