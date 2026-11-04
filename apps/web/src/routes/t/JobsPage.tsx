import { CAN_REFER_BADGE, JOB_TYPES, JOB_TYPE_LABELS, JOBS_TAB_LABELS, JOBS_TABS, jobsQuery, jobsTabFrom, referralBoxFrom, type JobsTab, type JobType, type ReferralBox } from "@illuminize/shared";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { JobCard } from "@/components/jobs/JobCard";
import { useReferralList } from "@/components/jobs/ReferralList";
import { ReferralRequests, ReferralsWayOut } from "@/components/jobs/ReferralRequests";
import { SeekerCard } from "@/components/jobs/SeekerCard";
import { SeekerToggleCard } from "@/components/jobs/SeekerToggleCard";
import { Checkbox, EmptyState, ErrorBox, Input, LinkButton, LoadMore, Loading, PageHeader, Select, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useReferralsAvailable, useReferralsWayOut } from "@/lib/referrals";

/** The tab and, on Referrals, the list, kept in the URL, as the referral notifications link to them. Received needs no `box`. */
function useJobsParams() {
  const [params, setParams] = useSearchParams();
  const tab = jobsTabFrom(params.get("tab"));
  const box = referralBoxFrom(params.get("box"));
  const go = (next: JobsTab, nextBox: ReferralBox = "received") => setParams(new URLSearchParams(jobsQuery(next, nextBox === "sent" ? "sent" : undefined)), { replace: true });
  return { tab, box, go };
}

/** Jobs: openings, members looking for work, and referral requests both ways. The tab is in the URL, as on Mentors. */
export function JobsPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { tab, box, go } = useJobsParams();
  const available = useReferralsAvailable();
  const wayOut = useReferralsWayOut();
  // Referrals says how many requests wait for this member's answer, from the received list itself, which its tab then shows at once.
  const received = useReferralList(slug, "received", available);
  const waiting = available ? (received.first?.waiting ?? 0) : (wayOut?.received ?? 0);
  // Shown while the member can use referrals, and otherwise while they still have requests to withdraw or answer. A link
  // straight to it (a notification, say) opens it either way, and it says what's left there.
  const showReferrals = available || tab === "referrals" || (!!wayOut && wayOut.received + wayOut.sent > 0);
  const [q, setQ] = useState("");
  const [jobType, setJobType] = useState<JobType | "">("");
  const [remote, setRemote] = useState(false);
  const [canRefer, setCanRefer] = useState(false);
  const filters = { q: q || undefined, jobType: jobType || undefined, workMode: remote ? ("REMOTE" as const) : undefined, canRefer: (available && canRefer) || undefined };
  const jobs = useInfiniteList(qk.jobs(slug, filters), (cursor) => api.jobs.list(slug, { ...filters, cursor, limit: 20 }), tab === "openings");
  const seekers = useInfiniteList(qk.seekers(slug), (cursor) => api.jobs.seekers.list(slug, { cursor, limit: 20 }), tab === "seekers");

  return (
    <div className="space-y-4">
      <PageHeader title="Jobs" subtitle="Openings and referrals from alumni" actions={<LinkButton to={`/t/${slug}/app/jobs/new`}>+ Post a job</LinkButton>} />
      <Tabs
        value={tab}
        onChange={(next) => go(next, box)}
        tabs={JOBS_TABS.filter((t) => t !== "referrals" || showReferrals).map((t) => ({ value: t, label: JOBS_TAB_LABELS[t], ...(t === "referrals" && waiting > 0 ? { count: waiting } : {}) }))}
        className="w-full sm:w-fit [&>button]:min-h-11 max-sm:[&>button]:flex-1 max-sm:[&>button]:px-2"
      />
      <div role="tabpanel" aria-label={JOBS_TAB_LABELS[tab]} className="space-y-4">
        {tab === "openings" ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Input aria-label="Search jobs" placeholder="Search title, company or skill" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
              <Select aria-label="Job type" value={jobType} onChange={(e) => setJobType(e.target.value as JobType | "")} className="w-44">
                <option value="">All types</option>
                {JOB_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {JOB_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <Checkbox checked={remote} onChange={(e) => setRemote(e.target.checked)} label="Remote only" className="min-h-11" />
              {available && <Checkbox checked={canRefer} onChange={(e) => setCanRefer(e.target.checked)} label={CAN_REFER_BADGE} className="min-h-11" />}
            </div>
            {jobs.isLoading && <Loading />}
            {jobs.error && jobs.items.length === 0 && <ErrorBox error={jobs.error} />}
            {/* One column that may shrink, so a long title truncates on a phone rather than widening the page. */}
            <div className="grid grid-cols-1 gap-3">
              {jobs.items.map((j) => (
                <JobCard key={j.id} slug={slug} job={j} />
              ))}
            </div>
            {!jobs.isLoading && !jobs.error && jobs.items.length === 0 &&
              (filters.canRefer ? (
                <EmptyState icon="🤝" title="No openings can refer right now" description="When a poster offers to refer people for a job, it shows here." />
              ) : (
                <EmptyState icon="💼" title="No openings right now" description="Know of a role? Post it for your batchmates." />
              ))}
            <LoadMore hasNextPage={!!jobs.hasNextPage} isFetchingNextPage={jobs.isFetchingNextPage} fetchNextPage={() => void jobs.fetchNextPage()} />
          </>
        ) : tab === "seekers" ? (
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
        ) : available ? (
          <ReferralRequests
            slug={slug}
            box={box}
            onBoxChange={(next) => go("referrals", next)}
            limited={false}
            onBrowse={() => {
              setCanRefer(true);
              go("openings");
            }}
          />
        ) : (
          <ReferralsWayOut slug={slug} box={box} onBoxChange={(next) => go("referrals", next)} />
        )}
      </div>
    </div>
  );
}
