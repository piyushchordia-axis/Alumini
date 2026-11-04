import { EVENT_KIND_LABELS } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ReasonModal } from "@/components/admin/ReasonModal";
import { MemberLink } from "@/components/common/MemberLink";
import { RichText } from "@/components/common/RichText";
import { RsvpButtons } from "@/components/events/RsvpButtons";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Avatar, Badge, Button, Card, ErrorBox, LinkButton, LoadMore, Loading, Tabs } from "@/components/ui";
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
  const [who, setWho] = useState<"YES" | "MAYBE">("YES");
  const [cancelOpen, setCancelOpen] = useState(false);
  const attendees = useInfiniteList(qk.attendees(slug, id, who), (cursor) => api.events.attendees(slug, id, { status: who, cursor, limit: 30 }), !!ev.data);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["events", slug] });
    void qc.invalidateQueries({ queryKey: qk.event(slug, id) });
    void qc.invalidateQueries({ queryKey: ["attendees", slug, id] });
  };
  const cancel = useMutation({
    mutationFn: (reason: string) => api.events.cancel(slug, id, reason || null),
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
          <RichText text={e.description} className="mt-4" />
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
                <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)} loading={cancel.isPending}>
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Who's coming</h2>
          <Tabs
            value={who}
            onChange={setWho}
            tabs={[
              { value: "YES", label: "Going", count: e.yesCount },
              { value: "MAYBE", label: "Maybe", count: e.maybeCount },
            ]}
          />
        </div>
        {attendees.isLoading && <Loading />}
        {attendees.error && <ErrorBox error={attendees.error} />}
        {attendees.items.length === 0 && !attendees.isLoading && !attendees.error && <p className="text-sm text-slate-400">{who === "YES" ? "No one has said yes yet. Be the first!" : "No maybes yet."}</p>}
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
      <ReasonModal
        open={cancelOpen}
        title="Cancel this event?"
        label="Everyone who said yes or maybe is notified. Add a reason if you like."
        placeholder="Reason for cancelling (optional)"
        tone="danger"
        confirmLabel="Cancel event"
        onClose={() => setCancelOpen(false)}
        onConfirm={(reason) => cancel.mutateAsync(reason)}
      />
    </div>
  );
}
