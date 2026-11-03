import { jobSavedText } from "@illuminize/shared";
import { fatalQueryError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { JobForm } from "@/components/jobs/JobForm";
import { JobUnavailable } from "@/components/jobs/JobUnavailable";
import { Card, Loading, PageHeader } from "@/components/ui";
import { useJob } from "@/hooks/useJob";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { jobPath, refreshReferrals, useReferralsAvailable } from "@/lib/referrals";
import { toast } from "@/stores/uiStore";

export function JobFormPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { jobId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const offerReferrals = useReferralsAvailable();
  const existing = useJob(slug, jobId ?? "", !!jobId);
  // Only an answer, or nothing at all to show: a refetch failing in the background keeps the form and what was typed.
  const error = jobId ? fatalQueryError(existing) : null;
  if (error) return <JobUnavailable error={error} onRetry={() => void existing.refetch()} />;
  if (jobId && !existing.data) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={jobId ? "Edit job" : "Post a job"} subtitle="Share an opening or a referral with alumni" />
      <Card className="p-5">
        <JobForm
          initial={existing.data}
          submitLabel={jobId ? "Save changes" : "Post job"}
          offerReferrals={offerReferrals}
          waitingReferrals={existing.data?.pendingReferralCount ?? 0}
          onSubmit={async (v) => {
            const job = jobId ? await api.jobs.update(slug, jobId, v) : await api.jobs.create(slug, v);
            void qc.invalidateQueries({ queryKey: ["jobs", slug] });
            void qc.invalidateQueries({ queryKey: ["job", slug] });
            // Unticking "I can refer" closes the requests waiting on it.
            if (jobId) void refreshReferrals(qc, slug);
            toast.success(jobSavedText(!!jobId, job.moderationStatus === "PENDING"));
            navigate(jobPath(slug, job.id));
          }}
        />
      </Card>
    </div>
  );
}
