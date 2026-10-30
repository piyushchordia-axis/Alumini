import { JOB_TYPE_LABELS } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MemberLink } from "@/components/common/MemberLink";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Badge, Button, Card, ErrorBox, LinkButton, Loading } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function JobDetailPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const job = useQuery({ queryKey: qk.job(slug, jobId), queryFn: () => api.jobs.get(slug, jobId) });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["jobs", slug] });
    void qc.invalidateQueries({ queryKey: qk.job(slug, jobId) });
  };
  const close = useMutation({ mutationFn: () => api.jobs.close(slug, jobId), onSuccess: () => { invalidate(); toast.success("Job closed"); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.jobs.remove(slug, jobId), onSuccess: () => { invalidate(); navigate(`/t/${slug}/app/jobs`); }, onError: (e) => toast.error(errorMessage(e)) });

  if (job.isLoading) return <Loading />;
  if (job.error || !job.data) return <ErrorBox error={job.error ?? "Not found"} />;
  const j = job.data;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={`/t/${slug}/app/jobs`} className="text-sm text-slate-500 hover:text-slate-800">
        ← All jobs
      </Link>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{j.title}</h1>
            <p className="text-slate-600">
              {j.companyName}
              {j.location ? ` · ${j.location}` : ""}
              {j.isRemote ? " · Remote" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{JOB_TYPE_LABELS[j.jobType]}</Badge>
            {j.isClosed && <Badge>Closed</Badge>}
            <ModerationStatusBadge status={j.moderationStatus} note={j.moderationNote} />
          </div>
        </div>
        {j.salaryRange && <p className="mt-2 text-sm text-slate-700">💰 {j.salaryRange}</p>}
        {j.expiresAt && <p className="text-xs text-slate-500">Applications close {formatDate(j.expiresAt)}</p>}
        <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-slate-800">{j.description}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {j.applyUrl && !j.isClosed && (
            <a href={j.applyUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white">
              Apply ↗
            </a>
          )}
          {j.contactEmail && (
            <a href={`mailto:${j.contactEmail}`} className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm">
              ✉️ {j.contactEmail}
            </a>
          )}
          {j.contactPhone && (
            <a href={`tel:${j.contactPhone}`} className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm">
              📞 {j.contactPhone}
            </a>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <MemberLink slug={slug} member={j.author} meta={`Posted ${formatDate(j.createdAt)}`} />
          <div className="flex items-center gap-2">
            {j.isMine ? (
              <>
                <LinkButton to={`/t/${slug}/app/jobs/${j.id}/edit`} variant="outline" size="sm">
                  Edit
                </LinkButton>
                {!j.isClosed && (
                  <Button variant="outline" size="sm" onClick={() => close.mutate()} loading={close.isPending}>
                    Mark closed
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => confirm("Delete this job?") && remove.mutate()}>
                  Delete
                </Button>
              </>
            ) : (
              <ReportButton slug={slug} contentType="JOB" contentId={j.id} />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
