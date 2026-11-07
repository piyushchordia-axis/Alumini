import type { FirstMessageNotice, RerequestLine } from "@illuminize/shared/chat";
import clsx from "clsx";
import { useId } from "react";
import { IconClock, IconMail } from "@/components/icons";
import { EmptyIcon } from "@/components/ui";

/**
 * The note above the box on the screen writing a first message (`firstMessageNotice`): a compact card with the envelope
 * in the brand's badge, named by its title. `id` is for the message box's `aria-describedby`, so its words are read with
 * the box, which a desktop focuses straight away. The title has no full stop on screen, so a hidden one ends it there:
 * the description joins the lines with spaces alone, which would run the name into the text as one sentence.
 */
export function FirstMessageNote({ id, notice, className }: { id: string; notice: FirstMessageNotice; className?: string }) {
  const titleId = useId();
  return (
    <div role="note" id={id} aria-labelledby={titleId} className={clsx("flex w-full max-w-sm items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left", className)}>
      <EmptyIcon icon={<IconMail />} size="small" />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-slate-900">
          <span id={titleId}>{notice.title}</span>
          <span className="sr-only">.</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">{notice.text}</p>
        <p className="mt-2 text-[13px] text-slate-500">{notice.tip}</p>
      </div>
    </div>
  );
}

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
