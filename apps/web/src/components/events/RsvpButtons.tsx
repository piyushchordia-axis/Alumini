import type { EventDto, RsvpStatus } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import { toast } from "@/stores/uiStore";

export function RsvpButtons({ slug, event }: { slug: string; event: EventDto }) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["event", slug, event.id] });
    void qc.invalidateQueries({ queryKey: ["events", slug] });
    void qc.invalidateQueries({ queryKey: ["attendees", slug, event.id] });
  };
  const set = useMutation({
    mutationFn: (status: RsvpStatus | null) => (status ? api.events.rsvp(slug, event.id, status) : api.events.clearRsvp(slug, event.id)),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disabled = event.isCancelled || event.moderationStatus !== "APPROVED" || set.isPending;
  const full = !!event.maxAttendees && event.yesCount >= event.maxAttendees && event.myRsvp !== "YES";
  const options: Array<{ value: RsvpStatus; label: string; tone: string }> = [
    { value: "YES", label: full ? "Full" : "I'm going", tone: "bg-emerald-600 text-white" },
    { value: "MAYBE", label: "Maybe", tone: "bg-amber-500 text-white" },
    { value: "NO", label: "Can't make it", tone: "bg-slate-600 text-white" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = event.myRsvp === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled || (o.value === "YES" && full)}
            onClick={() => set.mutate(active ? null : o.value)}
            className={clsx("h-10 rounded-lg px-4 text-sm font-medium transition disabled:opacity-50", active ? o.tone : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}
          >
            {active ? "✓ " : ""}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
