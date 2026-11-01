import type { CelebrationDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Avatar, Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

const what = (c: CelebrationDto) => (c.kind === "BIRTHDAY" ? "🎂 Birthday" : `🎉 ${c.years} year${c.years === 1 ? "" : "s"} with us`);

/** Today's birthdays and membership anniversaries, with "Send wishes". Day and month only; never a year or age. */
export function CelebrationsCard({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const today = useQuery({ queryKey: qk.celebrations(slug), queryFn: () => api.celebrations.today(slug), staleTime: 5 * 60_000 });
  const wish = useMutation({
    mutationFn: (c: CelebrationDto) => api.celebrations.wish(slug, c.membershipId, c.kind),
    onSuccess: (_r, c) => {
      void qc.invalidateQueries({ queryKey: qk.celebrations(slug) });
      toast.success(`Wishes sent to ${c.fullName.split(" ")[0]}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const seen = useMutation({ mutationFn: () => api.notifications.updatePrefs(slug, { celebrationsNoticeSeen: true }), onSuccess: () => void qc.invalidateQueries({ queryKey: qk.celebrations(slug) }) });
  const d = today.data;
  if (!d || (d.items.length === 0 && !d.showNotice)) return null;
  return (
    <Card className="p-4" as="section">
      {d.items.length > 0 && (
        <>
          <h2 className="font-semibold text-slate-900">🎉 Celebrating today</h2>
          <ul className="mt-3 space-y-3">
            {d.items.map((c) => (
              <li key={`${c.membershipId}-${c.kind}`} className="flex items-center gap-3">
                <Avatar name={c.fullName} src={c.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link to={`/t/${slug}/app/directory/${c.membershipId}`} className="block truncate text-sm font-medium text-slate-900 hover:underline">
                    {c.isMe ? "You" : c.fullName}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {what(c)} · batch of {c.batchYear}
                  </span>
                </div>
                {c.isMe ? (
                  <span className="text-xs text-slate-500">{c.wishCount ? `${c.wishCount} wish${c.wishCount === 1 ? "" : "es"} so far` : "It's your day!"}</span>
                ) : c.wishedByMe ? (
                  <span className="text-xs text-emerald-700">Wished ✓</span>
                ) : (
                  <Button size="sm" variant="outline" loading={wish.isPending && wish.variables?.membershipId === c.membershipId} onClick={() => wish.mutate(c)}>
                    Send wishes
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {d.more > 0 && <p className="mt-2 text-xs text-slate-500">…and {d.more} more celebrating today.</p>}
        </>
      )}
      {d.showNotice && (
        <div className={`${d.items.length ? "mt-4 border-t border-slate-100 pt-3" : ""} flex flex-wrap items-center gap-3 text-sm text-slate-600`}>
          <p className="flex-1">
            🎂 On your birthday, classmates will see it here (the day only, never the year) so they can send wishes. You can turn this off in{" "}
            <Link to={`/t/${slug}/app/profile`} className="underline">
              your profile
            </Link>
            .
          </p>
          <Button size="sm" variant="ghost" onClick={() => seen.mutate()}>
            Got it
          </Button>
        </div>
      )}
    </Card>
  );
}
