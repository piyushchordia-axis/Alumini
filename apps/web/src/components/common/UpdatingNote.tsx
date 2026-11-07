import { UPDATING_RESULTS } from "@illuminize/shared";
import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * "Updating results…" over the top edge of a list whose rows are kept from the search before while this one's answer
 * comes (useInfiniteList's `updating`). It floats, taking no room and no clicks, so the rows don't move and stay
 * clickable. Always mounted, empty and for screen readers only while idle, so they hear it when it appears, as the
 * console's Analytics does. Its parent is `relative`.
 */
export function UpdatingNote({ updating }: { updating: boolean }) {
  return (
    <p
      role="status"
      className={
        updating
          ? "pointer-events-none absolute inset-x-0 top-0 z-10 mx-auto w-fit -translate-y-1/2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-[var(--shadow-1)]"
          : "sr-only"
      }
    >
      {updating ? UPDATING_RESULTS : ""}
    </p>
  );
}

/**
 * A list's rows (in a box with `className`, such as its grid) under an UpdatingNote: faded while they're kept from the
 * search before, gently where motion is welcome, and busy. `aria-busy` is on the rows, not on a box holding the note,
 * whose status a screen reader might then keep quiet.
 */
export function KeptResults({ updating, className, children }: { updating: boolean; className?: string; children: ReactNode }) {
  return (
    <div className="relative">
      <UpdatingNote updating={updating} />
      <div aria-busy={updating} className={clsx(className, "motion-safe:transition-opacity", updating && "opacity-60")}>
        {children}
      </div>
    </div>
  );
}
