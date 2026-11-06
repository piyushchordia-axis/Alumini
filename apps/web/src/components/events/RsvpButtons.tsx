import { RSVP_GROUP_LABEL, rsvpChoices, rsvpClosedText, rsvpsOpen, type EventDto, type RsvpStatus, type StatusTone } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { IconCheck } from "@/components/icons";
import { api } from "@/lib/api";
import { toast } from "@/stores/uiStore";

/** A chosen answer: its tone's fill, edge and ink (STATUS_TONES), as the phone draws it. */
const CHOSEN: Record<StatusTone, string> = {
  success: "border-tone-success-edge bg-tone-success-fill text-tone-success-ink",
  warning: "border-tone-warning-edge bg-tone-warning-fill text-tone-warning-ink",
  danger: "border-tone-danger-edge bg-tone-danger-fill text-tone-danger-ink",
  neutral: "border-tone-neutral-edge bg-tone-neutral-fill text-tone-neutral-ink",
};

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
  const [now] = useState(() => Date.now());
  const disabled = !rsvpsOpen(event, now) || set.isPending;
  const closedText = rsvpClosedText(event, now);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={RSVP_GROUP_LABEL}>
      {rsvpChoices(event).map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled || o.full}
          aria-pressed={o.chosen}
          onClick={() => set.mutate(o.chosen ? null : o.value)}
          className={clsx(
            "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-4 text-sm motion-safe:transition disabled:opacity-50",
            // Hover only on an unchosen answer, where it can't outrank the chosen look.
            o.chosen ? ["font-semibold", CHOSEN[o.tone]] : "border-slate-300 bg-white font-medium text-slate-700 enabled:hover:bg-slate-50",
          )}
        >
          {o.chosen && <IconCheck size={16} strokeWidth={2.5} />}
          {o.label}
        </button>
      ))}
      {closedText && <span className="text-xs text-slate-500">{closedText}</span>}
    </div>
  );
}
