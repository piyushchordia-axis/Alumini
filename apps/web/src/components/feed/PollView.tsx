import type { PollDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { IconCheck } from "@/components/icons";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/stores/uiStore";

/**
 * A post's poll. Before voting: choose (one, or several when allowed). After voting or once closed: result bars with
 * the viewer's choice marked, and "Change vote".
 */
export function PollView({ slug, postId, poll, canVote }: { slug: string; postId: string; poll: PollDto; canVote: boolean }) {
  const qc = useQueryClient();
  const voted = poll.myVotes.length > 0;
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const showResults = poll.isClosed || !canVote || (voted && !changing);
  const update = (data: PollDto) => {
    // Patch the post in any cached feed page or post detail, then let them refetch in the background.
    qc.setQueriesData({ queryKey: ["post", slug, postId] }, (old: unknown) => (old && typeof old === "object" ? { ...old, poll: data } : old));
    void qc.invalidateQueries({ queryKey: ["posts", slug] });
  };
  const vote = useMutation({
    mutationFn: (ids: string[]) => api.posts.poll.vote(slug, postId, ids),
    onSuccess: (data) => {
      update(data);
      setChanging(false);
      setPicked([]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const clear = useMutation({ mutationFn: () => api.posts.poll.clear(slug, postId), onSuccess: update, onError: (e) => toast.error(errorMessage(e)) });
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  return (
    <div className="mt-3 space-y-2" role="group" aria-label="Poll">
      {poll.options.map((o) => {
        const mine = poll.myVotes.includes(o.id);
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        if (showResults) {
          return (
            <div key={o.id} className="relative overflow-hidden rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <div className={clsx("absolute inset-y-0 left-0", mine ? "bg-primary/20" : "bg-slate-100")} style={{ width: `${pct}%` }} aria-hidden />
              <div className="relative flex justify-between gap-2">
                <span className={clsx(mine && "font-semibold text-slate-900")}>
                  {o.label}
                  {mine && " ✓"}
                </span>
                <span className="tabular-nums text-slate-600">
                  {pct}% <span className="text-xs text-slate-400">({o.votes})</span>
                </span>
              </div>
            </div>
          );
        }
        const on = picked.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={poll.allowsMultiple ? on : undefined}
            disabled={vote.isPending}
            onClick={() => (poll.allowsMultiple ? setPicked((p) => (on ? p.filter((x) => x !== o.id) : [...p, o.id])) : vote.mutate([o.id]))}
            className={clsx("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition", on ? "border-primary bg-primary/10" : "border-slate-300 hover:border-primary hover:bg-primary/5")}
          >
            {/* Only for the eye: aria-pressed says whether it's chosen. */}
            {poll.allowsMultiple && (
              <span aria-hidden className={clsx("flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border-2", on ? "border-primary bg-primary text-white" : "border-slate-400 bg-white")}>
                {on && <IconCheck size={12} strokeWidth={3} />}
              </span>
            )}
            <span className="min-w-0">{o.label}</span>
          </button>
        );
      })}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>
          {poll.totalVoters} vote{poll.totalVoters === 1 ? "" : "s"}
          {poll.allowsMultiple ? " · choose several" : ""}
          {poll.closesAt ? ` · ${poll.isClosed ? "closed" : "closes"} ${formatDateTime(poll.closesAt)}` : ""}
        </span>
        {!showResults && poll.allowsMultiple && (
          <Button size="sm" onClick={() => vote.mutate(picked)} disabled={picked.length === 0} loading={vote.isPending}>
            Vote
          </Button>
        )}
        {canVote && !poll.isClosed && voted && !changing && (
          <>
            <button type="button" className="underline hover:text-slate-800" onClick={() => setChanging(true)}>
              Change vote
            </button>
            <button type="button" className="underline hover:text-slate-800" onClick={() => clear.mutate()}>
              Remove vote
            </button>
          </>
        )}
        {changing && (
          <button type="button" className="underline hover:text-slate-800" onClick={() => setChanging(false)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
