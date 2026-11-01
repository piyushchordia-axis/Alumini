import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/** A one-line link to this week's digest, shown for a week after it is made. */
export function DigestBanner({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: qk.digest(slug), queryFn: () => api.celebrations.digest(slug), staleTime: 10 * 60_000 });
  const d = q.data;
  // eslint-disable-next-line react-hooks/purity -- a week-old banner is hidden; precision doesn't matter here
  if (!d || Date.now() - new Date(d.createdAt).getTime() > 7 * 86_400_000) return null;
  const parts = [d.posts.length && `${d.posts.length} popular post${d.posts.length === 1 ? "" : "s"}`, d.jobs.length && `${d.jobs.length} new job${d.jobs.length === 1 ? "" : "s"}`, d.events.length && `${d.events.length} upcoming event${d.events.length === 1 ? "" : "s"}`].filter(Boolean);
  return (
    <Link to={`/t/${slug}/app/digest`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm hover:bg-slate-50">
      <span aria-hidden>📰</span>
      <span className="flex-1">
        <span className="font-medium text-slate-900">This week</span>
        <span className="text-slate-500"> · {parts.join(", ")}</span>
      </span>
      <span className="text-primary">Read →</span>
    </Link>
  );
}
