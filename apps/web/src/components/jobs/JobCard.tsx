import { CAN_REFER_BADGE, JOB_TYPE_LABELS, experienceLabel, jobPlaceLabel, jobSalaryText, type JobCardDto } from "@illuminize/shared";
import { IconClock, IconJobs, IconWallet } from "@/components/icons";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { ContentCard } from "@/components/moderation/ContentCard";
import { ModerationCardNote, ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Badge } from "@/components/ui";
import { timeAgo } from "@/lib/format";

const SHOWN_SKILLS = 3;

/**
 * A job in a list. The title comes first in the card, so it starts the link's name; the logo (hidden from screen readers)
 * comes after it and is drawn on the left.
 */
export function JobCard({ slug, job }: { slug: string; job: JobCardDto }) {
  const place = jobPlaceLabel(job);
  const pay = jobSalaryText(job) ?? job.salaryNote;
  const experience = experienceLabel(job.experienceMin, job.experienceMax);
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
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Skills">
          {job.skills.slice(0, SHOWN_SKILLS).map((skill) => (
            <li key={skill} className="max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {skill}
            </li>
          ))}
          {more > 0 && (
            <li className="rounded-full px-1 py-0.5 text-xs text-slate-500">+{more} more</li>
          )}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Posted by {job.author.fullName} (batch of {job.author.batchYear}) · {timeAgo(job.createdAt)}
      </p>
    </ContentCard>
  );
}
