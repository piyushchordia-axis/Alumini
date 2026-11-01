import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, EmptyState, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";

/** "This week": the latest weekly digest (also emailed to members who confirmed an email). */
export function DigestPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const base = `/t/${slug}/app`;
  const q = useQuery({ queryKey: qk.digest(slug), queryFn: () => api.celebrations.digest(slug) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={`This week at ${tenant.shortName ?? tenant.name}`} subtitle={d ? `Week of ${formatDate(d.weekStart)}` : undefined} />
      {!d ? (
        <EmptyState icon="📰" title="No digest yet" description="Every Monday morning we round up the week's popular posts, new jobs and upcoming events." />
      ) : (
        <>
          {d.posts.length > 0 && (
            <Card className="p-5" as="section">
              <h2 className="font-semibold text-slate-900">Popular posts</h2>
              <ul className="mt-3 space-y-3">
                {d.posts.map((p) => (
                  <li key={p.id}>
                    <Link to={`${base}/feed/${p.id}`} className="font-medium text-slate-900 hover:underline">
                      {p.excerpt}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {p.authorName} · {p.reactionCount} reactions · {p.commentCount} comments
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d.jobs.length > 0 && (
            <Card className="p-5" as="section">
              <h2 className="font-semibold text-slate-900">New jobs</h2>
              <ul className="mt-3 space-y-3">
                {d.jobs.map((j) => (
                  <li key={j.id}>
                    <Link to={`${base}/jobs/${j.id}`} className="font-medium text-slate-900 hover:underline">
                      {j.title}
                    </Link>
                    <div className="text-xs text-slate-500">{[j.companyName, j.isRemote ? "Remote" : j.location].filter(Boolean).join(" · ")}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d.events.length > 0 && (
            <Card className="p-5" as="section">
              <h2 className="font-semibold text-slate-900">Coming up</h2>
              <ul className="mt-3 space-y-3">
                {d.events.map((e) => (
                  <li key={e.id}>
                    <Link to={`${base}/events/${e.id}`} className="font-medium text-slate-900 hover:underline">
                      {e.title}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {formatDateTime(e.startAt, e.timezone)} · {e.city}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d.newMembers > 0 && (
            <p className="text-sm text-slate-600">
              👋 {d.newMembers} new member{d.newMembers === 1 ? "" : "s"} joined that week. <Link to={`${base}/directory`} className="text-primary underline">See the directory</Link>
            </p>
          )}
          <p className="text-xs text-slate-500">
            Get this by email every Monday: add your email on <Link to={`${base}/profile`} className="underline">your profile</Link> and keep the digest on in{" "}
            <Link to={`${base}/notifications/settings`} className="underline">notification settings</Link>.
          </p>
        </>
      )}
    </div>
  );
}
