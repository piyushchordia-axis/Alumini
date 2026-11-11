import { LOADING_LABEL, PAGE_SKELETONS, SKELETON_LAYOUTS, skeletonWidth, type PageSkeletonLayout, type PageSkeletonShape, type SkeletonFrame, type SkeletonLayout, type SkeletonLead, type SkeletonShape } from "@illuminize/shared";
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";

// Outlines drawn while something first loads. Neutral slate on white, never the brand colour, so they read on any
// institution's colour and on any member's background. They hold no article, li, link or button, which the e2e scripts
// take for the real thing. This file doesn't import the ui module (it re-exports this one), so the card is written out.

const CARD = "rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[var(--shadow-1)]";

/**
 * One grey block of an outline. The blocks pulse, only for those who haven't asked for less motion (motion-safe), and
 * the white cards they sit on don't: faded, a card would let the member's tint or photo through. Blocks mounted together
 * start together, so they pulse as one.
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={clsx("rounded bg-slate-200 motion-safe:animate-pulse", className)} style={style} />;
}

/**
 * Says something is loading while its outline shows: a polite status line holding `label` for screen readers, with the
 * outline hidden from them. `data-testid="skeleton"` is there for the e2e scripts alone.
 */
export function SkeletonStatus({ label = `${LOADING_LABEL}…`, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" data-testid="skeleton" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden>{children}</div>
    </div>
  );
}

const width = (base: number, row: number): CSSProperties => ({ width: `${skeletonWidth(base, row)}%` });

/** Lines of text, each a percentage of the width it has, shorter on each of three rows in turn. */
export function SkeletonLines({ widths, row = 0, className }: { widths: readonly number[]; row?: number; className?: string }) {
  return (
    <div className={clsx("space-y-2", className)}>
      {widths.map((w, i) => (
        <Skeleton key={i} className="h-3" style={width(w, row)} />
      ))}
    </div>
  );
}

const LEAD_RADIUS: Record<SkeletonLead["kind"], string> = { circle: "rounded-full", square: "rounded-xl", date: "rounded-lg" };

function Lead({ lead }: { lead: SkeletonLead }) {
  return <Skeleton className={clsx("shrink-0", LEAD_RADIUS[lead.kind])} style={{ width: lead.size, height: lead.size }} />;
}

function Item({ layout, row }: { layout: SkeletonLayout; row: number }) {
  return (
    <>
      <div className={clsx("flex gap-3", layout.body.length > 0 ? "items-start" : "items-center")}>
        {layout.lead && <Lead lead={layout.lead} />}
        <div className="min-w-0 flex-1 space-y-2">
          {layout.lines.map((w, i) => (
            // The title is a little taller than the lines under it.
            <Skeleton key={i} className={i === 0 ? "h-4" : "h-3"} style={width(w, row)} />
          ))}
        </div>
        {layout.trailing === "time" && <Skeleton className="h-3 w-10 shrink-0 self-start" />}
        {layout.trailing === "action" && <Skeleton className="hidden h-8 w-20 shrink-0 rounded-lg sm:block" />}
      </div>
      {layout.body.length > 0 && <SkeletonLines widths={layout.body} row={row} className="mt-4" />}
      {layout.pills > 0 && (
        <div className="mt-4 flex gap-2">
          {Array.from({ length: layout.pills }, (_, i) => (
            <Skeleton key={i} className="h-7 w-16 rounded-full" />
          ))}
        </div>
      )}
    </>
  );
}

function TableRows({ layout, count }: { layout: SkeletonLayout; count: number }) {
  const columns: CSSProperties = { gridTemplateColumns: `repeat(${layout.lines.length}, minmax(0, 1fr))` };
  return (
    <>
      <div className="grid gap-4 bg-slate-50 px-4 py-3" style={columns}>
        {layout.lines.map((_, i) => (
          <Skeleton key={i} className="h-3" style={width(50, i)} />
        ))}
      </div>
      {Array.from({ length: count }, (_, row) => (
        <div key={row} className="grid gap-4 px-4 py-3" style={columns}>
          {layout.lines.map((w, i) => (
            <Skeleton key={i} className="h-3" style={width(w, row)} />
          ))}
        </div>
      ))}
    </>
  );
}

const FRAME_CLASS: Record<SkeletonFrame, string> = {
  cards: "grid",
  rows: clsx(CARD, "divide-y divide-slate-100 overflow-hidden"),
  flush: "divide-y divide-slate-100",
};

/**
 * A list's outline while its first page loads, in the shape of the items it stands for (`SKELETON_LAYOUTS`, shared
 * with the phone). `frame` and `columns` follow the list's own when they differ from the shape's; `label` replaces
 * "Loading…" where the page already says something more specific.
 */
export function ListSkeleton({ shape, count, label, frame, columns, className }: { shape: SkeletonShape; count?: number; label?: string; frame?: SkeletonFrame; columns?: 1 | 2; className?: string }) {
  const layout = SKELETON_LAYOUTS[shape];
  const n = count ?? layout.count;
  const f = frame ?? layout.frame;
  const rows = Array.from({ length: n }, (_, row) => row);
  return (
    <SkeletonStatus label={label}>
      <div className={clsx(FRAME_CLASS[f], f === "cards" && (shape === "post" ? "gap-4" : "gap-3"), f === "cards" && (columns ?? layout.columns) === 2 && "md:grid-cols-2", className)}>
        {layout.table ? (
          <TableRows layout={layout} count={n} />
        ) : (
          rows.map((row) => (
            <div key={row} className={f === "cards" ? clsx(CARD, "p-4") : f === "rows" ? "px-4 py-3" : "py-3"}>
              <Item layout={layout} row={row} />
            </div>
          ))
        )}
      </div>
    </SkeletonStatus>
  );
}

/** The card's lead and head: a profile's photo above its lines on a phone and beside them from sm up, as ProfileSummary lays them. */
function PageHead({ layout }: { layout: PageSkeletonLayout }) {
  const lines = layout.head.map((w, i) => (
    // The title is taller than the lines under it, and centred under a photo on a phone, as the name is.
    <Skeleton key={i} className={clsx(i === 0 ? "h-6" : "h-3", layout.lead && "mx-auto sm:mx-0")} style={width(w, 0)} />
  ));
  if (!layout.lead) return <div className="space-y-3">{lines}</div>;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <Lead lead={layout.lead} />
      <div className="w-full min-w-0 flex-1 space-y-3 sm:pt-2">{lines}</div>
    </div>
  );
}

function PageCard({ layout }: { layout: PageSkeletonLayout }) {
  const head = layout.lead !== null || layout.head.length > 0;
  return (
    <>
      {head && <PageHead layout={layout} />}
      {layout.sections.map((lines, i) => (
        <SkeletonLines key={i} widths={lines} row={i} className={clsx(head || i > 0 ? "mt-5 border-t border-slate-100 pt-5" : undefined)} />
      ))}
      {layout.fields > 0 && (
        <div className={clsx("space-y-5", head && "mt-5")}>
          {Array.from({ length: layout.fields }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3" style={width(30, i)} />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
      )}
      {layout.actions > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {Array.from({ length: layout.actions }, (_, i) => (
            <Skeleton key={i} className="h-11 w-28 rounded-lg" />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * A detail or form page's outline while its first answer comes (`PAGE_SKELETONS`, shared with the phone), under the
 * Back link and any title the page knows already, which it draws itself, in its own width. `label` replaces "Loading…"
 * where the page says something more specific.
 */
export function PageSkeleton({ shape, label, className }: { shape: PageSkeletonShape; label?: string; className?: string }) {
  const layout = PAGE_SKELETONS[shape];
  const card = layout.lead !== null || layout.head.length > 0 || layout.sections.length > 0 || layout.fields > 0 || layout.actions > 0;
  return (
    <SkeletonStatus label={label} className={className}>
      <div className="space-y-4">
        {layout.tiles > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: layout.tiles }, (_, i) => (
              <div key={i} className={clsx(CARD, "space-y-3 p-4")}>
                <Skeleton className="h-3" style={width(55, i)} />
                <Skeleton className="h-7 w-16" />
              </div>
            ))}
          </div>
        )}
        {layout.bubbles.length > 0 && (
          // A chat pane is white already, so its bubbles need no card.
          <div className="flex flex-col gap-3 p-4">
            {layout.bubbles.map((w, i) => (
              <Skeleton key={i} className={clsx("h-10 rounded-2xl", i % 2 === 0 ? "self-start" : "self-end")} style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {card && (
          <div className={clsx(CARD, "p-5")}>
            <PageCard layout={layout} />
          </div>
        )}
      </div>
    </SkeletonStatus>
  );
}
