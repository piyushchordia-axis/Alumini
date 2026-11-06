import type { ReasonPromptKey } from "@illuminize/shared";
import { useState } from "react";

/** What a list screen's reason sheet is open for: which prompt, and the row it acts on. */
export interface ReasonSheetTarget<T, P extends ReasonPromptKey = ReasonPromptKey> {
  prompt: P;
  rowKey: string;
  row: T;
}

/**
 * One reason sheet for a whole list screen, aimed at a row, as a sheet per row would mount a Modal for each, which costs
 * memory on a long list. What's typed is kept per prompt and row while the screen is open, so Cancel keeps a note for
 * next time and another row's sheet starts empty; ReasonSheet clears a draft once it's sent. The target stays after
 * `close`, so the sheet keeps its words while it slides away.
 */
export function useReasonSheet<T, P extends ReasonPromptKey = ReasonPromptKey>() {
  const [state, setState] = useState<{ target: ReasonSheetTarget<T, P> | null; open: boolean }>({ target: null, open: false });
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const draftKey = state.target ? `${state.target.prompt}:${state.target.rowKey}` : null;
  return {
    target: state.target,
    open: state.open,
    ask: (target: ReasonSheetTarget<T, P>) => setState({ target, open: true }),
    close: () => setState((s) => ({ ...s, open: false })),
    text: (draftKey && drafts.get(draftKey)) || "",
    setText: (text: string) => {
      if (!draftKey) return;
      setDrafts((prev) => {
        const next = new Map(prev);
        if (text) next.set(draftKey, text);
        else next.delete(draftKey);
        return next;
      });
    },
  };
}
