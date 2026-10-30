import { JOB_TYPE_LABELS, type JobDto } from "@illuminize/shared";
import { Link } from "react-router-dom";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Badge, Card } from "@/components/ui";
import { timeAgo } from "@/lib/format";

export function JobCard({ slug, job }: { slug: string; job: JobDto }) {
  return (
    <Link to={`/t/${slug}/app/jobs/${job.id}`}>
      <Card className="p-4 transition hover:border-slate-300 hover:shadow">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-slate-900">{job.title}</h3>
            <p className="text-sm text-slate-600">
              {job.companyName}
              {job.location ? ` · ${job.location}` : ""}
              {job.isRemote ? " · Remote" : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge tone="info">{JOB_TYPE_LABELS[job.jobType]}</Badge>
            {job.isClosed && <Badge>Closed</Badge>}
            <ModerationStatusBadge status={job.moderationStatus} />
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-slate-600">{job.description}</p>
        <p className="mt-2 text-xs text-slate-400">
          Posted by {job.author.fullName} (batch of {job.author.batchYear}) · {timeAgo(job.createdAt)}
          {job.salaryRange ? ` · ${job.salaryRange}` : ""}
        </p>
      </Card>
    </Link>
  );
}
