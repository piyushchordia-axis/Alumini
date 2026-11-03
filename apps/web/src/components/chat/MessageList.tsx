import type { ChatRow } from "@illuminize/shared/chat";
import clsx from "clsx";
import { memo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { useChatScroll } from "@/hooks/useChatScroll";
import { peerName } from "@/lib/chat";

type MessageRow = Extract<ChatRow, { type: "message" }>;

export interface MessageActions {
  onRetry: (clientKey: string) => void;
  onDiscard: (clientKey: string) => void;
  onReport: (messageId: string) => void;
}

/**
 * A thread's messages, oldest first in the DOM, inside a `role="log"` so a screen reader announces what arrives. Text is
 * rendered as text and nothing else: no links, no markdown, line breaks kept, and long unbroken strings wrapped.
 */
export function MessageList({
  rows,
  label,
  hasOlder,
  loadingOlder,
  loadOlder,
  actions,
  before,
}: {
  rows: ChatRow[];
  label: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  actions: MessageActions;
  /** Shown above the first message, such as how a request works. */
  before?: ReactNode;
}) {
  const messages = rows.filter((r): r is MessageRow => r.type === "message");
  const last = messages.at(-1);
  const { ref, onScroll, pinned, hasNew, jumpToLatest } = useChatScroll({ firstKey: messages[0]?.key, lastKey: last?.key, lastIsMine: !!last?.mine, hasOlder, loadingOlder, loadOlder });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={ref} onScroll={onScroll} role="log" aria-label={label} aria-busy={loadingOlder} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 [overflow-anchor:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-5">
        <div>
          {hasOlder && (
            <div className="flex justify-center pb-3">
              <Button variant="ghost" size="sm" className="min-h-11" onClick={loadOlder} loading={loadingOlder}>
                Load earlier messages
              </Button>
            </div>
          )}
          {before}
          {rows.map((row) =>
            row.type === "day" ? (
              <div key={row.key} className="my-3 flex justify-center">
                <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs font-medium text-slate-500">{row.label}</span>
              </div>
            ) : (
              <Bubble key={row.key} row={row} actions={actions} selected={selected === row.key} onSelect={() => setSelected((s) => (s === row.key ? null : row.key))} />
            ),
          )}
        </div>
      </div>
      {!pinned && (
        <button type="button" onClick={jumpToLatest} className="absolute bottom-3 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-1 rounded-full bg-slate-900 px-4 text-sm font-medium text-white shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {hasNew ? "New messages" : "Jump to latest"} <span aria-hidden>↓</span>
        </button>
      )}
    </div>
  );
}

const Bubble = memo(function Bubble({ row, actions, selected, onSelect }: { row: MessageRow; actions: MessageActions; selected: boolean; onSelect: () => void }) {
  const { item, mine, startsGroup, endsGroup, timeLabel } = row;
  const message = item.message;
  const pending = item.pending;

  if (message?.kind === "SYSTEM") {
    return (
      <p className="my-3 text-center text-xs text-slate-500">
        {message.body} <span className="text-slate-400">· {timeLabel}</span>
      </p>
    );
  }

  const removed = !!message?.removed;
  const failed = pending?.status === "failed";
  const reportable = !!message && !mine && !removed;
  const who = mine ? "You" : peerName(message?.sender);

  return (
    <div className={clsx("group flex flex-col", mine ? "items-end" : "items-start", startsGroup ? "mt-3" : "mt-0.5")}>
      <div className="relative max-w-[85%] sm:max-w-[75%]">
        <div
          onClick={onSelect}
          className={clsx(
            "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug [overflow-wrap:anywhere]",
            removed
              ? "border border-dashed border-slate-300 bg-white italic text-slate-500"
              : mine
                ? clsx("bg-primary text-white", pending && !failed && "opacity-70", failed && "ring-2 ring-red-500 ring-offset-1")
                : "bg-slate-100 text-slate-900",
            mine ? endsGroup && "rounded-br-md" : endsGroup && "rounded-bl-md",
          )}
        >
          <span className="sr-only">{who}: </span>
          {removed ? "This message was removed" : (message?.body ?? pending?.body)}
        </div>
        {reportable && (
          // Beside the bubble rather than under it, so a thread doesn't get taller for a control most people never use.
          <button
            type="button"
            aria-label="Report message"
            title="Report message"
            onClick={() => actions.onReport(message.id)}
            className={clsx(
              "absolute left-full top-1/2 ml-1 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-red-600 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-primary",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 pointer-coarse:pointer-events-none",
            )}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 22V4m0 0h12l-2 4 2 4H4" />
            </svg>
          </button>
        )}
      </div>
      {pending ? (
        failed ? (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-x-1 text-xs">
            <span className="px-1 text-red-600" role="alert">
              Not sent{pending.error ? `: ${pending.error}` : ""}
            </span>
            <button type="button" onClick={() => actions.onRetry(pending.clientKey)} className="min-h-11 rounded-md px-2 font-semibold text-primary hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary">
              Try again
            </button>
            <button type="button" onClick={() => actions.onDiscard(pending.clientKey)} className="min-h-11 rounded-md px-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary">
              Discard
            </button>
          </div>
        ) : (
          <span className="mt-0.5 px-1 text-[11px] text-slate-400">Sending…</span>
        )
      ) : (
        (endsGroup || selected) && <span className="mt-0.5 px-1 text-[11px] text-slate-400">{timeLabel}</span>
      )}
    </div>
  );
});
