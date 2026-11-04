import { CAN_REFER_BADGE, JOB_DELETED_TEXT, JOB_TYPE_LABELS, waitingReferralsCloseText } from "@illuminize/shared";
import { errorMessage, fatalQueryError } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { MemberLink } from "@/components/common/MemberLink";
import { RichText } from "@/components/common/RichText";
import { JobReferrals, MyReferral } from "@/components/jobs/JobReferrals";
import { JobUnavailable } from "@/components/jobs/JobUnavailable";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Badge, Button, Card, LinkButton, Loading } from "@/components/ui";
import { useJob } from "@/hooks/useJob";
import { useMembership } from "@/hooks/useMembership";
import { useRowFocus } from "@/hooks/useRowFocus";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { jobsPath, refreshReferrals } from "@/lib/referrals";
import { toast } from "@/stores/uiStore";

/** Remounts per job, so nothing from one (a dialog left open, say) carries into the next. */
export function JobDetailRoute() {
  const { jobId = "" } = useParams();
  return <JobDetailPage key={jobId} jobId={jobId} />;
}

function JobDetailPage({ jobId }: { jobId: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<"close" | "delete" | null>(null);
  const headingId = useId();
  // Mark closed goes once the job is closed, so focus moves to the job's heading rather than to the top of the page.
  const focus = useRowFocus(confirming !== null);
  const job = useJob(slug, jobId);
  // Closing or deleting a job closes the referral requests waiting on it, so their lists change too.
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["jobs", slug] });
    void qc.invalidateQueries({ queryKey: qk.job(slug, jobId) });
    void refreshReferrals(qc, slug);
  };
  const close = useMutation({
    mutationFn: (_fromDialog: boolean) => api.jobs.close(slug, jobId),
    onSuccess: (_, fromDialog) => {
      if (fromDialog) {
        focus.afterDialog(headingId);
        setConfirming(null);
      } else focus.now(headingId);
      invalidate();
      toast.success("Job closed");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.jobs.remove(slug, jobId),
    onSuccess: () => {
      invalidate();
      toast.success(JOB_DELETED_TEXT);
      navigate(jobsPath(slug));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Only an answer, or nothing at all to show: a refetch failing in the background keeps the page.
  const error = fatalQueryError(job);
  if (error) return <JobUnavailable error={error} onRetry={() => void job.refetch()} />;
  if (!job.data) return <Loading />;
  const j = job.data;
  const waiting = j.pendingReferralCount ?? 0;
  const closesWaiting = waiting > 0 ? waitingReferralsCloseText(waiting) : undefined;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={jobsPath(slug)} className="inline-flex min-h-11 items-center text-sm text-slate-500 hover:text-slate-800">
        ← All jobs
      </Link>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 id={headingId} tabIndex={-1} className="text-xl font-semibold text-slate-900 outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-primary/40">
              {j.title}
            </h1>
            <p className="text-slate-600 [overflow-wrap:anywhere]">
              {j.companyName}
              {j.location ? ` · ${j.location}` : ""}
              {j.isRemote ? " · Remote" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{JOB_TYPE_LABELS[j.jobType]}</Badge>
            {/* A closed job takes no requests, whatever its poster offered. */}
            {j.canRefer && !j.isClosed && <Badge tone="success">{CAN_REFER_BADGE}</Badge>}
            {j.isClosed && <Badge>Closed</Badge>}
            <ModerationStatusBadge status={j.moderationStatus} note={j.moderationNote} />
          </div>
        </div>
        {j.salaryRange && <p className="mt-2 text-sm text-slate-700">💰 {j.salaryRange}</p>}
        {j.expiresAt && <p className="text-xs text-slate-500">Applications close {formatDate(j.expiresAt)}</p>}
        <RichText text={j.description} className="mt-4" />
        <div className="mt-5 flex flex-wrap gap-2">
          {j.applyUrl && !j.isClosed && (
            <a href={j.applyUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white">
              Apply ↗
            </a>
          )}
          {j.contactEmail && (
            <a href={`mailto:${j.contactEmail}`} className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm [overflow-wrap:anywhere]">
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
          <div className="flex flex-wrap items-center gap-2">
            {j.isMine ? (
              <>
                <LinkButton to={`/t/${slug}/app/jobs/${j.id}/edit`} variant="outline" size="sm" className="min-h-11">
                  Edit
                </LinkButton>
                {!j.isClosed && (
                  // Asked first only when it would close requests someone is waiting on.
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => (closesWaiting ? setConfirming("close") : close.mutate(false))} loading={close.isPending && !confirming}>
                    Mark closed
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setConfirming("delete")}>
                  Delete
                </Button>
                <ConfirmDialog
                  open={confirming === "close"}
                  title="Close this job?"
                  body={closesWaiting}
                  confirmLabel="Close job"
                  busy={close.isPending}
                  onConfirm={() => close.mutate(true)}
                  onCancel={() => setConfirming(null)}
                />
                <ConfirmDialog
                  open={confirming === "delete"}
                  title="Delete this job?"
                  body={closesWaiting}
                  confirmLabel="Delete job"
                  destructive
                  busy={remove.isPending}
                  onConfirm={() => remove.mutate()}
                  onCancel={() => setConfirming(null)}
                />
              </>
            ) : (
              <ReportButton slug={slug} contentType="JOB" contentId={j.id} />
            )}
          </div>
        </div>
      </Card>
      {j.isMine ? <JobReferrals slug={slug} job={j} /> : <MyReferral slug={slug} job={j} />}
    </div>
  );
}
