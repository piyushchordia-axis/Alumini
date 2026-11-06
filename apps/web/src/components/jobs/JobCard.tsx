import { CAN_REFER_BADGE, JOB_TYPE_LABELS, YOU_HAVE_THIS_TEXT, experienceLabel, jobPlaceLabel, jobSalaryText, memberYearsLabel, skillMatch, skillsMatchedFirst, type JobCardDto } from "@illuminize/shared";
import clsx from "clsx";
import { IconCheck, IconClock, IconJobs, IconWallet } from "@/components/icons";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { ContentCard } from "@/components/moderation/ContentCard";
import { ModerationCardNote, ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Badge } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { timeAgo } from "@/lib/format";

const SHOWN_SKILLS = 3;

/**
 * A job in a list. The title comes first in the card, so it starts the link's name; the logo (hidden from screen readers)
 * comes after it and is drawn on the left.
 */
export function JobCard({ slug, job }: { slug: string; job: JobCardDto }) {
  const { membership } = useMembership();
  const place = jobPlaceLabel(job);
  const pay = jobSalaryText(job) ?? job.salaryNote;
  const experience = experienceLabel(job.experienceMin, job.experienceMax);
  // The skills the reader has come first, marked as on the job's page, so they're among the few shown. Not on their own jobs.
  const matched = job.isMine ? [] : skillMatch(job.skills, membership.skills).matched;
  const shown = skillsMatchedFirst(job.skills, matched).slice(0, SHOWN_SKILLS);
  const more = job.skills.length - SHOWN_SKILLS;
  return (
    <ContentCard to={`/t/${slug}/app/jobs/${job.id}`} status={job.moderationStatus} className="p-4">
      <div className="flex flex-row-reverse items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold text-slate-900 [overflow-wrap:anywhere]">{job.title}</h3>
          <p className="truncate text-sm text-slate-600">
            {job.companyName}
            {place ? ` · ${place}` : ""}
          </p>
          {/* The badges have a line of their own, as on the mobile app, so a long title keeps the width. */}
          {(job.canRefer || job.isClosed || job.moderationStatus !== "APPROVED") && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {job.canRefer && !job.isClosed && <Badge tone="success">{CAN_REFER_BADGE}</Badge>}
              {job.isClosed && <Badge>Closed</Badge>}
              <ModerationStatusBadge status={job.moderationStatus} />
            </div>
          )}
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
            <li className="inline-flex items-center gap-1">
              <IconJobs size={14} className="text-slate-400" />
              {JOB_TYPE_LABELS[job.jobType]}
            </li>
            {experience && (
              <li className="inline-flex items-center gap-1">
                <IconClock size={14} className="text-slate-400" />
                {experience}
              </li>
            )}
            {pay && (
              <li className="inline-flex min-w-0 items-center gap-1">
                <IconWallet size={14} className="text-slate-400" />
                <span className="truncate">{pay}</span>
              </li>
            )}
          </ul>
        </div>
        <CompanyLogo name={job.companyName} src={job.companyLogoUrl} size="sm" />
      </div>
      <ModerationCardNote status={job.moderationStatus} note={job.moderationNote} />
      {job.summary && <p className="mt-2 line-clamp-2 text-sm text-slate-600 [overflow-wrap:anywhere]">{job.summary}</p>}
      {job.skills.length > 0 && (
        <>
          {/* Hidden words rather than a label on the list: in a link's name a label stands in for all it labels, so the
              card would say "Skills" and none of them, nor which the reader has. With these it says them all, as on mobile. */}
          <span className="sr-only">Skills:</span>
          {/* One line, the chips shortening to fit, so a long skill or a mark never makes the card taller. */}
          <ul className="mt-2 flex gap-1.5">
            {shown.map(({ skill, matched: has }) => (
              <li
                key={skill}
                className={clsx("inline-flex min-w-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs", has ? "bg-primary/10 font-semibold text-primary" : "bg-slate-100 text-slate-700")}
              >
                {has && <IconCheck size={12} strokeWidth={2.5} />}
                <span className="truncate">{skill}</span>
                {has && <span className="sr-only"> {YOU_HAVE_THIS_TEXT}</span>}
              </li>
            ))}
            {more > 0 && <li className="shrink-0 rounded-full px-1 py-0.5 text-xs text-slate-500">+{more} more</li>}
          </ul>
        </>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Posted by {job.author.fullName} ({memberYearsLabel(job.author)}) · {timeAgo(job.createdAt)}
      </p>
    </ContentCard>
  );
}
