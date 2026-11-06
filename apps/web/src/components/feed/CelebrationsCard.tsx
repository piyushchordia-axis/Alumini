import { memberYearsLabel, type CelebrationDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { IconCake, IconSpark } from "@/components/icons";
import { Avatar, Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

const what = (c: CelebrationDto) => (c.kind === "BIRTHDAY" ? "Birthday" : `${c.years} year${c.years === 1 ? "" : "s"} with us`);

/** Today's birthdays and membership anniversaries, with "Wish". Day and month only; never a birth year or age. */
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
    <Card className="p-3" as="section" elevation={1}>
      {d.items.length > 0 && (
        <>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <IconSpark size={16} className="text-primary" /> Celebrating today
          </h2>
          <ul className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
            {d.items.map((c) => (
              <li key={`${c.membershipId}-${c.kind}`} className="flex min-w-[220px] shrink-0 items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200/80">
                <Avatar name={c.fullName} src={c.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link to={`/t/${slug}/app/directory/${c.membershipId}`} className="block truncate text-sm font-medium text-slate-900 hover:underline">
                    {c.isMe ? "You" : c.fullName}
                  </Link>
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    {c.kind === "BIRTHDAY" ? <IconCake size={12} /> : <IconSpark size={12} />}
                    {what(c)} · {memberYearsLabel(c)}
                  </span>
                </div>
                {c.isMe ? (
                  <span className="text-xs text-slate-500">{c.wishCount ? `${c.wishCount} wish${c.wishCount === 1 ? "" : "es"}` : "Your day"}</span>
                ) : c.wishedByMe ? (
                  <span className="text-xs text-emerald-700">Wished</span>
                ) : (
                  <Button size="sm" variant="outline" loading={wish.isPending && wish.variables?.membershipId === c.membershipId} onClick={() => wish.mutate(c)}>
                    Wish
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {d.more > 0 && <p className="mt-1.5 text-xs text-slate-500">…and {d.more} more today.</p>}
        </>
      )}
      {d.showNotice && (
        <div className={`${d.items.length ? "mt-3 border-t border-slate-100 pt-2.5" : ""} flex flex-wrap items-center gap-3 text-sm text-slate-600`}>
          <p className="flex-1 text-xs leading-relaxed">
            On your birthday, classmates see it here (day only, never the year). Turn this off in{" "}
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
