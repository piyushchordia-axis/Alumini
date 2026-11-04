import { CAN_REFER_BADGE, JOB_DELETED_TEXT, waitingReferralsCloseText } from "@illuminize/shared";
import { errorMessage, fatalQueryError } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { MemberLink } from "@/components/common/MemberLink";
import { JobApplyArea } from "@/components/jobs/JobApplyArea";
import { AboutCompany, JobDetails } from "@/components/jobs/JobDetails";
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
  const [now] = useState(() => Date.now());
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
        <JobDetails
          job={j}
          now={now}
          titleId={headingId}
          badges={
            // A closed job takes no requests, whatever its poster offered. The job type is among the facts.
            j.canRefer || j.isClosed || j.moderationStatus !== "APPROVED" ? (
              <>
                {j.canRefer && !j.isClosed && <Badge tone="success">{CAN_REFER_BADGE}</Badge>}
                {j.isClosed && <Badge>Closed</Badge>}
                <ModerationStatusBadge status={j.moderationStatus} note={j.moderationNote} />
              </>
            ) : null
          }
          // Closed or past its closing date: the API already keeps the contacts from other members, and nobody can apply now.
          apply={<JobApplyArea job={j} now={now} />}
        />
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
      <AboutCompany job={j} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-1)]" />
      {j.isMine ? <JobReferrals slug={slug} job={j} /> : <MyReferral slug={slug} job={j} />}
    </div>
  );
}
