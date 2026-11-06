import { moderationItemKey, moderationOutcomeText, moderationRefusalPlace, pinOutcomeText, type ContentAction, type GroupReview, type ModerationItemDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { RowStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";

/** A line said at the top of a queue, about something that usually takes its row off the tab. */
export interface QueueOutcome {
  text: string;
  tone: "info" | "warning";
}

export type ModerationBusy = ContentAction | "pin";

interface ActInput {
  item: ModerationItemDto;
  action: ContentAction;
  note?: string;
  reviewed?: GroupReview;
}

/**
 * Approve, reject, remove, restore, pin and unpin for the moderation queue. An outcome that takes the row off its tab is
 * said at the top (`say`), as the row goes once the list refetches; pinning, which leaves it there, and a refused tap are
 * said in the row (`sayRow`), unless the item was decided elsewhere or has gone, when its row leaves too. Every answer,
 * refusals too, refreshes the institution's queries: the counts, the reports a removal resolves, the member app's lists,
 * and an open preview (a group changed meanwhile shows what it says now). `say` and `sayRow` should be state setters
 * (useStatus's).
 */
export function useModerationActions(slug: string, { say, sayRow }: { say: (outcome: QueueOutcome) => void; sayRow: (status: RowStatus) => void }) {
  const qc = useQueryClient();
  // By row, not the mutation's latest variables, which only know the last of two quick taps on different rows.
  const [busy, setBusy] = useState<ReadonlyMap<string, ModerationBusy>>(() => new Map());
  const mark = (key: string, what: ModerationBusy | null) =>
    setBusy((prev) => {
      const next = new Map(prev);
      if (what) next.set(key, what);
      else next.delete(key);
      return next;
    });
  const act = useMutation({
    mutationFn: ({ item, action, note, reviewed }: ActInput) => api.admin.moderation.act(slug, item.contentType, item.id, action, note || null, reviewed),
    onMutate: ({ item, action }) => mark(moderationItemKey(item), action),
    onSuccess: (result, { item, action }) => {
      qc.setQueryData(qk.admin.content(slug, item.contentType, item.id), result.content);
      say({ text: moderationOutcomeText(item.contentType, action), tone: "info" });
    },
    onSettled: (_r, _e, { item }) => {
      mark(moderationItemKey(item), null);
      void invalidateTenant(qc, slug);
    },
  });
  const failed = (item: ModerationItemDto, err: unknown) => {
    // Decided elsewhere or gone: the row leaves its tab once the list refetches, so it's said above the list. Other
    // refusals (a group changed meanwhile, a cap on restoring) leave the row where it is.
    if (moderationRefusalPlace(err) === "queue") say({ text: errorMessage(err), tone: "warning" });
    else sayRow({ id: moderationItemKey(item), text: errorMessage(err), tone: "warning" });
  };
  const pin = useMutation({
    mutationFn: ({ item, pinned }: { item: ModerationItemDto; pinned: boolean }) => (pinned ? api.admin.moderation.pin(slug, item.id) : api.admin.moderation.unpin(slug, item.id)),
    onMutate: ({ item }) => mark(moderationItemKey(item), "pin"),
    onSuccess: (_post, { item, pinned }) => sayRow({ id: moderationItemKey(item), text: pinOutcomeText(pinned), tone: "info" }),
    onError: (err, { item }) => failed(item, err),
    onSettled: (_post, _err, { item }) => {
      mark(moderationItemKey(item), null);
      void invalidateTenant(qc, slug);
    },
  });
  return {
    /** For a reason sheet, which shows a failure inside it and closes on an out-of-date one: it rejects on failure. */
    run: (action: ContentAction, item: ModerationItemDto, note?: string) => act.mutateAsync({ item, action, note }),
    /** One tap, with no sheet to show a failure in: it's said in the row, or above the list when the row goes. */
    tap: (action: ContentAction, item: ModerationItemDto, reviewed?: GroupReview) => {
      act.mutateAsync({ item, action, reviewed }).catch((err: unknown) => failed(item, err));
    },
    pin: (item: ModerationItemDto, pinned: boolean) => pin.mutate({ item, pinned }),
    busyWith: (item: ModerationItemDto): ModerationBusy | undefined => busy.get(moderationItemKey(item)),
    sayRow,
  };
}

export type ModerationActions = ReturnType<typeof useModerationActions>;
