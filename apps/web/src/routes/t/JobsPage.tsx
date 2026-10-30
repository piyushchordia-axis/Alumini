import { JOB_TYPES, JOB_TYPE_LABELS, type JobType } from "@illuminize/shared";
import { useState } from "react";
import { JobCard } from "@/components/jobs/JobCard";
import { SeekerCard } from "@/components/jobs/SeekerCard";
import { SeekerToggleCard } from "@/components/jobs/SeekerToggleCard";
import { Checkbox, EmptyState, ErrorBox, Input, LinkButton, LoadMore, Loading, PageHeader, Select, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function JobsPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [tab, setTab] = useState<"openings" | "seekers">("openings");
  const [q, setQ] = useState("");
  const [jobType, setJobType] = useState<JobType | "">("");
  const [remote, setRemote] = useState(false);
  const filters = { q: q || undefined, jobType: jobType || undefined, remote: remote || undefined };
  const jobs = useInfiniteList(qk.jobs(slug, filters), (cursor) => api.jobs.list(slug, { ...filters, cursor, limit: 20 }), tab === "openings");
  const seekers = useInfiniteList(qk.seekers(slug), (cursor) => api.jobs.seekers.list(slug, { cursor, limit: 20 }), tab === "seekers");

  return (
    <div className="space-y-4">
      <PageHeader title="Jobs" subtitle="Openings and referrals from alumni" actions={<LinkButton to={`/t/${slug}/app/jobs/new`}>+ Post a job</LinkButton>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "openings", label: "Openings" }, { value: "seekers", label: "Looking for work" }]} className="w-fit" />
      {tab === "openings" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search title or company" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <Select value={jobType} onChange={(e) => setJobType(e.target.value as JobType | "")} className="w-44">
              <option value="">All types</option>
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {JOB_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
            <Checkbox checked={remote} onChange={(e) => setRemote(e.target.checked)} label="Remote only" />
          </div>
          {jobs.isLoading && <Loading />}
          {jobs.error && <ErrorBox error={jobs.error} />}
          <div className="grid gap-3">
            {jobs.items.map((j) => (
              <JobCard key={j.id} slug={slug} job={j} />
            ))}
          </div>
          {!jobs.isLoading && jobs.items.length === 0 && <EmptyState icon="💼" title="No openings right now" description="Know of a role? Post it for your batchmates." />}
          <LoadMore hasNextPage={!!jobs.hasNextPage} isFetchingNextPage={jobs.isFetchingNextPage} fetchNextPage={() => void jobs.fetchNextPage()} />
        </>
      ) : (
        <>
          <SeekerToggleCard slug={slug} />
          {seekers.isLoading && <Loading />}
          <div className="grid gap-3 md:grid-cols-2">
            {seekers.items.map((s) => (
              <SeekerCard key={s.member.id} slug={slug} seeker={s} />
            ))}
          </div>
          {!seekers.isLoading && seekers.items.length === 0 && <EmptyState icon="🙋" title="Nobody is looking right now" />}
          <LoadMore hasNextPage={!!seekers.hasNextPage} isFetchingNextPage={seekers.isFetchingNextPage} fetchNextPage={() => void seekers.fetchNextPage()} />
        </>
      )}
    </div>
  );
}
