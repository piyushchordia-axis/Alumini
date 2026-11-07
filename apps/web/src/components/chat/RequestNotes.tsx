import type { RerequestLine } from "@illuminize/shared/chat";
import { IconClock } from "@/components/icons";

/** A thread footer's line saying when a request can be sent again, on a line of its own with the date picked out. One sentence to a screen reader. */
export function RerequestWhen({ when }: { when: RerequestLine }) {
  return (
    <p className="mt-2 flex items-start gap-2 text-sm text-slate-700">
      <IconClock size={16} className="mt-0.5 text-slate-500" />
      <span>
        {when.lead}
        <time dateTime={when.iso} className="font-semibold text-slate-900">
          {when.at}
        </time>
        {when.tail}
      </span>
    </p>
  );
}
