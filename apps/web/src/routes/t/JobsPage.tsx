import {
  CAN_REFER_BADGE,
  JOB_EXPERIENCE_MAX_YEARS,
  JOB_SENIORITIES,
  JOB_SENIORITY_LABELS,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  JOBS_TAB_LABELS,
  JOBS_TABS,
  WORK_MODES,
  WORK_MODE_LABELS,
  jobsQuery,
  jobsTabFrom,
  referralBoxFrom,
  type JobSeniority,
  type JobsTab,
  type JobType,
  type ReferralBox,
  type WorkMode,
} from "@illuminize/shared";
import { useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { IconJobs, IconProfile } from "@/components/icons";
import { JobCard } from "@/components/jobs/JobCard";
import { useReferralList } from "@/components/jobs/ReferralList";
import { ReferralRequests, ReferralsWayOut } from "@/components/jobs/ReferralRequests";
import { SeekerCard } from "@/components/jobs/SeekerCard";
import { SeekerToggleCard } from "@/components/jobs/SeekerToggleCard";
import { Button, Checkbox, EmptyState, ErrorBox, Input, LinkButton, LoadMore, Loading, PageHeader, Select, Tabs } from "@/components/ui";
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
  const [canRefer, setCanRefer] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const moreToggle = useRef<HTMLButtonElement>(null);
  const experienceHint = useId();
  const [workMode, setWorkMode] = useState<WorkMode | "">("");
  const [seniority, setSeniority] = useState<JobSeniority | "">("");
  const [experience, setExperience] = useState("");
  // Whole years in range, or no filter: the API refuses anything else, and a half-typed box shouldn't empty the list.
  const years = /^\d{1,2}$/.test(experience.trim()) && Number(experience) <= JOB_EXPERIENCE_MAX_YEARS ? Number(experience) : undefined;
  const filters = {
    q: q || undefined,
    jobType: jobType || undefined,
    workMode: workMode || undefined,
    seniority: seniority || undefined,
    experience: years,
    canRefer: (available && canRefer) || undefined,
  };
  const moreActive = !!(workMode || seniority || years !== undefined);
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
            {/* Search, type and Can refer stay in view; the rest waits behind More filters, as on the directory. */}
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[var(--shadow-1)]">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                <Input aria-label="Search jobs" placeholder="Search title, company or skill" value={q} onChange={(e) => setQ(e.target.value)} />
                <Select aria-label="Job type" value={jobType} onChange={(e) => setJobType(e.target.value as JobType | "")} className="sm:w-44">
                  <option value="">All types</option>
                  {JOB_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {JOB_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <div className="flex flex-wrap items-center gap-x-3">
                  {available && <Checkbox checked={canRefer} onChange={(e) => setCanRefer(e.target.checked)} label={CAN_REFER_BADGE} className="min-h-11" />}
                  <Button ref={moreToggle} type="button" variant="ghost" size="sm" className="min-h-11" aria-expanded={moreFilters} onClick={() => setMoreFilters((v) => !v)}>
                    {moreFilters ? "Hide filters" : moreActive ? "More filters · on" : "More filters"}
                  </Button>
                </div>
              </div>
              {moreFilters && (
                <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3 sm:items-center">
                  <Select aria-label="Work mode" value={workMode} onChange={(e) => setWorkMode(e.target.value as WorkMode | "")}>
                    <option value="">Any work mode</option>
                    {WORK_MODES.map((m) => (
                      <option key={m} value={m}>
                        {WORK_MODE_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label="Seniority" value={seniority} onChange={(e) => setSeniority(e.target.value as JobSeniority | "")}>
                    <option value="">Any seniority</option>
                    {JOB_SENIORITIES.map((s) => (
                      <option key={s} value={s}>
                        {JOB_SENIORITY_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                  <div>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <span>Your experience (years)</span>
                      <span className="w-20 shrink-0">
                        <Input type="number" min={0} max={JOB_EXPERIENCE_MAX_YEARS} inputMode="numeric" aria-describedby={experienceHint} value={experience} onChange={(e) => setExperience(e.target.value)} />
                      </span>
                    </label>
                    <p id={experienceHint} className="mt-0.5 text-xs text-slate-500">
                      Lists the jobs whose experience range fits you.
                    </p>
                  </div>
                  {moreActive && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 justify-self-start"
                      onClick={() => {
                        setWorkMode("");
                        setSeniority("");
                        setExperience("");
                        // The button goes with the filters it cleared, so focus moves to the toggle above them.
                        moreToggle.current?.focus();
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              )}
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
                <EmptyState icon={<IconJobs size={32} className="text-slate-400" />} title="No openings can refer right now" description="When a poster offers to refer people for a job, it shows here." />
              ) : moreActive || filters.q || filters.jobType ? (
                <EmptyState icon={<IconJobs size={32} className="text-slate-400" />} title="No openings match" description="Try removing a filter." />
              ) : (
                <EmptyState icon={<IconJobs size={32} className="text-slate-400" />} title="No openings right now" description="Know of a role? Post it for your batchmates." />
              ))}
            <LoadMore hasNextPage={!!jobs.hasNextPage} isFetchingNextPage={jobs.isFetchingNextPage} fetchNextPage={() => void jobs.fetchNextPage()} />
          </>
        ) : tab === "seekers" ? (
          <>
            <SeekerToggleCard slug={slug} />
            {seekers.isLoading && <Loading />}
            {/* Columns that may shrink, as the openings', so a long headline truncates rather than widening the page. */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {seekers.items.map((s) => (
                <SeekerCard key={s.member.id} slug={slug} seeker={s} />
              ))}
            </div>
            {!seekers.isLoading && seekers.items.length === 0 && <EmptyState icon={<IconProfile size={32} className="text-slate-400" />} title="Nobody is looking right now" />}
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
