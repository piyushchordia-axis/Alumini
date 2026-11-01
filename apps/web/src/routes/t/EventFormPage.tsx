import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { EventForm } from "@/components/events/EventForm";
import { Card, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function EventFormPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: qk.event(slug, id ?? ""), queryFn: () => api.events.get(slug, id!), enabled: !!id });
  if (id && existing.isLoading) return <Loading />;
  if (id && (existing.error || !existing.data)) return <ErrorBox error={existing.error ?? "Not found"} />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={id ? "Edit event" : "Plan a gathering"} subtitle="A casual meetup or an organised event — members RSVP and you see who's coming." />
      <Card className="p-5">
        <EventForm
          slug={slug}
          initial={existing.data}
          tenantZone={tenant.timezone}
          submitLabel={id ? "Save changes" : "Publish event"}
          onSubmit={async (v) => {
            const ev = id ? await api.events.update(slug, id, v) : await api.events.create(slug, v);
            void qc.invalidateQueries({ queryKey: ["events", slug] });
            void qc.invalidateQueries({ queryKey: ["event", slug] });
            toast.success(ev.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : "Event published");
            navigate(`/t/${slug}/app/events/${ev.id}`);
          }}
        />
      </Card>
    </div>
  );
}
