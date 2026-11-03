import { useEffect, useRef } from "react";

/**
 * Where focus goes after an action on a row of a list. Once a dialog has closed and handed focus back to the button that
 * opened it, focus moves to the row instead: the refetch that follows can take that button away, which would drop a keyboard
 * or screen-reader user's place in the list. Rows need an `id` and `tabIndex={-1}`. A target is only ever for the dialog open
 * when it was set: opening another, or moving focus at once, forgets it, so it can't fire when some later dialog closes.
 */
export function useRowFocus(dialogOpen: boolean) {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (dialogOpen) {
      pending.current = null;
      return;
    }
    if (!pending.current) return;
    document.getElementById(pending.current)?.focus();
    pending.current = null;
  }, [dialogOpen]);
  return {
    /** Once the dialog open now has closed. */
    afterDialog: (elementId: string) => {
      pending.current = elementId;
    },
    /** At once, for an action that opened no dialog. */
    now: (elementId: string) => {
      pending.current = null;
      document.getElementById(elementId)?.focus();
    },
  };
}
